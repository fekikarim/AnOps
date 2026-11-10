"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { saveAiSettingsAction } from "@/features/ai/actions/ai.action";
import { AuditPanel } from "@/features/ai/components/audit-panel";
import { describeAccess, MemberEditor } from "@/features/ai/components/member-editor";
import { Toggle } from "@/features/ai/components/toggle";
import type { AccessMemberDto, AiGrantView, AiSettingsView, UsageSummaryDto } from "@/features/ai/types";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { Button } from "@/shared/components/ui/button";
import { Drawer } from "@/shared/components/ui/drawer";
import { FieldError } from "@/shared/components/ui/form-kit";
import { useToast } from "@/shared/components/ui/toast";
import { AI_MODULES, AI_MODULE_LABELS, AI_OPERATIONS } from "@/shared/domain/ai";

const ROLE_LABEL = { owner: "Owner", admin: "Administrator", manager: "Manager", employee: "Employee" } as const;

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-[var(--color-text-primary)]">{label}</label>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm tabular-nums text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)] disabled:opacity-60 aria-[invalid=true]:border-[var(--color-status-error)]"
      />
      <p id={`${id}-hint`} className="text-xs text-[var(--color-text-secondary)]">{hint}</p>
      <FieldError>{error}</FieldError>
    </div>
  );
}

function statusOf(m: AccessMemberDto) {
  if (m.grant.enabled) return { label: m.grant.isDefault ? "On (owner default)" : "On", tone: "success" as const };
  return { label: "Off", tone: "neutral" as const };
}

function chips(modules: AccessMemberDto["grant"]["modules"]) {
  return AI_MODULES.flatMap((m) => {
    const ops = AI_OPERATIONS.filter((op) => modules[m]?.[op]);
    return ops.length ? [{ key: m, label: `${AI_MODULE_LABELS[m]} · ${ops.length}` }] : [];
  });
}

