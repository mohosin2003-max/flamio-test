import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PERMISSION_GROUPS,
  PERMISSION_HINTS,
  PERMISSION_LABELS,
  STAFF_PERMISSIONS,
  permissionLevel,
} from "@/lib/permissions";
import type { PermissionGrants, StaffAccessLevel, StaffPermission } from "@/lib/permissions";

type Choice = "none" | StaffAccessLevel;

const CHOICES: { value: Choice; label: string }[] = [
  { value: "none", label: "No access" },
  { value: "view", label: "View only" },
  { value: "manage", label: "Full access" },
];

/**
 * Per-person, per-section access editor. Reuses the existing
 * `ownerSetStaffPermissions` endpoint — every change saves the whole list.
 */
export function StaffPermissionEditor({
  grants,
  saving,
  onSave,
  lockedFullAccess = false,
  title = "Section access",
}: {
  grants: PermissionGrants;
  saving: boolean;
  onSave: (next: { permission: StaffPermission; level: StaffAccessLevel }[]) => Promise<void>;
  /** Owner roles have an existing full-access override. */
  lockedFullAccess?: boolean;
  title?: string;
}) {
  const [pendingBulk, setPendingBulk] = useState<Choice | null>(null);
  // Permission groups start closed; the Owner opens one at a time.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (title: string) =>
    setOpenGroups((prev) => ({ ...prev, [title]: !prev[title] }));

  const current = (permission: StaffPermission): Choice =>
    permissionLevel({ grants: grants as Record<string, string> }, permission) ?? "none";

  const toList = (map: PermissionGrants) =>
    (Object.entries(map) as [StaffPermission, StaffAccessLevel][]).map(([permission, level]) => ({
      permission,
      level,
    }));

  const save = async (next: PermissionGrants) => {
    try {
      await onSave(toList(next));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update access");
    }
  };

  const setOne = async (permission: StaffPermission, choice: Choice) => {
    const next: PermissionGrants = { ...grants };
    if (choice === "none") delete next[permission];
    else next[permission] = choice;
    await save(next);
  };

  const applyBulk = async (choice: Choice) => {
    const next: PermissionGrants = {};
    if (choice !== "none") {
      for (const permission of STAFF_PERMISSIONS) next[permission] = choice;
    }
    setPendingBulk(null);
    await save(next);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {saving ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        {!lockedFullAccess
          ? CHOICES.map((choice) => (
              <Button
                key={choice.value}
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => setPendingBulk(choice.value)}
              >
                {choice.value === "none" ? "No access to all" : `${choice.label} on all`}
              </Button>
            ))
          : null}
      </div>

      {pendingBulk ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2 text-sm">
          <span className="mr-auto">
            Set <strong>every</strong> section to{" "}
            {CHOICES.find((c) => c.value === pendingBulk)?.label.toLowerCase()}?
          </span>
          <Button type="button" size="sm" onClick={() => void applyBulk(pendingBulk)}>
            Yes, apply
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPendingBulk(null)}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="space-y-2">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1.5">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left"
              aria-expanded={!!openGroups[group.title]}
              onClick={() => toggleGroup(group.title)}
            >
              <span className="text-xs font-medium text-muted-foreground">{group.title}</span>
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                  openGroups[group.title] ? "rotate-180" : ""
                }`}
              />
            </button>
            {openGroups[group.title] ? (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {group.permissions.map((permission) => (
                  <div
                    key={permission}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5"
                  >
                    <span className="min-w-0 text-sm leading-tight">
                      {PERMISSION_LABELS[permission]}
                      {PERMISSION_HINTS[permission] ? (
                        <span className="block text-xs text-muted-foreground">
                          {PERMISSION_HINTS[permission]}
                        </span>
                      ) : null}
                    </span>
                    <Select
                      value={current(permission)}
                      disabled={saving || lockedFullAccess}
                      onValueChange={(value) => void setOne(permission, value as Choice)}
                    >
                      <SelectTrigger className="h-9 w-[130px] shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHOICES.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {lockedFullAccess
          ? "This role has Full access to every section. Change the Role to Staff to set individual section levels."
          : "View only lets this person open the section and read it; adding, editing, deleting and stock changes are refused."}
      </p>
    </div>
  );
}
