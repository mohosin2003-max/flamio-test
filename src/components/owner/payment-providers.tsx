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
  ownerListPaymentProviders,
  ownerSavePaymentProvider,
  type PaymentProviderRow,
} from "@/lib/payments.functions";

/**
 * Owner → Settings → Payments. Configuration foundation only: it records which
 * providers are turned on and in which mode. No credentials are entered or
 * stored here, and nothing in this section changes checkout — Cash stays the
 * only live payment method until a real provider integration is built.
 */

const statusLabel = (p: PaymentProviderRow) =>
  p.status === "disabled"
    ? "Disabled"
    : p.status === "configured"
      ? "Configured"
      : "Not configured";

const statusVariant = (p: PaymentProviderRow) =>
  p.status === "configured" ? "default" : p.status === "disabled" ? "secondary" : "outline";

export function PaymentProvidersSection() {
  const list = useServerFn(ownerListPaymentProviders);
  const save = useServerFn(ownerSavePaymentProvider);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    mode: "sandbox" | "live";
    merchantReference: string;
    note: string;
  }>({ mode: "sandbox", merchantReference: "", note: "" });

  const providers = useQuery({
    queryKey: ["owner-payment-providers"],
    queryFn: () => list(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-payment-providers"] });

  const persist = async (
    provider: PaymentProviderRow,
    patch: Partial<{
      isEnabled: boolean;
      mode: "sandbox" | "live";
      merchantReference: string | null;
      note: string | null;
    }>,
  ) => {
    try {
      await save({
        data: {
          id: provider.id,
          isEnabled: patch.isEnabled ?? provider.isEnabled,
          mode: patch.mode ?? provider.mode,
          merchantReference:
            patch.merchantReference !== undefined
              ? patch.merchantReference
              : provider.merchantReference,
          note: patch.note !== undefined ? patch.note : provider.note,
        },
      });
      await refresh();
      toast.success("Payment settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save payment settings");
    }
  };

  if (providers.isLoading) return <Skeleton className="h-64 w-full" />;

  if (providers.error) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-display text-base font-bold">Payments</h2>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load payment settings.</p>
          <Button variant="outline" onClick={() => void providers.refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rows = providers.data ?? [];

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-bold">Payments</h2>
          <p className="text-sm text-muted-foreground">
            Cash is the only payment method customers can use today. Turning a provider on here
            records your intent and settings — it does not add any option at checkout until the
            provider is actually connected.
          </p>
        </div>

        {rows.map((provider) => {
          const isEditing = editing === provider.id;
          return (
            <div key={provider.id} className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{provider.label}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(provider)}>{statusLabel(provider)}</Badge>
                    {provider.slug === "cash" ? null : (
                      <Badge variant="secondary">
                        {provider.mode === "live" ? "Live mode" : "Test mode"}
                      </Badge>
                    )}
                    {provider.liveIntegrationAvailable ? null : (
                      <Badge variant="outline">Integration not built yet</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={provider.isEnabled}
                    disabled={provider.slug === "cash"}
                    aria-label={`Enable ${provider.label}`}
                    onCheckedChange={(checked) => void persist(provider, { isEnabled: checked })}
                  />
                  {provider.slug === "cash" ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (isEditing) {
                          setEditing(null);
                          return;
                        }
                        setEditing(provider.id);
                        setDraft({
                          mode: provider.mode,
                          merchantReference: provider.merchantReference ?? "",
                          note: provider.note ?? "",
                        });
                      }}
                    >
                      {isEditing ? "Close" : provider.credentialsReady ? "Edit" : "Set up"}
                    </Button>
                  )}
                </div>
              </div>

              {provider.slug === "cash" ? (
                <p className="text-sm text-muted-foreground">
                  Cash on delivery and counter cash sales. Always available, no setup needed.
                </p>
              ) : null}

              {isEditing ? (
                <div className="space-y-3 border-t border-border pt-3">
                  {provider.slug === "bkash" ? (
                    <p className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
                      bKash credentials (app key, app secret, username, password) must be applied
                      for and approved by bKash directly — they are issued to your registered
                      merchant account. When you have them, they will be stored in the secure server
                      secret store, never in this form, the database, or anything the
                      customer&apos;s browser can read.
                    </p>
                  ) : (
                    <p className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
                      A payment partner has to be chosen and approved before this can go live. No
                      credential fields are shown until the exact provider requirements are known.
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <Label>Mode</Label>
                    <div className="flex gap-2">
                      {(["sandbox", "live"] as const).map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={draft.mode === mode ? "default" : "outline"}
                          onClick={() => setDraft({ ...draft, mode })}
                        >
                          {mode === "sandbox" ? "Test" : "Live"}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`pay-ref-${provider.id}`}>
                      Merchant / account reference (optional, not secret)
                    </Label>
                    <Input
                      id={`pay-ref-${provider.id}`}
                      value={draft.merchantReference}
                      placeholder="e.g. your merchant short code"
                      onChange={(e) => setDraft({ ...draft, merchantReference: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`pay-note-${provider.id}`}>Internal note (optional)</Label>
                    <Textarea
                      id={`pay-note-${provider.id}`}
                      rows={2}
                      value={draft.note}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    />
                  </div>

                  {provider.requiredSecretNames.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Credentials needed before going live</p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {provider.requiredSecretNames.map((name) => (
                          <li key={name} className="flex items-center gap-2">
                            <Badge
                              variant={
                                provider.missingSecretNames.includes(name) ? "outline" : "default"
                              }
                            >
                              {provider.missingSecretNames.includes(name) ? "Missing" : "Stored"}
                            </Badge>
                            <span>{name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        await persist(provider, {
                          mode: draft.mode,
                          merchantReference: draft.merchantReference.trim() || null,
                          note: draft.note.trim() || null,
                        });
                        setEditing(null);
                      }}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