export function AccessAdmin({
  settings: initialSettings,
  members: initialMembers,
  usage,
  isOwner,
  canAudit,
}: {
  settings: AiSettingsView;
  members: AccessMemberDto[];
  usage: UsageSummaryDto | null;
  isOwner: boolean;
  canAudit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [settings, setSettings] = useState(initialSettings);
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [retention, setRetention] = useState(String(initialSettings.retentionDays));
  const [budget, setBudget] = useState(String(initialSettings.dailyTokenBudget));
  const [userCap, setUserCap] = useState(String(initialSettings.defaultUserDailyTokenCap));
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [members, setMembers] = useState(initialMembers);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AccessMemberDto | null>(null);

  const dirty =
    enabled !== settings.enabled ||
    retention !== String(settings.retentionDays) ||
    budget !== String(settings.dailyTokenBudget) ||
    userCap !== String(settings.defaultUserDailyTokenCap);

  const saveSettings = () => {
    setSettingsError(null);
    setFieldErrors({});
    start(async () => {
      const result = await saveAiSettingsAction({
        expectedVersion: settings.version,
        settings: {
          enabled,
          retentionDays: Number(retention),
          dailyTokenBudget: Number(budget || 0),
          defaultUserDailyTokenCap: Number(userCap || 0),
        },
      });
      if (result.ok) {
        setSettings(result.data);
        toast.success("Company AI settings saved");
        return;
      }
      setSettingsError(result.error.message);
      if (result.error.details) setFieldErrors(result.error.details);
      if (result.error.code === "CONFLICT") router.refresh();
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) : members;
  }, [members, query]);

  const nameOf = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const onSaved = (userId: string, grant: AiGrantView) => {
    setMembers((list) => list.map((m) => (m.userId === userId ? { ...m, grant } : m)));
    setEditing(null);
  };

  const budgetPct = usage && usage.today.budget > 0 ? Math.min(100, Math.round((usage.today.tokens / usage.today.budget) * 100)) : 0;

  return (
    <div className="space-y-8">
      <section aria-labelledby="company-heading" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="company-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">AnOps AI for your company</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
              Nobody can use AI while this is off. When it is on, owners can use it straight away and everyone else needs to be enabled below.
            </p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Turn AnOps AI on for the company" disabled={pending} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField id="retention" label="Keep conversations (days)" hint="7 to 730. Older conversations are removed automatically." value={retention} onChange={setRetention} error={fieldErrors.retentionDays} disabled={pending} />
          <NumberField id="budget" label="Company limit (tokens per day)" hint="Shared by everyone. 0 means no company limit." value={budget} onChange={setBudget} error={fieldErrors.dailyTokenBudget} disabled={pending} />
          <NumberField id="usercap" label="Default per-person limit" hint="Tokens per day. You can override it for each person. 0 means none." value={userCap} onChange={setUserCap} error={fieldErrors.defaultUserDailyTokenCap} disabled={pending} />
        </div>
        {settingsError && <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-status-error-bg)] px-3 py-2 text-sm text-[var(--color-status-error)]">{settingsError}</p>}
        <div className="flex justify-end">
          <Button variant="primary" onClick={saveSettings} disabled={!dirty || pending}>
            {pending && <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
            {pending ? "Saving" : "Save company settings"}
          </Button>
        </div>
      </section>

      <section aria-labelledby="people-heading" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="people-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">People</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">Changes apply immediately, including in conversations that are already open.</p>
          </div>
          <div className="relative sm:w-72">
            <label htmlFor="people-search" className="sr-only">Search people</label>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              id="people-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] pr-3 pl-9 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p role="status" className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] p-6 text-center text-sm text-[var(--color-text-secondary)]">No one matches &ldquo;{query}&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {filtered.map((m) => {
              const status = statusOf(m);
              const moduleChips = chips(m.grant.modules);
              return (
                <li key={m.userId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                        {m.name}
                        {m.isSelf && <span className="font-normal text-[var(--color-text-secondary)]"> (you)</span>}
                      </p>
                      <StatusBadge label={ROLE_LABEL[m.companyRole]} tone="info" />
                      <StatusBadge label={status.label} tone={status.tone} />
                    </div>
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">{m.email}</p>
                    <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
                      {m.grant.enabled ? (moduleChips.length ? moduleChips.map((c) => c.label).join("  ·  ") : "Enabled, no modules selected") : "No AI access"}
                      {m.grant.dailyTokenCap !== null && <span className="tabular-nums">  ·  {m.grant.dailyTokenCap.toLocaleString()} tokens/day</span>}
                    </p>
                  </div>
                  <Button onClick={() => setEditing(m)} aria-label={`${m.editable ? "Manage" : "View"} AI access for ${m.name}`} className="sm:w-auto">
                    {m.editable ? "Manage access" : "View access"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {usage && (
        <section aria-labelledby="usage-heading" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
          <div>
            <h2 id="usage-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">Usage today</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">Counts only. Message content is never shown here. Resets at midnight UTC.</p>
          </div>
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">{usage.today.tokens.toLocaleString()} tokens</span>
              <span className="text-[var(--color-text-secondary)]">{usage.today.budget > 0 ? `of ${usage.today.budget.toLocaleString()}` : "no company limit"}</span>
            </div>
            {usage.today.budget > 0 && (
              <div role="progressbar" aria-label="Company tokens used today" aria-valuemin={0} aria-valuemax={usage.today.budget} aria-valuenow={Math.min(usage.today.tokens, usage.today.budget)} className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
                <div className={budgetPct >= 90 ? "h-full bg-[var(--color-status-error)]" : "h-full bg-[var(--color-action-primary)]"} style={{ width: `${budgetPct}%` }} />
              </div>
            )}
            <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
              Tokens are measured from what the provider reported.
              {usage.today.estimatedCost && (
                <> Estimated cost today: <span className="font-medium tabular-nums text-[var(--color-text-primary)]">{usage.today.estimatedCost.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {usage.today.estimatedCost.currency}</span> (an estimate from the configured price, not a bill).</>
              )}
            </p>
          </div>
          {usage.byModel.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] text-sm">
                <caption className="sr-only">Measured tokens by provider and model, last 7 days</caption>
                <thead>
                  <tr className="text-left text-xs text-[var(--color-text-secondary)]">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Provider and model (7 days)</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Calls</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byModel.map((m) => (
                    <tr key={`${m.provider}/${m.model}`} className="border-t border-[var(--color-border-subtle)]">
                      <td className="py-1.5 pr-3 break-all text-[var(--color-text-primary)]">{m.provider} · {m.model}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{m.calls.toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">{m.tokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {usage.members.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <caption className="sr-only">AI usage by person today</caption>
                <thead>
                  <tr className="text-left text-xs text-[var(--color-text-secondary)]">
                    <th scope="col" className="py-2 pr-3 font-semibold">Person</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Tokens</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Requests</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Actions</th>
                    <th scope="col" className="py-2 pl-2 text-right font-semibold">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)] tabular-nums">
                  {usage.members.map((r) => (
                    <tr key={r.userId}>
                      <th scope="row" className="py-2 pr-3 text-left font-medium text-[var(--color-text-primary)]">{nameOf.get(r.userId) ?? "Former member"}</th>
                      <td className="px-2 py-2 text-right">{r.tokens.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right">{r.requests}</td>
                      <td className="px-2 py-2 text-right">{r.toolCalls}</td>
                      <td className="py-2 pl-2 text-right">{r.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canAudit && <AuditPanel members={members} />}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `AI access: ${editing.name}` : "AI access"}
        description={editing ? describeAccess(editing.grant.enabled ? editing.grant.modules : {}) : undefined}
      >
        {editing && (
          <MemberEditor
            key={`${editing.userId}-${editing.grant.version}`}
            member={editing}
            isOwner={isOwner}
            onSaved={onSaved}
            onClose={() => setEditing(null)}
            onStale={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
