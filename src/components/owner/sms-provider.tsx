import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ownerGetSmsProvider,
  ownerSaveSmsProvider,
  ownerTestSmsConnection,
} from "@/lib/sms.functions";

/**
 * Owner → Settings → SMS/OTP provider. Same pattern as the Payments section:
 * on/off, provider choice, non-secret sender ID, configuration status and a
 * real connection test. The API key is never entered or shown here — it is
 * saved in the secure server secret store.
 */
export function SmsProviderSection() {
  const get = useServerFn(ownerGetSmsProvider);
  const save = useServerFn(ownerSaveSmsProvider);
  const test = useServerFn(ownerTestSmsConnection);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [draft, setDraft] = useState<{
    provider: "alpha_sms" | "smsbd";
    senderId: string;
    note: string;
  }>({ provider: "alpha_sms", senderId: "", note: "" });

  const query = useQuery({ queryKey: ["owner-sms-provider"], queryFn: () => get() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-sms-provider"] });
  const row = query.data ?? null;

  const persist = async (
    patch: Partial<{ provider: "alpha_sms" | "smsbd"; isEnabled: boolean; senderId: string | null; note: string | null }>,
  ) => {
    if (!row) return;
    try {
      await save({
        data: {
          id: row.id,
          provider: patch.provider ?? row.provider,
          isEnabled: patch.isEnabled ?? row.isEnabled,
          senderId: patch.senderId !== undefined ? patch.senderId : row.senderId,
          note: patch.note !== undefined ? patch.note : row.note,
        },
      });
      await refresh();
      toast.success("SMS settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save SMS settings");
    }
  };

  if (query.isLoading) return <Skeleton className="h-52 w-full" />;

  if (query.error || !row) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-display text-base font-bold">SMS / OTP provider</h2>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the SMS settings.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const statusLabel =
    row.status === "disabled" ? "Disabled" : row.status === "configured" ? "Configured" : "Not configured";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-bold">SMS / OTP provider</h2>
          <p className="text-sm text-muted-foreground">
            Verification codes for sign-up, sign-in and password recovery are delivered through this
            provider. The API key is kept on the server only — never in this form or the app.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">
                {row.provider === "alpha_sms" ? "Alpha SMS (sms.net.bd)" : "SMS.bd"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    row.status === "configured" ? "default" : row.status === "disabled" ? "secondary" : "outline"
                  }
                >
                  {statusLabel}
                </Badge>
                <Badge variant={row.apiKeyStored ? "default" : "outline"}>
                  {row.apiKeyStored ? "API key stored" : "API key missing"}
                </Badge>
                {row.senderId ? <Badge variant="secondary">Sender: {row.senderId}</Badge> : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={row.isEnabled}
                aria-label="Enable SMS provider"
                onCheckedChange={(checked) => void persist({ isEnabled: checked })}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (editing) {
                    setEditing(false);
                    return;
                  }
                  setEditing(true);
                  setDraft({
                    provider: row.provider,
                    senderId: row.senderId ?? "",
                    note: row.note ?? "",
                  });
                }}
              >
                {editing ? "Close" : row.apiKeyStored ? "Edit" : "Set up"}
              </Button>
            </div>
          </div>

          {row.lastTestAt ? (
            <p className="text-xs text-muted-foreground">
              Last test {new Date(row.lastTestAt).toLocaleString()} —{" "}
              {row.lastTestOk ? "success" : "failed"}
              {row.lastTestMessage ? `: ${row.lastTestMessage}` : ""}
            </p>
          ) : null}

          {editing ? (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <div className="flex gap-2">
                  {(["alpha_sms", "smsbd"] as const).map((provider) => (
                    <Button
                      key={provider}
                      size="sm"
                      variant={draft.provider === provider ? "default" : "outline"}
                      onClick={() => setDraft({ ...draft, provider })}
                    >
                      {provider === "alpha_sms" ? "Alpha SMS" : "SMS.bd"}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sms-sender">Sender ID (optional, only if approved)</Label>
                <Input
                  id="sms-sender"
                  value={draft.senderId}
                  placeholder="e.g. FLAMIO"
                  onChange={(e) => setDraft({ ...draft, senderId: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sms-note">Internal note (optional)</Label>
                <Textarea
                  id="sms-note"
                  rows={2}
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                />
              </div>

              <p className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
                The API key is saved securely on the server as{" "}
                <span className="font-medium">{row.apiKeySecretName}</span>. Ask in chat to store or
                replace it — it is never typed into this screen.
              </p>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    await persist({
                      provider: draft.provider,
                      senderId: draft.senderId.trim() || null,
                      note: draft.note.trim() || null,
                    });
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <Button
            size="sm"
            variant="outline"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                const result = await test();
                if (result.ok) toast.success(result.message);
                else toast.error(result.message);
                await refresh();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Test failed");
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
