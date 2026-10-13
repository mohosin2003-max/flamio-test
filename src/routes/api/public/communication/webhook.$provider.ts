import { createHmac, timingSafeEqual } from "crypto";

import { createFileRoute } from "@tanstack/react-router";

/**
 * Delivery-status webhooks for the customer communication channels.
 *
 * Every request is signature-verified before anything is read from the body,
 * and updates are matched by provider message id, so a replayed webhook simply
 * writes the same status again. Nothing here sends a message or touches orders,
 * authentication, OTP, notifications or CRM data.
 *
 *   WhatsApp → X-Hub-Signature-256 (HMAC-SHA256, secret WHATSAPP_APP_SECRET)
 *   Email    → Standard Webhooks signature (secret RESEND_WEBHOOK_SECRET)
 */

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

function verifyWhatsApp(request: Request, body: string): boolean {
  const secret = process.env["WHATSAPP_APP_SECRET"];
  if (!secret) return false;
  const header = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(header, expected);
}

function verifyEmail(request: Request, body: string): boolean {
  const secretRaw = process.env["RESEND_WEBHOOK_SECRET"];
  if (!secretRaw) return false;
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const header = request.headers.get("svix-signature") ?? "";
  if (!id || !timestamp || !header) return false;

  const base64 = secretRaw.replace(/^whsec_/, "");
  const key = Buffer.from(base64, "base64");
  const expected = createHmac("sha256", key.length > 0 ? key : Buffer.from(secretRaw))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");

  return header
    .split(" ")
    .some((part) => safeEqual(part.replace(/^v1,/, ""), expected));
}

export const Route = createFileRoute("/api/public/communication/webhook/$provider")({
  server: {
    handlers: {
      // WhatsApp subscription verification handshake.
      GET: async ({ request, params }) => {
        if (params.provider !== "whatsapp") return new Response("Not found", { status: 404 });
        const url = new URL(request.url);
        const token = process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"];
        const challenge = url.searchParams.get("hub.challenge") ?? "";
        if (!token || url.searchParams.get("hub.verify_token") !== token) {
          return new Response("Forbidden", { status: 403 });
        }
        return new Response(challenge, { status: 200 });
      },

      POST: async ({ request, params }) => {
        const provider = params.provider;
        if (provider !== "whatsapp" && provider !== "email") {
          return new Response("Not found", { status: 404 });
        }

        const body = await request.text();
        const verified =
          provider === "whatsapp" ? verifyWhatsApp(request, body) : verifyEmail(request, body);
        if (!verified) return new Response("Invalid signature", { status: 401 });

        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return ok({ ok: true, ignored: "unparseable" });
        }

        const { normalizeProviderStatus, applyProviderStatus } = await import(
          "@/lib/communication.server"
        );

        const updates: { id: string; status: string }[] = [];

        if (provider === "whatsapp") {
          const entries =
            (payload as { entry?: { changes?: { value?: { statuses?: { id?: string; status?: string }[] } }[] }[] })
              .entry ?? [];
          for (const entry of entries) {
            for (const change of entry.changes ?? []) {
              for (const status of change.value?.statuses ?? []) {
                if (status.id && status.status) updates.push({ id: status.id, status: status.status });
              }
            }
          }
        } else {
          const event = payload as { type?: string; data?: { email_id?: string; id?: string } };
          const messageId = event.data?.email_id ?? event.data?.id;
          if (messageId && event.type) updates.push({ id: messageId, status: event.type });
        }

        let applied = 0;
        for (const update of updates) {
          const status = normalizeProviderStatus(update.status);
          if (!status) continue;
          await applyProviderStatus({
            providerSlug: provider,
            providerMessageId: update.id,
            status,
          });
          applied += 1;
        }

        return ok({ ok: true, applied });
      },
    },
  },
});
