import Link from "next/link";
import { AI_AUDIT_EVENT_TYPES, type AiAuditEntry } from "@/features/hr/ai/types";

const PROVIDERS = ["Groq", "OpenRouter", "Gemini"];
const inputClass =
  "min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)]";

function statusClass(status: string): string {
  if (["ok", "CONFIRMED", "PENDING"].includes(status)) {
    return "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]";
  }
  if (status === "BLOCKED" || status === "FAILED") {
    return "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]";
  }
  return "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]";
}

function EntryDetail({ entry }: { entry: AiAuditEntry }) {
  return (
    <details className="text-[11px] text-[var(--color-text-secondary)]">
      <summary className="cursor-pointer select-none font-semibold">Details</summary>
      <dl className="mt-1 space-y-0.5">
        <div>Model: {entry.model ?? "n/a"}</div>
        <div>Latency: {entry.latencyMs ? `${entry.latencyMs} ms` : "n/a"}</div>
        <div>Role: {entry.role}</div>
        <div className="break-all">Conversation: {entry.conversationId ?? "n/a"}</div>
        <div className="break-all">Arguments: {entry.arguments ? JSON.stringify(entry.arguments) : "none"}</div>
      </dl>
    </details>
  );
}

export function AiActivityView({
  entries,
  actorNames,
  filter,
}: {
  entries: AiAuditEntry[];
  actorNames: string[];
  filter: Record<string, string | undefined>;
}) {
  return (
    <>
      <form
        method="get"
        className="grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 md:grid-cols-6"
      >
        <label className="text-[11px] font-bold text-[var(--color-text-secondary)]">
          Event
          <select name="eventType" defaultValue={filter.eventType ?? ""} className={inputClass}>
            <option value="">All</option>
            {AI_AUDIT_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-bold text-[var(--color-text-secondary)]">
          User
          <select name="actorName" defaultValue={filter.actorName ?? ""} className={inputClass}>
            <option value="">All</option>
            {actorNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-bold text-[var(--color-text-secondary)]">
          Tool
          <input name="toolName" defaultValue={filter.toolName ?? ""} placeholder="create_leave_draft" className={inputClass} />
        </label>
        <label className="text-[11px] font-bold text-[var(--color-text-secondary)]">
          Provider
          <select name="provider" defaultValue={filter.provider ?? ""} className={inputClass}>
            <option value="">All</option>
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>{provider}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-bold text-[var(--color-text-secondary)]">
          From
          <input type="date" name="from" defaultValue={filter.from ?? ""} className={inputClass} />
        </label>
        <label className="text-[11px] font-bold text-[var(--color-text-secondary)]">
          To
          <input type="date" name="to" defaultValue={filter.to ?? ""} className={inputClass} />
        </label>
        <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-6">
          <Link
            href="/hr/ai-activity"
            className="flex min-h-[44px] items-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-4 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
          >
            Reset
          </Link>
          <button
            type="submit"
            className="min-h-[44px] rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors"
          >
            Apply filters
          </button>
        </div>
      </form>

      {entries.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
          No AI activity matches these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[var(--color-bg-subtle)] text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-3 py-2.5 font-bold">Time</th>
                <th className="px-3 py-2.5 font-bold">User</th>
                <th className="px-3 py-2.5 font-bold">Event</th>
                <th className="px-3 py-2.5 font-bold">Tool</th>
                <th className="px-3 py-2.5 font-bold">Status</th>
                <th className="px-3 py-2.5 font-bold">Provider</th>
                <th className="px-3 py-2.5 font-bold">More</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)] text-[var(--color-text-primary)]">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2.5">{entry.createdAt.slice(0, 19).replace("T", " ")} UTC</td>
                  <td className="px-3 py-2.5">{entry.actorName}</td>
                  <td className="px-3 py-2.5 font-semibold">{entry.eventType}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px]">{entry.toolName ?? "n/a"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(entry.resultStatus)}`}>
                      {entry.resultStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{entry.provider ?? "n/a"}</td>
                  <td className="px-3 py-2.5">
                    <EntryDetail entry={entry} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
