"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  changeMemberRoleAction,
  leaveOrganizationAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  setMemberAppAccessAction,
  setMemberSuspendedAction,
} from "@/features/platform/actions/organization.action";
import { InviteRows } from "@/features/platform/components/invite-rows";
import type { InvitationView } from "@/server/platform/invitation.service";
import type { MemberView } from "@/server/platform/organization.service";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { useToast } from "@/shared/components/ui/toast";
import { getApplication, type ApplicationId } from "@/shared/domain/applications";
import type { ActionResult } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";

const ROLE_LABEL = { owner: "Owner", admin: "Administrator", manager: "Manager", employee: "Employee" } as const;
const card = "rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]";

export function MembersManager({
  orgId,
  viewerRole,
  members,
  invitations,
  orgApps,
  activationPending,
}: {
  orgId: string;
  viewerRole: "owner" | "admin" | "manager" | "employee";
  members: MemberView[];
  invitations: InvitationView[];
  orgApps: ApplicationId[];
  activationPending: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [editingApps, setEditingApps] = useState<string | null>(null);
  const manager = viewerRole === "owner" || viewerRole === "admin";

  const run = (label: string, action: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(label);
        router.refresh();
      } else toast.fromError(result.error);
    });

  const canManage = (m: MemberView) => manager && !m.isSelf && m.role !== "owner" && !(m.role === "admin" && viewerRole !== "owner");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? members.filter((m) => `${m.name} ${m.email} ${m.jobTitle ?? ""} ${m.role}`.toLowerCase().includes(term)) : members;
  }, [members, query]);

  return (
    <div className="space-y-6">
      {manager && (
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="invite-title">
          <h2 id="invite-title" className="text-base font-semibold text-[var(--color-text-primary)]">
            Invite people
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Unlimited users. Links are single-use and expire after 7 days.</p>
          <div className="mt-5">
            {activationPending ? (
              <p className="rounded-[12px] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">Activate your organization from the email we sent before inviting colleagues.</p>
            ) : (
              <InviteRows canInviteAdmins={viewerRole === "owner"} onDone={() => router.refresh()} />
            )}
          </div>
        </section>
      )}

      {manager && invitations.length > 0 && (
        <section className={card} aria-labelledby="pending-title">
          <h2 id="pending-title" className="px-5 pt-5 text-base font-semibold text-[var(--color-text-primary)] sm:px-6">
            Pending invitations
          </h2>
          <ul className="mt-3 divide-y divide-[var(--color-border-subtle)]">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{inv.email}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {ROLE_LABEL[inv.role]} · {inv.status === "expired" ? "Expired" : `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`} · sent {inv.sendCount}×
                  </p>
                </div>
                <button type="button" disabled={pending} onClick={() => run("Invitation resent", () => resendInvitationAction(orgId, inv.id))} className="min-h-[36px] rounded-[8px] border border-[var(--color-border-control)] px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] disabled:opacity-60">
                  Resend
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void confirmAction({
                      title: "Cancel this invitation?",
                      message: `The link sent to ${inv.email} will stop working.`,
                      tone: "warning",
                      confirmLabel: "Cancel invitation",
                      cancelLabel: "Keep invitation",
                    }).then((ok) => ok && run("Invitation cancelled", () => revokeInvitationAction(orgId, inv.id)))
                  }
                  className="min-h-[36px] rounded-[8px] px-3 text-sm font-medium text-[var(--color-status-error-fg)] hover:bg-[var(--color-status-error-bg)] disabled:opacity-60"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card} aria-labelledby="members-title">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
          <h2 id="members-title" className="text-base font-semibold text-[var(--color-text-primary)]">
            Members <span className="font-normal text-[var(--color-text-secondary)]">· {members.length}</span>
          </h2>
          <label className="w-full sm:w-64">
            <span className="sr-only">Search members</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members" className="h-10 w-full rounded-full border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-4 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]" />
          </label>
        </div>
        {filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-[var(--color-text-secondary)]">No member matches “{query}”.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-border-subtle)]">
            {filtered.map((m) => (
              <li key={m.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-subtle)] text-sm font-bold text-[var(--color-text-primary)]">
                    {m.name
                      .split(" ")
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/organization/${orgId}/members/${m.id}`} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] hover:underline">
                      {m.name}
                      {m.isSelf && <span className="text-xs font-normal text-[var(--color-text-secondary)]">(you)</span>}
                      {m.status === "suspended" && <span className="rounded-full bg-[var(--color-status-error-bg)] px-2 py-0.5 text-[11px] text-[var(--color-status-error)]">Suspended</span>}
                      {!m.emailVerified && <span className="rounded-full bg-[var(--color-status-warning-bg)] px-2 py-0.5 text-[11px] text-[var(--color-status-warning)]">Email unconfirmed</span>}
                    </Link>
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">
                      {m.email}
                      {m.jobTitle ? ` · ${m.jobTitle}` : ""}
                      {m.joinedAt ? ` · joined ${new Date(m.joinedAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", m.aiEnabled ? "bg-[var(--color-action-primary)] text-[#111F1D]" : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]")}>AI {m.aiEnabled ? "on" : "off"}</span>
                  {canManage(m) ? (
                    <label>
                      <span className="sr-only">Role for {m.name}</span>
                      <select
                        value={m.role}
                        disabled={pending}
                        onChange={(e) => run("Role updated", () => changeMemberRoleAction(orgId, m.id, e.target.value))}
                        className="h-9 rounded-[8px] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-2 text-sm text-[var(--color-text-primary)]"
                      >
                        {viewerRole === "owner" && <option value="admin">Administrator</option>}
                        <option value="manager">Manager</option>
                        <option value="employee">Employee</option>
                      </select>
                    </label>
                  ) : (
                    <span className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)]">{ROLE_LABEL[m.role]}</span>
                  )}
                </div>
                {canManage(m) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-[52px] text-sm">
                    <span className="text-xs text-[var(--color-text-secondary)]">Apps: {m.appAccess ? m.appAccess.map((id) => getApplication(id).name).join(", ") || "none" : "all organization apps"}</span>
                    <button type="button" onClick={() => setEditingApps(editingApps === m.id ? null : m.id)} className="text-xs font-semibold text-[var(--color-text-primary)] underline underline-offset-2">
                      {editingApps === m.id ? "Close" : "Edit access"}
                    </button>
                    <span className="mx-1 text-[var(--color-border-control)]">|</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(m.status === "suspended" ? "Member reactivated" : "Member suspended", () => setMemberSuspendedAction(orgId, m.id, m.status !== "suspended"))}
                      className="text-xs font-semibold text-[var(--color-text-primary)] underline underline-offset-2"
                    >
                      {m.status === "suspended" ? "Reactivate" : "Suspend"}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void confirmAction({
                          title: `Remove ${m.name}?`,
                          message: "Their records stay, but they lose access to this organization immediately.",
                          tone: "danger",
                          confirmLabel: "Remove member",
                        }).then((ok) => ok && run("Member removed", () => removeMemberAction(orgId, m.id)))
                      }
                      className="text-xs font-semibold text-[var(--color-status-error-fg)] underline underline-offset-2"
                    >
                      Remove
                    </button>
                  </div>
                )}
                {editingApps === m.id && (
                  <AppAccessEditor
                    orgApps={orgApps}
                    value={m.appAccess}
                    pending={pending}
                    onSave={(apps) => {
                      setEditingApps(null);
                      run("Application access updated", () => setMemberAppAccessAction(orgId, m.id, apps));
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-[var(--color-border-subtle)] px-5 py-3 text-xs text-[var(--color-text-secondary)] sm:px-6">
          AI permissions per person are managed in{" "}
          <Link href="/ai/access" className="font-semibold text-[var(--color-text-primary)] underline">
            AnOps AI → Access and limits
          </Link>
          . Effective AI access is the intersection of your plan, the organization switch, each person&apos;s grant and their role.
        </p>
      </section>
      {viewerRole !== "owner" && (
        <section className={cn(card, "flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6")} aria-labelledby="leave-title">
          <div>
            <h2 id="leave-title" className="text-base font-semibold text-[var(--color-text-primary)]">
              Leave this organization
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">You lose access immediately. An owner or administrator can invite you again.</p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void confirmAction({
                title: "Leave this organization?",
                message: "You will lose access to its applications and data.",
                tone: "danger",
                confirmLabel: "Leave organization",
              }).then(
                (ok) =>
                  ok &&
                  start(async () => {
                    const result = await leaveOrganizationAction(orgId);
                    if (result.ok) {
                      toast.success("You left the organization");
                      router.push("/anops");
                      router.refresh();
                    } else toast.fromError(result.error);
                  })
              )
            }
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-status-error-fg)]/50 px-5 text-sm font-semibold text-[var(--color-status-error-fg)] transition-colors hover:bg-[var(--color-status-error-bg)] disabled:opacity-60"
          >
            Leave organization
          </button>
        </section>
      )}
    </div>
  );
}

