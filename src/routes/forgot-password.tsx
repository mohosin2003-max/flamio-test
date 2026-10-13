import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  lookupRecovery,
  redeemRecoveryCode,
  requestManualRecovery,
  resetWithProviderCode,
  sendRecoveryCode,
  type RecoveryMethod,
} from "@/lib/recovery.functions";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot your password? — Flamio" },
      {
        name: "description",
        content: "Reset your Flamio password by email code, SMS code, or a verified recovery request.",
      },
      { property: "og:title", content: "Forgot your password? — Flamio" },
      { property: "og:description", content: "Recover your Flamio account and set a new password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

type Step = "identify" | "choose" | "code" | "manual" | "redeem";

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const lookup = useServerFn(lookupRecovery);
  const send = useServerFn(sendRecoveryCode);
  const resetProvider = useServerFn(resetWithProviderCode);
  const requestManual = useServerFn(requestManualRecovery);
  const redeem = useServerFn(redeemRecoveryCode);

  const [step, setStep] = useState<Step>("identify");
  const [identity, setIdentity] = useState("");
  const [method, setMethod] = useState<RecoveryMethod | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [manualPhone, setManualPhone] = useState("");

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function passwordOk(): boolean {
    if (password.length < 8) return setError("Password must be at least 8 characters."), false;
    if (password !== confirm) return setError("Both passwords must match."), false;
    return true;
  }

  const onIdentify = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (identity.trim().length < 3) return setError("Enter your phone number or email.");
      const m = await lookup({ data: { identity } });
      setMethod(m);
      setStep(m.method === "manual" ? "manual" : "choose");
    });
  };

  const onSend = () =>
    run(async () => {
      const res = await send({ data: { identity } });
      if (!res.ok) {
        setError(res.message ?? "Couldn't send the code.");
        if (method?.method === "sms") setStep("manual");
        return;
      }
      setStep("code");
    });

  const onProviderReset = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (!passwordOk()) return;
      const res = await resetProvider({ data: { identity, code, password } });
      if (!res.ok) return setError(res.message ?? "That code is not valid.");
      toast.success("Password updated. Please sign in.");
      await navigate({ to: "/auth" });
    });
  };

  const enteredEmail = identity.includes("@");

  const onManualRequest = () =>
    run(async () => {
      // Never send an email address as a phone number.
      const phone = enteredEmail ? manualPhone.trim() : identity;
      if (phone.includes("@") || phone.replace(/\D/g, "").length < 6) {
        return setError("Enter the phone number on your account.");
      }
      const res = await requestManual({ data: { phone } });
      if (!res.ok) return setError(res.message);
      setInfo(res.message);
    });

  const onRedeem = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (!passwordOk()) return;
      const res = await redeem({ data: { phone: identity, code, password } });
      if (!res.ok) return setError(res.message ?? "That code is not valid.");
      toast.success("Password updated. Please sign in.");
      await navigate({ to: "/auth" });
    });
  };

  const passwordFields = (
    <>
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
    </>
  );

  const submit = (label: string) => (
    <Button type="submit" className="w-full" disabled={busy} aria-busy={busy}>
      {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
      {label}
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 pb-28 sm:px-6">
      <Link to="/auth" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to sign in
      </Link>

      <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight">Forgot your password?</h1>

      <div className="mt-6 space-y-4">
        {step === "identify" && (
          <form onSubmit={onIdentify} className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter the phone number or email on your account.</p>
            <div className="space-y-2">
              <Label htmlFor="recovery-identity">Phone number or email</Label>
              <Input id="recovery-identity" value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="01712345678" autoComplete="username" />
            </div>
            {submit("Continue")}
            <button type="button" className="w-full text-sm font-semibold text-primary" onClick={() => { setError(null); setStep("redeem"); }}>
              I already have a recovery code
            </button>
          </form>
        )}

        {step === "choose" && method?.method === "email" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This account has a registered email: <strong className="text-foreground">{method.maskedEmail}</strong>. We recommend email recovery — we'll send a code there (no SMS).
            </p>
            <Button className="w-full" onClick={onSend} disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />} Send email code
            </Button>
          </div>
        )}

        {step === "choose" && method?.method === "sms" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              We'll text a code to <strong className="text-foreground">{method.maskedPhone}</strong>.
            </p>
            <Button className="w-full" onClick={onSend} disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />} Send SMS code
            </Button>
            <button type="button" className="w-full text-sm font-semibold text-primary" onClick={() => setStep("manual")}>
              Can't receive SMS? Request manual recovery
            </button>
          </div>
        )}

        {step === "code" && (
          <form onSubmit={onProviderReset} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the code we sent {method?.method === "email" ? "to your email" : "by SMS"}, then choose a new password.
            </p>
            <div className="space-y-2">
              <Label htmlFor="recovery-code">Code</Label>
              <Input id="recovery-code" inputMode="numeric" maxLength={10} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            {passwordFields}
            {submit("Save new password")}
          </form>
        )}

        {step === "manual" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send a recovery request. Our team will call you on your registered number to verify it's you, then give you a one-time recovery code.
            </p>
            {enteredEmail && !info && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Email recovery isn't available for this address. Enter the phone number on your account to continue.</p>
                <Label htmlFor="manual-phone">Phone number</Label>
                <Input id="manual-phone" inputMode="tel" autoComplete="tel" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="01712345678" />
              </div>
            )}
            {info ? (
              <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{info}</p>
            ) : (
              <Button className="w-full" onClick={onManualRequest} disabled={busy}>
                {busy && <Loader2 className="animate-spin" aria-hidden="true" />} Request recovery
              </Button>
            )}
            <button type="button" className="w-full text-sm font-semibold text-primary" onClick={() => { setError(null); setStep("redeem"); }}>
              I have a recovery code
            </button>
          </div>
        )}

        {step === "redeem" && (
          <form onSubmit={onRedeem} className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter your phone number, the recovery code from our team, and your new password.</p>
            <div className="space-y-2">
              <Label htmlFor="redeem-phone">Phone number</Label>
              <Input id="redeem-phone" inputMode="tel" autoComplete="tel" value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="01712345678" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="redeem-code">Recovery code</Label>
              <Input id="redeem-code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} />
            </div>
            {passwordFields}
            {submit("Save new password")}
          </form>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-3 rounded-xl border border-border/70 bg-secondary p-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-muted-foreground">Only you choose your new password. Our team never asks for or sees it.</p>
        </div>
      </div>
    </div>
  );
}
