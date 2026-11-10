import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listContacts } from "@/server/marketing/contact.service";
import { listTags } from "@/server/marketing/tag.service";
import { contactListQuerySchema } from "@/features/marketing/schemas/marketing.schema";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { Pagination } from "@/shared/components/data-display/pagination";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { ContactList } from "@/features/marketing/components/contact-list";
import { CONTACT_SOURCES, LIFECYCLE_STAGES } from "@/features/marketing/types/constants";
import { LIFECYCLE_LABELS, SOURCE_LABELS } from "@/features/marketing/labels";
import { selectClass, buttonClass } from "@/shared/components/ui/button";
import { PERMISSIONS } from "@/server/security/permissions";

export const metadata: Metadata = { title: "Contacts | AnOps ERP" };

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const query = contactListQuerySchema.parse({
    q: single(raw.q),
    lifecycle: single(raw.lifecycle) || undefined,
    source: single(raw.source) || undefined,
    active: single(raw.active) || undefined,
    tagMode: single(raw.tagMode) || undefined,
    sort: single(raw.sort) || undefined,
    dir: single(raw.dir) || undefined,
    page: single(raw.page) || undefined,
  });
  const tagParam = single(raw.tags);
  const [result, tags] = await Promise.all([listContacts(ctx, query, tagParam), listTags(ctx)]);
  const canManage = ctx.permissions.has(PERMISSIONS.MARKETING_CONTACT_MANAGE);
  const filterParams = { q: query.q, lifecycle: query.lifecycle, source: query.source, active: query.active, tags: tagParam || undefined, tagMode: query.tagMode, sort: query.sort, dir: query.dir };
  const activeTagIds = new Set(tagParam.split(",").filter(Boolean));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        description="One record per person in this company. Campaigns, consent and tags all use this record."
        actions={canManage ? <Link href="/marketing/contacts/new" className={buttonClass("primary")}>New contact</Link> : undefined}
      />

      <form method="get" role="search" className="grid gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:grid-cols-2 xl:grid-cols-6">
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="q" className="text-sm font-semibold">Search</label>
          <input id="q" name="q" defaultValue={query.q} maxLength={80} placeholder="Name, email or phone" className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lifecycle" className="text-sm font-semibold">Stage</label>
          <select id="lifecycle" name="lifecycle" defaultValue={query.lifecycle} className={selectClass}>
            <option value="all">All stages</option>
            {LIFECYCLE_STAGES.map((stage) => <option key={stage} value={stage}>{LIFECYCLE_LABELS[stage]}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="source" className="text-sm font-semibold">Source</label>
          <select id="source" name="source" defaultValue={query.source} className={selectClass}>
            <option value="all">All sources</option>
            {CONTACT_SOURCES.map((source) => <option key={source} value={source}>{SOURCE_LABELS[source]}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="active" className="text-sm font-semibold">Status</label>
          <select id="active" name="active" defaultValue={query.active} className={selectClass}>
            <option value="all">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="sort" className="text-sm font-semibold">Sort by</label>
          <select id="sort" name="sort" defaultValue={query.sort} className={selectClass}>
            <option value="created">Newest</option>
            <option value="name">Name</option>
            <option value="email">Email</option>
          </select>
        </div>
        {tags.length > 0 && (
          <fieldset className="space-y-2 sm:col-span-2 xl:col-span-6">
            <legend className="text-sm font-semibold">Tags</legend>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <label key={tag.id} className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-border-control)] px-3 text-sm">
                  <input type="checkbox" name="tags" value={tag.id} defaultChecked={activeTagIds.has(tag.id)} className="h-4 w-4 accent-[var(--color-action-primary)]" />
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label htmlFor="tagMode" className="font-semibold">Match</label>
              <select id="tagMode" name="tagMode" defaultValue={query.tagMode} className={selectClass}>
                <option value="any">Any selected tag</option>
                <option value="all">All selected tags</option>
              </select>
            </div>
          </fieldset>
        )}
        <div className="flex gap-2 sm:col-span-2 xl:col-span-6 xl:justify-end">
          <button type="submit" className={buttonClass("primary")}>Apply filters</button>
          <Link href="/marketing/contacts" className={buttonClass("secondary")}>Reset</Link>
        </div>
      </form>

      {result.items.length === 0 ? (
        <EmptyState
          title="No contacts match"
          description={canManage ? "Add your first contact, or change the filters." : "No contacts match these filters."}
          actionHref={canManage ? "/marketing/contacts/new" : undefined}
          actionLabel={canManage ? "Add a contact" : undefined}
        />
      ) : (
        <ContactList contacts={result.items} tags={tags} canManage={canManage} />
      )}
      <Pagination basePath="/marketing/contacts" page={result.page} totalPages={result.totalPages} params={{ ...filterParams, page: undefined } as Record<string, string | undefined>} />
    </div>
  );
}
