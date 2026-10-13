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
  ownerListIntegrations,
  ownerSaveIntegration,
  ownerTestIntegration,
} from "@/lib/integrations.functions";
import type { IntegrationView } from "@/lib/integrations.functions";

/**
 * Owner → Settings → Integrations. Same pattern as the Payments and SMS
 * sections: switch on/off, fill in non-secret details, see an honest status and
 * run a real connection test. Credentials are never typed or shown here.
 */

const STATUS_LABELS: Record<IntegrationView["status"], string> = {
  not_configured: "Not configured",
  configuration_required: "Configuration required",
  active: "Active",
  disabled: "Disabled",
  error: "Error",
};

const TITLES: Record<IntegrationView["slug"], { name: string; blurb: string }> = {
  whatsapp: {
    name: "WhatsApp Business",
    blurb:
      "Official WhatsApp Business messaging. Used for customer service and order updates once switched on.",
  },
  email: {
    name: "Email",
    blurb: "Email delivery for customer messages sent from a customer's profile.",
  },
};

function IntegrationCard({ row, onChanged }: { row: IntegrationView; onChanged: () => void }) {
  const save = useServerFn(ownerSaveIntegration);
  const test = useServerFn(ownerTestIntegration);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [draft, setDraft] = useState<{ config: Record<string, string>; note: string }>({
    config: { ...row.config },
    note: row.note ?? "",
  });

  const persist = async (patch: {
    isEnabled?: boolean;
    config?: Record<string, string>;
    note?: string | null;
  }) => {
    try {
      await save({
        data: {
          slug: row.slug,
          isEnabled: patch.isEnabled ?? row.isEnabled,
          config: patch.config ?? row.config,
          note: patch.note !== undefined ? patch.note : row.note,
        },
      });
      onChanged();
      toast.success("Saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this integration");
    }
  };

  const title = TITLES[row.slug];

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{title.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{title.blurb}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge
              variant={
                row.status === "active"
                  ? "default"
                  : row.status === "error"
                    ? "destructive"
                    : row.status === "disabled"
                      ? "secondary"
                      : "outline"
              }
            >
              {STATUS_LABELS[row.status]}
            </Badge>
            <Badge variant={row.missingSecretNames.length === 0 ? "default" : "outline"}>
              {row.missingSecretNames.length === 0 ? "Credential stored" : "Credential missing"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={row.isEnabled}
            aria-label={`Enable ${title.name}`}
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
              setDraft({ config: { ...row.config }, note: row.note ?? "" });
              setEditing(true);
            }}
          >
            {editing ? "Close" : row.missingFields.length === 0 ? "Edit" : "Set up"}
          </Button>
        </div>
      </div>

      {row.missingFields.length > 0 ? (
        <p className="text-xs text-muted-foreground">Still needed: {row.missingFields.join(", ")}.</p>
      ) : null}

      {row.lastTestAt ? (
        <p className="text-xs text-muted-foreground">
          Last test {new Date(row.lastTestAt).toLocaleString()} —{" "}
          {row.lastTestOk ? "success" : "failed"}
          {row.lastTestMessage ? `: ${row.lastTestMessage}` : ""}
        </p>
      ) : null}

      {editing ? (
        <div className="space-y-3 border-t border-border pt-3">
          {row.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`${row.slug}-${field.key}`}>
                {field.label}
                {field.required ? "" : " (optional)"}
              </Label>
              <Input
                id={`${row.slug}-${field.key}`}
                value={draft.config[field.key] ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, config: { ...draft.config, [field.key]: e.target.value } })
                }
              />
            </div>
          ))}

          <div className="space-y-1.5">
            <Label htmlFor={`${row.slug}-note`}>Internal note (optional)</Label>
            <Textarea
              id={`${row.slug}-note`}
              rows={2}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </div>

          <p className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
            The access credential is kept securely on the server as{" "}
            <span className="font-medium">{row.secretNames.join(", ")}</span>. Ask in chat to store
            or replace it — it is never typed into this screen.
          </p>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                const config: Record<string, string> = {};
                for (const [key, value] of Object.entries(draft.config)) {
                  const trimmed = value.trim();
                  if (trimmed) config[key] = trimmed;
                }
                await persist({ config, note: draft.note.trim() || null });
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
            const result = await test({ data: { slug: row.slug } });
            if (result.ok) toast.success(result.message);
            else toast.error(result.message);
            onChanged();
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
  );
}

export function IntegrationsSection() {
  const list = useServerFn(ownerListIntegrations);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["owner-integrations"], queryFn: () => list() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-integrations"] });

  if (query.isLoading) return <Skeleton className="h-52 w-full" />;

  if (query.error || !query.data) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-display text-base font-bold">Integrations</h2>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the integrations.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-bold">Integrations</h2>
          <p className="text-sm text-muted-foreground">
            Channels for messaging customers from their profile. A channel only becomes usable after
            it is switched on and a connection test succeeds.
          </p>
        </div>
        {query.data.map((row) => (
          <IntegrationCard key={row.id} row={row} onChanged={refresh} />
        ))}
      </CardContent>
    </Card>
  );
}
