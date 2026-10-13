import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  CLEANUP_CATEGORY_INFO,
  RETENTION_PRESETS,
  type CleanupCategory,
} from "@/lib/cleanup-categories";
import {
  cleanupDelete,
  cleanupDeleteFiles,
  cleanupListRecords,
  cleanupListStorage,
} from "@/lib/cleanup.functions";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MANUAL_CATEGORIES = (
  Object.keys(CLEANUP_CATEGORY_INFO) as CleanupCategory[]
).filter((id) => id !== "orphan_files");

type Filter = "all" | "eligible" | "protected";

/** Category + date range + per-record and bulk deletion. */
export function ManualCleanupPanel() {
  const list = useServerFn(cleanupListRecords);
  const remove = useServerFn(cleanupDelete);
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<CleanupCategory>("notifications");
  const [retentionDays, setRetentionDays] = useState<number>(
    CLEANUP_CATEGORY_INFO.notifications.defaultRetentionDays,
  );
  const [customDate, setCustomDate] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("eligible");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);

  const info = CLEANUP_CATEGORY_INFO[category];
  const before = customDate ? new Date(`${customDate}T00:00:00Z`).toISOString() : undefined;

  const records = useQuery({
    queryKey: ["cleanup-records", category, retentionDays, before],
    queryFn: () => list({ data: { category, retentionDays, before, limit: 200 } }),
  });

  const rows = useMemo(() => {
    const all = records.data?.records ?? [];
    const term = search.trim().toLowerCase();
    return all.filter((row) => {
      if (filter === "eligible" && row.protectedReason) return false;
      if (filter === "protected" && !row.protectedReason) return false;
      if (!term) return true;
      return `${row.label} ${row.detail ?? ""}`.toLowerCase().includes(term);
    });
  }, [records.data, filter, search]);

  const eligibleVisible = rows.filter((row) => !row.protectedReason).map((row) => row.id);
  const preview = records.data?.preview;

  const changeCategory = (next: CleanupCategory) => {
    setCategory(next);
    setRetentionDays(CLEANUP_CATEGORY_INFO[next].defaultRetentionDays);
    setSelected([]);
    setConfirmWord("");
  };

  const runDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (info.highRisk && confirmWord !== "DELETE") {
      toast.error("Type DELETE in the confirmation box first.");
      return;
    }
    const message =
      ids.length === 1
        ? "Delete this record permanently? This cannot be undone."
        : `You are about to permanently delete ${ids.length} records.\n\nThis action may be irreversible. Protected and active records will not be deleted.\n\nDo you want to continue?`;
    if (!window.confirm(message)) return;

    setBusy(true);
    try {
      const result = await remove({
        data: {
          category,
          ids,
          retentionDays,
          before,
          ...(info.highRisk ? { confirm: "DELETE" as const } : {}),
        },
      });
      toast.success(
        `Deleted ${result.deleted} of ${result.requested}. Protected ${result.protected}, skipped ${result.skipped}, failed ${result.failed}.`,
      );
      setSelected([]);
      setConfirmWord("");
      await queryClient.invalidateQueries({ queryKey: ["cleanup-records"] });
      await queryClient.invalidateQueries({ queryKey: ["cleanup-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["cleanup-history"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't complete the cleanup");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <p className="font-semibold">Manual cleanup</p>
          <p className="text-sm text-muted-foreground">
            Pick what to look at, review the records, then delete one or several.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Select value={category} onValueChange={(v) => changeCategory(v as CleanupCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_CATEGORIES.map((id) => (
                  <SelectItem key={id} value={id}>
                    {CLEANUP_CATEGORY_INFO[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Older than</Label>
            <Select
              value={String(retentionDays)}
              onValueChange={(v) => {
                setRetentionDays(Number(v));
                setCustomDate("");
                setSelected([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETENTION_PRESETS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Or before this date</Label>
            <Input
              type="date"
              value={customDate}
              onChange={(event) => {
                setCustomDate(event.target.value);
                setSelected([]);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Search</Label>
            <Input
              placeholder="Search these records"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        {info.warning ? (
          <p className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{info.warning}</span>
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {(["eligible", "protected", "all"] as Filter[]).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
            >
              {value === "eligible" ? "Can be deleted" : value === "protected" ? "Protected" : "All"}
            </Button>
          ))}
        </div>

        {preview ? (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Can be deleted" value={String(preview.eligible)} />
            <Stat label="Protected" value={String(preview.protected)} />
            <Stat label="Selected" value={String(selected.length)} />
            <Stat
              label="Files affected"
              value={preview.filesAffected ? String(preview.filesAffected) : "0"}
            />
          </div>
        ) : null}

        {records.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Nothing matches this selection.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelected(eligibleVisible)}
                disabled={eligibleVisible.length === 0}
              >
                Select all eligible ({eligibleVisible.length})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear selection
              </Button>
            </div>

            {rows.map((row) => {
              const isProtected = Boolean(row.protectedReason);
              const checked = selected.includes(row.id);
              return (
                <div
                  key={row.id}
                  className="flex items-start gap-3 rounded-lg border border-border p-3"
                >
                  {isProtected ? (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      onCheckedChange={(value) =>
                        setSelected((prev) =>
                          value ? [...new Set([...prev, row.id])] : prev.filter((id) => id !== row.id),
                        )
                      }
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.label}</p>
                    {row.detail ? (
                      <p className="truncate text-xs text-muted-foreground">{row.detail}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {row.occurredAt ? new Date(row.occurredAt).toLocaleString() : "Date unknown"}
                    </p>
                    {isProtected ? (
                      <Badge variant="secondary" className="mt-1">
                        Protected · {row.protectedReason}
                      </Badge>
                    ) : null}
                  </div>
                  {isProtected ? null : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => void runDelete([row.id])}
                      aria-label="Delete this record"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {info.highRisk ? (
          <div className="space-y-1.5">
            <Label>Type DELETE to confirm</Label>
            <Input value={confirmWord} onChange={(event) => setConfirmWord(event.target.value)} />
            <p className="text-xs text-muted-foreground">
              Consider exporting or backing up important records before permanent deletion. This app
              has no built-in backup.
            </p>
          </div>
        ) : null}

        <Button
          variant="destructive"
          className="w-full"
          disabled={busy || selected.length === 0}
          onClick={() => void runDelete(selected)}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Delete selected ({selected.length})
        </Button>
      </CardContent>
    </Card>
  );
}

/** Bucket files with real reference status. Only orphans can be removed. */
export function StorageCleanupPanel() {
  const listFiles = useServerFn(cleanupListStorage);
  const removeFiles = useServerFn(cleanupDeleteFiles);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "orphaned" | "referenced" | "unknown">("orphaned");
  const [busy, setBusy] = useState(false);

  const files = useQuery({ queryKey: ["cleanup-storage"], queryFn: () => listFiles() });

  const rows = (files.data ?? []).filter((file) => filter === "all" || file.status === filter);
  const orphanKeys = rows
    .filter((file) => file.status === "orphaned")
    .map((file) => `${file.bucket}/${file.path}`);
  const selectedBytes = (files.data ?? [])
    .filter((file) => selected.includes(`${file.bucket}/${file.path}`))
    .reduce((sum, file) => sum + (file.bytes ?? 0), 0);

  const deleteKeys = async (keys: string[]) => {
    if (keys.length === 0) return;
    if (
      !window.confirm(
        `You are about to permanently delete ${keys.length} file(s).\n\nThis action may be irreversible. Files still in use will not be deleted.\n\nDo you want to continue?`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await removeFiles({ data: { keys } });
      toast.success(
        `Deleted ${result.filesDeleted} file(s). Protected ${result.protected}, failed ${result.failed}.`,
      );
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: ["cleanup-storage"] });
      await queryClient.invalidateQueries({ queryKey: ["cleanup-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["cleanup-history"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the files");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <p className="font-semibold">Storage cleanup</p>
          <p className="text-sm text-muted-foreground">
            A file is only offered for deletion when no record in your database points at it.
            Anything that cannot be verified stays protected.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["orphaned", "referenced", "unknown", "all"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
            >
              {value === "orphaned"
                ? "Unused"
                : value === "referenced"
                  ? "In use"
                  : value === "unknown"
                    ? "Unknown / protected"
                    : "All files"}
            </Button>
          ))}
        </div>

        {files.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            No files in this view.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={orphanKeys.length === 0}
                onClick={() => setSelected(orphanKeys)}
              >
                Select all unused ({orphanKeys.length})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>

            {rows.slice(0, 300).map((file) => {
              const key = `${file.bucket}/${file.path}`;
              const canDelete = file.status === "orphaned";
              return (
                <div key={key} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  {canDelete ? (
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.includes(key)}
                      onCheckedChange={(value) =>
                        setSelected((prev) =>
                          value ? [...new Set([...prev, key])] : prev.filter((k) => k !== key),
                        )
                      }
                    />
                  ) : (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.path.split("/").pop()}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {file.bucket} · {formatBytes(file.bytes)} ·{" "}
                      {file.createdAt ? new Date(file.createdAt).toLocaleDateString() : "date unknown"}
                    </p>
                    <Badge variant={canDelete ? "outline" : "secondary"} className="mt-1">
                      {file.status === "referenced"
                        ? `In use by ${file.referencedBy}`
                        : file.status === "orphaned"
                          ? "Unused — can be deleted"
                          : "Unknown / protected"}
                    </Badge>
                  </div>
                  {canDelete ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => void deleteKeys([key])}
                      aria-label="Delete this file"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Selected: {selected.length} file(s) · about {formatBytes(selectedBytes)} would be released.
        </p>
        <Button
          variant="destructive"
          className="w-full"
          disabled={busy || selected.length === 0}
          onClick={() => void deleteKeys(selected)}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Delete selected files ({selected.length})
        </Button>
      </CardContent>
    </Card>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
