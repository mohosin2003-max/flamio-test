import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({
    meta: [
      { title: "Change password — Flamio" },
      { name: "description", content: "Change your Flamio account password." },
      { property: "og:title", content: "Change password — Flamio" },
      { property: "og:description", content: "Change your Flamio account password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(message: string) {
    setError(message);
    toast.error(message);
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    if (password.length < 6) {
      fail("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      fail("Both passwords must match.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        fail(updateError.message);
        return;
      }
      toast.success("Password updated.");
      await navigate({ to: "/account", replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 pb-28 sm:px-6">
      <Link
        to="/account"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to account
      </Link>

      <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight">
        Change password
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose a new password for your account.
      </p>

      <form onSubmit={savePassword} className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy} aria-busy={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {busy ? "Saving..." : "Save new password"}
        </Button>
      </form>
    </div>
  );
}
