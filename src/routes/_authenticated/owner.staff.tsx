import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
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
import { StaffPermissionEditor } from "@/components/owner/StaffPermissionEditor";
import {
  ownerCreateStaffAccount,
  ownerDeleteInvite,
  ownerListStaff,
  ownerRevokeStaff,
  ownerSetStaffPermissions,
  ownerSetStaffRole,
} from "@/lib/staff.functions";
import type { StaffRole } from "@/lib/staff.functions";
import type { PermissionGrants, StaffAccessLevel, StaffPermission } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/owner/staff")({
  head: () => ({
    meta: [
      { title: "Team Access — Flamio Owner Dashboard" },
      { name: "description", content: "Manage Flamio staff roles and permissions." },
      { property: "og:title", content: "Team Access — Flamio Owner Dashboard" },
      { property: "og:description", content: "Manage Flamio staff roles and permissions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerStaff,
});

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Manager",
  staff: "Staff",
};

function OwnerStaff() {
  const listStaff = useServerFn(ownerListStaff);
  const setRole = useServerFn(ownerSetStaffRole);
  const revoke = useServerFn(ownerRevokeStaff);
  const createStaff = useServerFn(ownerCreateStaffAccount);
  const deleteInvite = useServerFn(ownerDeleteInvite);
  const setPermissions = useServerFn(ownerSetStaffPermissions);
  const queryClient = useQueryClient();

  const [staffName, setStaffName] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [inviteRole, setInviteRole] = useState<StaffRole>("staff");
  const [newGrants, setNewGrants] = useState<PermissionGrants>({});
  const [busy, setBusy] = useState(false);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  // Which team member's permission details are open — closed until the Owner taps a person.
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: ["owner-staff"],
    queryFn: () => listStaff(),
    // Always show the levels saved in the database, never a cached copy.
    staleTime: 0,
    refetchOnMount: "always",
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owner-staff"] });
    await queryClient.invalidateQueries({ queryKey: ["owner-access"] });
  };

  if (staff.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (staff.error || !staff.data) {
    return (
      <EmptyState
        title="Couldn't load the team"
        description="Please try again."
        action={<Button onClick={() => void staff.refetch()}>Retry</Button>}
      />
    );
  }

  const { members, invites, me } = staff.data;

  const handleAdd = async () => {
    const phone = invitePhone.trim();
    if (staffName.trim().length < 2) {
      toast.error("Enter the staff member's name");
      return;
    }
    if (phone.length < 6) {
      toast.error("Enter a phone number");
      return;
    }
    if (initialPassword.length < 8) {
      toast.error("Initial password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      const result = await createStaff({
        data: {
          fullName: staffName.trim(),
          phone,
          email: staffEmail.trim() || null,
          password: initialPassword,
          role: inviteRole,
          grants: Object.entries(newGrants).map(([permission, level]) => ({
            permission: permission as StaffPermission,
            level: level as StaffAccessLevel,
          })),
        },
      });
      toast.success(
        result.existingAccount
          ? "Existing account linked to staff access"
          : "Staff account created — share the login and initial password privately",
      );
      setStaffName("");
      setInvitePhone("");
      setStaffEmail("");
      setInitialPassword("");
      setNewGrants({});
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add this person");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Add a team member</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Create their secure login and choose exactly which dashboard sections they can use.
            The password is sent only to the authentication provider and is never shown again.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="staff-name">Staff name</Label>
            <Input
              id="staff-name"
              value={staffName}
              autoComplete="name"
              onChange={(event) => setStaffName(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
            <Label htmlFor="staff-phone">Phone number</Label>
            <Input
              id="staff-phone"
              value={invitePhone}
              placeholder="01XXXXXXXXX"
              inputMode="tel"
              autoComplete="tel"
              onChange={(event) => setInvitePhone(event.target.value)}
            />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Email (optional)</Label>
              <Input
                id="staff-email"
                type="email"
                value={staffEmail}
                autoComplete="email"
                onChange={(event) => setStaffEmail(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="staff-password">Initial password</Label>
              <Input
                id="staff-password"
                type="password"
                value={initialPassword}
                autoComplete="new-password"
                onChange={(event) => setInitialPassword(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as StaffRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff (kitchen & orders)</SelectItem>
                <SelectItem value="admin">Manager (full dashboard)</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
            </div>
          </div>
          <StaffPermissionEditor
            grants={newGrants}
            saving={busy}
            title="Initial section access"
            onSave={async (next) => {
              setNewGrants(Object.fromEntries(next.map((grant) => [grant.permission, grant.level])));
            }}
          />
          <Button className="w-full" disabled={busy} onClick={handleAdd}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Team ({members.length})</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has dashboard access yet.</p>
        ) : (
          members.map((member) => (
            <Card key={member.userId}>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    aria-expanded={expandedMember === member.userId}
                    onClick={() =>
                      setExpandedMember(expandedMember === member.userId ? null : member.userId)
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {member.fullName ?? "Unnamed account"}
                        {member.userId === me ? " (you)" : ""}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {member.phone ?? member.email ?? "No contact saved"}
                      </span>
                    </span>
                    <ChevronDown
                      className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                        expandedMember === member.userId ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <div className="flex flex-wrap gap-1">
                    {member.roles.map((role) => (
                      <Badge key={role} variant="secondary">
                        {ROLE_LABEL[role]}
                      </Badge>
                    ))}
                  </div>
                </div>

                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Role
                </p>
                <div className="flex items-center gap-2">
                  <Select
                    value={member.roles[0] ?? "staff"}
                    onValueChange={async (value) => {
                      try {
                        const res = await setRole({
                          data: { userId: member.userId, role: value as StaffRole },
                        });
                        if (!res.ok) {
                          toast.error(res.message ?? "Couldn't update access");
                          return;
                        }
                        await invalidate();
                        toast.success("Access updated");

                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Couldn't update access",
                        );
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="staff">Staff</SelectItem>
                      <SelectItem value="admin">Manager</SelectItem>
                      <SelectItem value="owner">Owner</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={member.userId === me}
                    onClick={async () => {
                      if (!confirm(`Remove dashboard access for ${member.fullName ?? "this person"}?`))
                        return;
                      try {
                        await revoke({ data: { userId: member.userId } });
                        await invalidate();
                        toast.success("Access removed");
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Couldn't remove access",
                        );
                      }
                    }}
                  >
                    Remove access
                  </Button>
                </div>

                {expandedMember === member.userId ? (
                  <StaffPermissionEditor
                    grants={member.grants}
                    saving={savingFor === member.userId}
                    lockedFullAccess={member.roles.includes("owner")}
                    onSave={async (next) => {
                      setSavingFor(member.userId);
                      try {
                        await setPermissions({ data: { userId: member.userId, grants: next } });
                        await invalidate();
                      } finally {
                        setSavingFor(null);
                      }
                    }}
                  />
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Pending invites ({invites.length})</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invites.</p>
        ) : (
          invites.map((invite) => (
            <Card key={invite.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{invite.phone}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {invite.note ?? "No note"}
                    {invite.matchedUserId ? " · account found" : " · waiting for sign-up"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {invite.matchedUserId ? (
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const res = await setRole({
                            data: { userId: invite.matchedUserId as string, role: "staff" },
                          });
                          if (!res.ok) {
                            toast.error(res.message ?? "Couldn't grant access");
                            return;
                          }

                          await deleteInvite({ data: { id: invite.id } });
                          await invalidate();
                          toast.success("Staff access granted");
                        } catch (error) {
                          toast.error(
                            error instanceof Error ? error.message : "Couldn't grant access",
                          );
                        }
                      }}
                    >
                      Grant staff access
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await deleteInvite({ data: { id: invite.id } });
                        await invalidate();
                      } catch {
                        toast.error("Couldn't remove this invite");
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
