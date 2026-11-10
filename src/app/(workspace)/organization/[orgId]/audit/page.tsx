import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPageOrganization, isOrgManager } from "@/server/platform/access";
import { listAuditEvents } from "@/server/platform/organization.service";

export const metadata: Metadata = { title: "Audit log" };

const humanize = (action: string) => action.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());

export default async function AuditPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ before?: string }> }) {
  const { orgId } = await params;
  const { before } = await searchParams;
  const access = await getPageOrganization(orgId);
  if (!isOrgManager(access)) notFound();
  const { items, next } = await listAuditEvents(access, before);

  return (
    <section className="rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]" aria-labelledby="audit-title">
      <div className="px-5 pt-5 sm:px-6">
        <h2 id="audit-title" className="text-base font-semibold text-[var(--color-text-primary)]">
          Audit log
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Sensitive actions in this organization, newest first. Records are retained even when data is deleted.</p>
      </div>
      {items.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-[var(--color-text-secondary)]">No events yet.</p>
      ) : (
        <ol className="mt-4 divide-y divide-[var(--color-border-subtle)]">
          {items.map((item) => (
            <li key={item.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr] sm:px-6">
              <time dateTime={item.occurredAt} className="text-xs tabular-nums text-[var(--color-text-secondary)]">
                {new Date(item.occurredAt).toLocaleString()}
              </time>
              <div className="min-w-0">
                <p className="text-sm text-[var(--color-text-primary)]">
                  <strong>{item.actorName}</strong> · {humanize(item.action)}
                </p>
                {item.details && <p className="truncate text-xs text-[var(--color-text-secondary)]">{item.details}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="flex justify-between border-t border-[var(--color-border-subtle)] px-5 py-3 text-sm sm:px-6">
        {before ? (
          <Link href={`/organization/${orgId}/audit`} className="font-semibold text-[var(--color-text-primary)] underline">
            Newest
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/organization/${orgId}/audit?before=${next}`} className="font-semibold text-[var(--color-text-primary)] underline">
            Older events →
          </Link>
        )}
      </div>
    </section>
  );
}