function AppAccessEditor({ orgApps, value, pending, onSave }: { orgApps: ApplicationId[]; value: ApplicationId[] | null; pending: boolean; onSave: (apps: ApplicationId[] | null) => void }) {
  const [all, setAll] = useState(value === null);
  const [selected, setSelected] = useState<ApplicationId[]>(value ?? orgApps);
  return (
    <div className="mt-3 ml-[52px] rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-4">
      <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4 accent-[#111F1D]" />
        All applications in the organization&apos;s plan (including future ones)
      </label>
      {!all && (
        <div className="mt-3 flex flex-wrap gap-2">
          {orgApps.map((id) => {
            const on = selected.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected((cur) => (on ? cur.filter((x) => x !== id) : [...cur, id]))}
                className={cn("inline-flex min-h-[36px] items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-medium", on ? "border-[var(--color-text-primary)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]" : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]")}
              >
                <AnimatedIcon icon={getApplication(id).icon} size={24} play="never" />
                {getApplication(id).name}
              </button>
            );
          })}
        </div>
      )}
      <button type="button" disabled={pending} onClick={() => onSave(all ? null : selected)} className="mt-4 inline-flex min-h-[36px] items-center rounded-[8px] bg-[var(--color-action-primary)] px-4 text-sm font-semibold text-[#111F1D] disabled:opacity-60">
        Save access
      </button>
    </div>
  );
}
