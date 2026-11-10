"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Lock } from "lucide-react";
import { saveMemberGrantAction } from "@/features/ai/actions/ai.action";
import { Toggle } from "@/features/ai/components/toggle";
import type { AccessMemberDto, AiGrantView } from "@/features/ai/types";
import { Button } from "@/shared/components/ui/button";
import { FieldError } from "@/shared/components/ui/form-kit";
import { useToast } from "@/shared/components/ui/toast";
import {
  AI_MODULES,
  AI_MODULE_LABELS,
  AI_OPERATIONS,
  AI_OPERATION_LABELS,
  AI_PRESETS,
  emptyModuleGrant,
  type AiModuleGrant,
  type AiModuleKey,
  type AiModules,
  type AiOperation,
  type AiPresetKey,
} from "@/shared/domain/ai";
import { cn } from "@/shared/lib/utils";

const ROLE_LABEL: Record<AccessMemberDto["companyRole"], string> = { owner: "Owner", admin: "Administrator", manager: "Manager", employee: "Employee" };

function full(modules: AiModules): Record<AiModuleKey, AiModuleGrant> {
  return Object.fromEntries(AI_MODULES.map((m) => [m, { ...emptyModuleGrant(), ...modules[m] }])) as Record<AiModuleKey, AiModuleGrant>;
}

/** Plain-language summary of what the person will be able to ask AI to do. */
export function describeAccess(modules: AiModules): string {
  const parts = AI_MODULES.flatMap((m) => {
    const ops = AI_OPERATIONS.filter((op) => modules[m]?.[op]);
    return ops.length ? [`${ops.map((o) => AI_OPERATION_LABELS[o].toLowerCase()).join(", ")} in ${AI_MODULE_LABELS[m]}`] : [];
  });
  return parts.length ? `Can ask AI to ${parts.join("; ")}.` : "Cannot use any module through AI.";
}

