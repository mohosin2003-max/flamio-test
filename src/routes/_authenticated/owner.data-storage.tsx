import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ManualCleanupPanel,
  Stat,
  StorageCleanupPanel,
  formatBytes,
} from "@/components/owner/cleanup-panels";
import {
  CLEANUP_CATEGORY_INFO,
  FREQUENCY_PRESETS,
  PROTECTED_DATA,
  RETENTION_PRESETS,
  categoryLabel,
  type CleanupCategory,
} from "@/lib/cleanup-categories";
import {
  cleanupApproveCategory,
  cleanupGetOverview,
  cleanupListHistory,
  cleanupPreview,
  cleanupRunDetails,
  cleanupSaveSetting,
  cleanupSetGlobal,
} from "@/lib/cleanup.functions";

/**
 * Owner-only Data & Storage Management. The server functions are the real
 * boundary (each one refuses anybody who is not the owner); this screen simply
 * does not exist for staff or customers.
 */
export const Route = createFileRoute("/_authenticated/owner/data-storage")({
  head: () => ({
    meta: [
      { title: "Data & Storage Management — Flamio" },
      {
        name: "description",
        content: "Control data retention, cleanup and storage usage safely.",
      },
      { property: "og:title", content: "Data & Storage Management — Flamio" },
      {
        property: "og:description",
        content: "Control data retention, cleanup and storage usage safely.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DataStoragePage,
});

function DataStoragePage() {
  const getOverview = useServerFn(cleanupGetOverview);

  const overview = useQuery({
    queryKey: ["cleanup-overview"],
    queryFn: () => getOverview(),
  });

  if (overview.isLoading) return <Skeleton className="h-96 w-full" />;

  if (overview.error) {
    return (
      <EmptyState
        title="Only the owner can open this"
        description="Data & Storage Management is limited to the restaurant owner account."
      />
    );
  }

  const data = overview.data!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Data &amp; Storage Management</h1>
        <p className="text-sm text-muted-foreground">
          Control data retention, cleanup and storage usage safely.
        </p>
      </div>

      {!data.overview.installed ? (
        <p className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Setup step missing: run <code>docs/sql/data_cleanup.sql</code> once in your database.
            Until then settings, schedules and cleanup history cannot be saved, and automatic
            cleanup is inactive.
          </span>
        </p>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="manual">Manual</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="auto">Automatic</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <OverviewCards data={data} />
        </TabsContent>

        <TabsContent value="manual" className="mt-4">
          <ManualCleanupPanel />
        </TabsContent>

        <TabsContent value="storage" className="mt-4">
          <StorageCleanupPanel />
        </TabsContent>

        <TabsContent value="auto" className="mt-4 space-y-4">
          <AutomaticSection data={data} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistorySection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type OverviewData = Awaited<ReturnType<typeof cleanupGetOverview>>;

function OverviewCards({ data }: { data: OverviewData }) {
  const { overview, config } = data;
  const totalRecords = overview.databaseRecords.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const removable = overview.candidates.reduce((sum, row) => sum + row.eligible, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-sm text-muted-foreground">Database records</p>
            <p className="text-2xl font-bold">{totalRecords.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">
              Counted across the tables this system can clean. Database size and quota are not
              available to the app — usage information unavailable.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-sm text-muted-foreground">Stored files</p>
            <p className="text-2xl font-bold">
              {overview.storageFiles == null ? "Unavailable" : overview.storageFiles}
            </p>
            <p className="text-xs text-muted-foreground">
              {overview.storageBytes == null
                ? "Usage information unavailable"
                : `About ${formatBytes(overview.storageBytes)} in your file buckets`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-sm text-muted-foreground">Cleanup candidates</p>
            <p className="text-2xl font-bold">{removable}</p>
            <p className="text-xs text-muted-foreground">
              {overview.orphanFiles == null
                ? "Unused files unavailable"
                : `${overview.orphanFiles} unused file(s)`}
              {overview.oldestCandidateAt
                ? ` · oldest ${new Date(overview.oldestCandidateAt).toLocaleDateString()}`
                : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-sm text-muted-foreground">Next automatic cleanup</p>
            <p className="text-lg font-semibold">
              {overview.autoPaused
                ? "Paused"
                : overview.nextRunAt
                  ? new Date(overview.nextRunAt).toLocaleString()
                  : "Not scheduled"}
            </p>
            <p className="text-xs text-muted-foreground">
              {config.state.pausedReason ?? `${overview.autoEnabledCount} categories switched on`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-sm text-muted-foreground">Last cleanup</p>
            <p className="text-lg font-semibold">
              {overview.lastRun ? new Date(overview.lastRun.startedAt).toLocaleString() : "Never"}
            </p>
            <p className="text-xs text-muted-foreground">
              {overview.lastRun
                ? `${categoryLabel(overview.lastRun.category)} · ${overview.lastRun.status} · deleted ${overview.lastRun.deleted}`
                : "No cleanup has run yet"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-sm text-muted-foreground">Automatic cleanup</p>
            <p className="text-lg font-semibold">
              {overview.autoPaused
                ? "Paused"
                : overview.autoEnabledCount > 0
                  ? "On"
                  : "Off"}
            </p>
            <p className="text-xs text-muted-foreground">
              Automatic cleanup only runs once the setup step is done and the schedule is added to
              your database.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="font-semibold">What can be cleaned right now</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {overview.candidates.map((row) => (
              <Stat
                key={row.category}
                label={categoryLabel(row.category)}
                value={`${row.eligible} eligible`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Deleting database records may reduce database storage, but deleting a record does not
            automatically remove related files. File cleanup needs separate unused-file
            verification. Retention settings should be chosen according to your business and
            record-keeping needs.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4" /> Never deleted automatically
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {PROTECTED_DATA.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function AutomaticSection({ data }: { data: OverviewData }) {
  const save = useServerFn(cleanupSaveSetting);
  const approve = useServerFn(cleanupApproveCategory);
  const setGlobal = useServerFn(cleanupSetGlobal);
  const preview = useServerFn(cleanupPreview);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<Record<string, string>>({});

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["cleanup-overview"] });
    await queryClient.invalidateQueries({ queryKey: ["cleanup-history"] });
  };

  const update = async (
    category: CleanupCategory,
    patch: Record<string, boolean | number>,
  ) => {
    setBusy(category);
    try {
      await save({ data: { category, ...patch } });
      toast.success("Settings saved successfully.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the settings");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="font-semibold">Safety controls</p>
          <p className="text-sm text-muted-foreground">
            Pausing stops every scheduled run immediately. Nothing is deleted by pausing or
            disabling.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy === "global"}
              onClick={async () => {
                setBusy("global");
                try {
                  await setGlobal({
                    data: { action: data.config.state.autoPaused ? "resume" : "pause" },
                  });
                  toast.success("Settings saved successfully.");
                  await refresh();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't update");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {data.config.state.autoPaused ? "Resume automatic cleanup" : "Pause all automatic cleanup"}
            </Button>
            <Button
              variant="destructive"
              disabled={busy === "global"}
              onClick={async () => {
                if (!window.confirm("Turn automatic cleanup off for every category?")) return;
                setBusy("global");
                try {
                  await setGlobal({ data: { action: "disable_all" } });
                  toast.success("Automatic cleanup disabled.");
                  await refresh();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't update");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Disable automatic cleanup
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>Stop automatically if a run would delete more than</Label>
            <Input
              type="number"
              min={10}
              defaultValue={data.config.state.largeDeletionThreshold}
              onBlur={async (event) => {
                const threshold = Number(event.target.value);
                if (!Number.isFinite(threshold) || threshold < 10) return;
                setBusy("global");
                try {
                  await setGlobal({ data: { action: "threshold", threshold } });
                  toast.success("Settings saved successfully.");
                  await refresh();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't update");
                } finally {
                  setBusy(null);
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              records in one run. Above this, automatic cleanup pauses itself and waits for you.
            </p>
          </div>
        </CardContent>
      </Card>

      {data.config.settings.map((setting) => {
        const info = CLEANUP_CATEGORY_INFO[setting.category];
        return (
          <Card key={setting.category}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{info.label}</p>
                  <p className="text-sm text-muted-foreground">{info.description}</p>
                </div>
                {info.autoSupported ? (
                  <Switch
                    checked={setting.autoEnabled}
                    disabled={busy === setting.category}
                    onCheckedChange={(value) =>
                      void update(setting.category, { autoEnabled: value })
                    }
                  />
                ) : (
                  <Badge variant="secondary">Manual only</Badge>
                )}
              </div>

              {info.warning ? (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  {info.warning}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Keep for</Label>
                  <Select
                    value={String(setting.retentionDays)}
                    onValueChange={(value) =>
                      void update(setting.category, { retentionDays: Number(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...new Set([...RETENTION_PRESETS, setting.retentionDays])]
                        .sort((a, b) => a - b)
                        .map((days) => (
                          <SelectItem key={days} value={String(days)}>
                            {days} days
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Check every</Label>
                  <Select
                    value={String(setting.frequencyDays)}
                    onValueChange={(value) =>
                      void update(setting.category, { frequencyDays: Number(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...new Set([...FREQUENCY_PRESETS, setting.frequencyDays])]
                        .sort((a, b) => a - b)
                        .map((days) => (
                          <SelectItem key={days} value={String(days)}>
                            {days === 1 ? "Daily" : `${days} days`}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Ask me before the first automatic cleanup</p>
                  <p className="text-xs text-muted-foreground">
                    {setting.approvedAt
                      ? `Approved ${new Date(setting.approvedAt).toLocaleDateString()}`
                      : "Not approved yet — the first run will only prepare a preview."}
                  </p>
                </div>
                <Switch
                  checked={setting.requireApproval}
                  disabled={busy === setting.category}
                  onCheckedChange={(value) =>
                    void update(setting.category, { requireApproval: value })
                  }
                />
              </div>

              {info.highRisk ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3">
                  <div>
                    <p className="text-sm font-medium">Unlock this category</p>
                    <p className="text-xs text-muted-foreground">
                      Required before anything here can be deleted, manually or automatically.
                    </p>
                  </div>
                  <Switch
                    checked={setting.unlocked}
                    disabled={busy === setting.category}
                    onCheckedChange={(value) => void update(setting.category, { unlocked: value })}
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === setting.category}
                  onClick={async () => {
                    setBusy(setting.category);
                    try {
                      const result = await preview({ data: { category: setting.category } });
                      setPreviewText((prev) => ({
                        ...prev,
                        [setting.category]: `Eligible ${result.eligible} · protected ${result.protected} · files ${result.filesAffected}${
                          result.bytesAffected != null ? ` · about ${formatBytes(result.bytesAffected)}` : ""
                        }${result.truncated ? " (first 500 checked)" : ""}`,
                      }));
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Preview failed");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Preview cleanup
                </Button>
                {setting.requireApproval && !setting.approvedAt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === setting.category}
                    onClick={async () => {
                      setBusy(setting.category);
                      try {
                        await approve({ data: { category: setting.category } });
                        toast.success("Approved. Future runs follow your rules.");
                        await refresh();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Couldn't approve");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Approve automatic cleanup
                  </Button>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  Last run{" "}
                  {setting.lastRunAt ? new Date(setting.lastRunAt).toLocaleString() : "never"} · next{" "}
                  {setting.nextRunAt ? new Date(setting.nextRunAt).toLocaleString() : "not scheduled"}
                </span>
              </div>

              {previewText[setting.category] ? (
                <p className="rounded-lg border border-border p-3 text-sm">
                  {previewText[setting.category]} — nothing was deleted by this preview.
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function HistorySection() {
  const listHistory = useServerFn(cleanupListHistory);
  const runDetails = useServerFn(cleanupRunDetails);
  const [openId, setOpenId] = useState<string | null>(null);

  const history = useQuery({ queryKey: ["cleanup-history"], queryFn: () => listHistory() });
  const details = useQuery({
    queryKey: ["cleanup-run", openId],
    queryFn: () => runDetails({ data: { runId: openId! } }),
    enabled: Boolean(openId),
  });

  if (history.isLoading) return <Skeleton className="h-60 w-full" />;
  const rows = history.data ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="font-semibold">Cleanup history</p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cleanup has been recorded yet. History is kept permanently and is never removed by
            cleanup itself.
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {categoryLabel(row.category)} · {row.runType}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(row.startedAt).toLocaleString()} · {row.initiatedLabel ?? "system"}
                  </p>
                </div>
                <Badge variant={row.status === "completed" ? "outline" : "secondary"}>
                  {row.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Requested {row.requested} · deleted {row.deleted} · protected {row.protected} ·
                skipped {row.skipped} · failed {row.failed} · files {row.filesDeleted}
                {row.bytesReleased != null ? ` · ${formatBytes(row.bytesReleased)}` : ""}
              </p>
              {row.errorSummary ? (
                <p className="mt-1 text-xs text-destructive">{row.errorSummary}</p>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 px-0"
                onClick={() => setOpenId(openId === row.id ? null : row.id)}
              >
                {openId === row.id ? "Hide details" : "View details"}
              </Button>
              {openId === row.id ? (
                details.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {(details.data ?? []).map((item: { id: string; label: string; outcome: string; reason: string | null }) => (
                      <li key={item.id}>
                        {item.outcome}: {item.label}
                        {item.reason ? ` — ${item.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
