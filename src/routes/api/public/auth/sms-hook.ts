import { createHmac, timingSafeEqual } from "crypto";

import { createFileRoute } from "@tanstack/react-router";

/**
 * Authentication "send SMS" hook.
 *
 * The authentication service keeps generating, expiring, verifying and
 * rate-limiting the OTP exactly as before; it simply asks this endpoint to
 * deliver the message. That makes Alpha SMS / SMS.bd the missing delivery
 * layer, not a second OTP system.
 *
 * Requests are signed by the auth service (Standard Webhooks). The shared
 * signing secret lives in the server secret store as AUTH_SMS_HOOK_SECRET.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const verifySignature = (
  secretRaw: string,
  id: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): boolean => {
  // Secret format: "v1,whsec_<base64>" or plain "whsec_<base64>"/base64.
  const secretParts = secretRaw.split(",");
  const secretPart = secretRaw.includes(",") ? (secretParts[1] ?? secretRaw) : secretRaw;
  const base64 = secretPart.replace(/^whsec_/, "");
  const key = Buffer.from(base64, "base64");
  const expected = createHmac("sha256", key.length > 0 ? key : Buffer.from(secretRaw))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");

  return signatureHeader
    .split(" ")
    .map((part) => {
      const parts = part.split(",");
      return part.includes(",") ? (parts[1] ?? part) : part;
    })
    .some((candidate) => {
      const a = Buffer.from(candidate);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
};

export const Route = createFileRoute("/api/public/auth/sms-hook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["AUTH_SMS_HOOK_SECRET"];
        if (!secret) {
          // This is an incomplete dependency, not an application crash or
          // transient outage. Do not return 5xx: the auth service could retry
          // it, and the preview would incorrectly report a runtime failure.
          return json(
            {
              error: {
                http_code: 424,
                message: "SMS delivery is not configured yet",
                configuration_required: true,
              },
            },
            424,
          );
        }

        const body = await request.text();
        const id = request.headers.get("webhook-id") ?? "";
        const timestamp = request.headers.get("webhook-timestamp") ?? "";
        const signature = request.headers.get("webhook-signature") ?? "";
        if (!id || !timestamp || !signature || !verifySignature(secret, id, timestamp, body, signature)) {
          return json({ error: { http_code: 401, message: "Invalid signature" } }, 401);
        }

        let phone = "";
        let otp = "";
        try {
          const payload = JSON.parse(body) as {
            user?: { phone?: string };
            sms?: { otp?: string };
          };
          phone = payload.user?.phone ?? "";
          otp = payload.sms?.otp ?? "";
        } catch {
          return json({ error: { http_code: 400, message: "Invalid payload" } }, 400);
        }
        if (!phone || !otp) {
          return json({ error: { http_code: 400, message: "Missing phone or code" } }, 400);
        }

        const { sendSms, otpMessage } = await import("@/lib/sms.server");
        const result = await sendSms(phone, otpMessage(otp));
        if (!result.ok) {
          // Operator-facing text only; no credentials, no provider internals.
          return json({ error: { http_code: 502, message: result.message } }, 502);
        }
        return json({});
      },
    },
  },
});