export function MemberEditor({
  member,
  isOwner,
  onSaved,
  onClose,
  onStale,
}: {
  member: AccessMemberDto;
  isOwner: boolean;
  onSaved: (userId: string, grant: AiGrantView) => void;
  onClose: () => void;
  onStale: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(member.grant.enabled);
  const [modules, setModules] = useState(() => full(member.grant.modules));
  const [audit, setAudit] = useState(member.grant.canAuditTranscripts);
  const [sensitive, setSensitive] = useState(member.grant.canViewSensitiveHr);
  const [cap, setCap] = useState(member.grant.dailyTokenCap === null ? "" : String(member.grant.dailyTokenCap));
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const readOnly = !member.editable;
  const canTouchFlags = isOwner && member.editable;
  const auditEligible = member.companyRole === "owner" || member.companyRole === "admin";

  const setCell = (module: AiModuleKey, op: AiOperation, value: boolean) =>
    setModules((m) => ({ ...m, [module]: { ...m[module], [op]: value } }));

  const toggleRow = (module: AiModuleKey) => {
    const allowed = AI_OPERATIONS.filter((op) => member.ceiling[module][op]);
    const allOn = allowed.length > 0 && allowed.every((op) => modules[module][op]);
    setModules((m) => ({ ...m, [module]: Object.fromEntries(AI_OPERATIONS.map((op) => [op, allowed.includes(op) ? !allOn : false])) as AiModuleGrant }));
  };

  const applyPreset = (key: AiPresetKey) => {
    const preset = AI_PRESETS[key].modules;
    setModules(
      Object.fromEntries(
        AI_MODULES.map((m) => [m, Object.fromEntries(AI_OPERATIONS.map((op) => [op, Boolean(preset[m]?.[op]) && member.ceiling[m][op]]))])
      ) as Record<AiModuleKey, AiModuleGrant>
    );
    setEnabled(true);
  };

  const summary = useMemo(() => describeAccess(enabled ? modules : {}), [enabled, modules]);

  const save = () => {
    setError(null);
    setFieldErrors({});
    const capNumber = cap.trim() === "" ? null : Number(cap);
    if (capNumber !== null && (!Number.isInteger(capNumber) || capNumber < 0)) {
      setFieldErrors({ cap: "Enter a whole number of tokens, or leave it empty to use the company default." });
      return;
    }
    start(async () => {
      const result = await saveMemberGrantAction({
        userId: member.userId,
        expectedVersion: member.grant.version,
        grant: { enabled, modules, canAuditTranscripts: audit, canViewSensitiveHr: sensitive, dailyTokenCap: capNumber },
      });
      if (result.ok) {
        toast.success("AI access saved", `${member.name}'s access takes effect immediately.`);
        onSaved(member.userId, result.data);
        return;
      }
      if (result.error.code === "CONFLICT") {
        setStale(true);
        setError(result.error.message);
        return;
      }
      setError(result.error.message);
      if (result.error.details) setFieldErrors(result.error.details);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{member.name}</p>
          <p className="truncate text-xs text-[var(--color-text-secondary)]">
            {member.email} · {ROLE_LABEL[member.companyRole]}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--color-text-primary)]">
          <span id="enable-label">AI access</span>
          <Toggle checked={enabled} onChange={setEnabled} label="AI access for this person" disabled={readOnly || pending} />
        </label>
      </div>

      {readOnly && (
        <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          {member.editBlockedReason}
        </p>
      )}

      <section aria-labelledby="preset-heading" className="space-y-2">
        <h3 id="preset-heading" className="text-sm font-semibold text-[var(--color-text-primary)]">Start from a preset</h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(AI_PRESETS) as AiPresetKey[]).map((key) => (
            <button
              key={key}
              type="button"
              disabled={readOnly || pending}
              onClick={() => applyPreset(key)}
              title={AI_PRESETS[key].description}
              className="min-h-[44px] rounded-[var(--radius-pill)] border border-[var(--color-border-control)] px-4 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {AI_PRESETS[key].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">A preset replaces the cells below and skips anything this person&apos;s role does not allow.</p>
      </section>

      <section aria-labelledby="matrix-heading" className="space-y-3">
        <h3 id="matrix-heading" className="text-sm font-semibold text-[var(--color-text-primary)]">What AI may do</h3>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Greyed cells are not allowed by this person&apos;s role in AnOps, so AI cannot be given them. Module tools are connected one at a time; access you set now applies as each one goes live.
        </p>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-text-secondary)]">
                <th scope="col" className="py-2 pr-3 font-semibold">Module</th>
                {AI_OPERATIONS.map((op) => (
                  <th key={op} scope="col" className="px-1 py-2 text-center font-semibold">{AI_OPERATION_LABELS[op]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {AI_MODULES.map((module) => (
                <tr key={module}>
                  <th scope="row" className="py-1 pr-3 text-left font-medium text-[var(--color-text-primary)]">
                    <button
                      type="button"
                      disabled={readOnly || pending}
                      onClick={() => toggleRow(module)}
                      className="min-h-[44px] text-left hover:underline focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:no-underline"
                      aria-label={`Toggle all allowed operations for ${AI_MODULE_LABELS[module]}`}
                    >
                      {AI_MODULE_LABELS[module]}
                    </button>
                  </th>
                  {AI_OPERATIONS.map((op) => (
                    <td key={op} className="px-1 text-center">
                      <Cell module={module} op={op} checked={modules[module][op]} allowed={member.ceiling[module][op]} disabled={readOnly || pending} onChange={(v) => setCell(module, op, v)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 md:hidden">
          {AI_MODULES.map((module) => (
            <fieldset key={module} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-3">
              <legend className="px-1 text-sm font-semibold text-[var(--color-text-primary)]">{AI_MODULE_LABELS[module]}</legend>
              <div className="grid grid-cols-2 gap-x-2">
                {AI_OPERATIONS.map((op) => (
                  <label key={op} className={cn("flex min-h-[44px] items-center gap-2 text-sm", member.ceiling[module][op] ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] opacity-60")}>
                    <Cell module={module} op={op} checked={modules[module][op]} allowed={member.ceiling[module][op]} disabled={readOnly || pending} onChange={(v) => setCell(module, op, v)} bare />
                    {AI_OPERATION_LABELS[op]}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {Object.keys(fieldErrors).some((k) => k.includes(".")) && <FieldError>Some selections are above what this person&apos;s role allows. Untick them and save again.</FieldError>}
        <p aria-live="polite" className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">{summary}</p>
      </section>

      <section aria-labelledby="limits-heading" className="space-y-2">
        <h3 id="limits-heading" className="text-sm font-semibold text-[var(--color-text-primary)]">Daily limit</h3>
        <label htmlFor="member-cap" className="block text-xs text-[var(--color-text-secondary)]">Tokens per day for this person. Leave empty to use the company default. 0 means no limit.</label>
        <input
          id="member-cap"
          inputMode="numeric"
          value={cap}
          disabled={readOnly || pending}
          onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="Company default"
          aria-invalid={Boolean(fieldErrors.cap)}
          className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm tabular-nums text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)] disabled:opacity-60"
        />
        <FieldError>{fieldErrors.cap}</FieldError>
      </section>

      <section aria-labelledby="sensitive-heading" className="space-y-1">
        <h3 id="sensitive-heading" className="text-sm font-semibold text-[var(--color-text-primary)]">Sensitive access</h3>
        <p className="text-xs text-[var(--color-text-secondary)]">Owner-controlled. Off by default, and separate from everything above.</p>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p id="sens-label" className="text-sm text-[var(--color-text-primary)]">HR and salary data</p>
            <p className="text-xs text-[var(--color-text-secondary)]">Lets AI read pay and other sensitive HR records for this person.</p>
          </div>
          <Toggle checked={sensitive} onChange={setSensitive} label="HR and salary data" disabled={!canTouchFlags || pending} describedBy="sens-label" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p id="audit-label" className="text-sm text-[var(--color-text-primary)]">Audit other people&apos;s conversations</p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {auditEligible ? "Read-only. Needs a written reason, is logged, and the person is notified." : "Only owners and administrators can be given this."}
            </p>
          </div>
          <Toggle checked={audit} onChange={setAudit} label="Audit other people's conversations" disabled={!canTouchFlags || !auditEligible || pending} describedBy="audit-label" />
        </div>
        {!isOwner && <p className="text-xs text-[var(--color-text-secondary)]">Only an owner can change these two switches.</p>}
      </section>

      {error && (
        <div role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-status-error-bg)] px-3 py-2 text-sm text-[var(--color-status-error)]">
          {error}
          {stale && (
            <button type="button" onClick={onStale} className="ml-2 min-h-[44px] font-semibold underline focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">
              Reload latest
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={onClose} disabled={pending}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button variant="primary" onClick={save} disabled={pending || stale}>
            {pending && <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
            {pending ? "Saving" : "Save access"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Cell({
  module,
  op,
  checked,
  allowed,
  disabled,
  onChange,
  bare,
}: {
  module: AiModuleKey;
  op: AiOperation;
  checked: boolean;
  allowed: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  bare?: boolean;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={!allowed || disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={bare ? undefined : `${AI_MODULE_LABELS[module]}: ${AI_OPERATION_LABELS[op]}`}
      title={allowed ? undefined : "Not allowed by this person's role"}
      className={cn("size-5 cursor-pointer accent-[var(--color-text-primary)] focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-40", !bare && "m-3")}
    />
  );
}
