"use client";

import { useToast } from "@/shared/components/ui/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { assignTagsAction } from "@/features/marketing/actions/contacts.action";
import { Button, selectClass } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { LIFECYCLE_LABELS, SOURCE_LABELS } from "@/features/marketing/labels";
import type { ContactDto } from "@/server/marketing/contact.service";
import type { TagDto } from "@/server/marketing/tag.service";

/**
 * Contact list. Table on wide screens, stacked cards on phones. Bulk tagging acts only on rows that are
 * ticked and is capped at 50, the server limit. The server re-checks permission and tenant on each call.
 */
export function ContactList({
  contacts,
  tags,
  canManage,
}: {
  contacts: ContactDto[];
  tags: TagDto[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagId, setTagId] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const allSelected = useMemo(() => contacts.length > 0 && contacts.every((contact) => selected.has(contact.id)), [contacts, selected]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });

  const applyTag = () =>
    startTransition(async () => {
      const result = await assignTagsAction({ contactIds: [...selected], tagId });
      if (!result.ok) return toast.fromError(result.error);
      toast.success(`Tag added to ${result.data.assigned} contact${result.data.assigned === 1 ? "" : "s"}.`);
      setSelected(new Set());
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {canManage && selected.size > 0 && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">{selected.size} selected (max 50)</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="bulk-tag" className="sr-only">Tag to add</label>
            <select id="bulk-tag" className={selectClass} value={tagId} onChange={(event) => setTagId(event.target.value)}>
              <option value="">Choose a tag</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
            <Button variant="primary" disabled={pending || !tagId} onClick={applyTag}>
              {pending ? "Adding…" : "Add tag"}
            </Button>
          </div>
        </div>
      )}

      <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] md:block">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[var(--color-bg-subtle)] text-xs uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            <tr>
              {canManage && (
                <th scope="col" className="w-12 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all contacts on this page"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(contacts.slice(0, 50).map((contact) => contact.id)))}
                    className="h-4 w-4 accent-[var(--color-action-primary)]"
                  />
                </th>
              )}
              <th scope="col" className="px-3 py-3">Name</th>
              <th scope="col" className="px-3 py-3">Email</th>
              <th scope="col" className="px-3 py-3">Phone</th>
              <th scope="col" className="px-3 py-3">Stage</th>
              <th scope="col" className="px-3 py-3">Source</th>
              <th scope="col" className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {contacts.map((contact) => (
              <tr key={contact.id} className="hover:bg-[var(--color-bg-subtle)]">
                {canManage && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${contact.fullName}`}
                      checked={selected.has(contact.id)}
                      onChange={() => toggle(contact.id)}
                      className="h-4 w-4 accent-[var(--color-action-primary)]"
                    />
                  </td>
                )}
                <td className="px-3 py-3 font-medium">
                  <Link href={`/marketing/contacts/${contact.id}`} className="break-words underline-offset-2 hover:underline">
                    {contact.fullName || "Unnamed contact"}
                  </Link>
                </td>
                <td className="max-w-[220px] break-all px-3 py-3 text-[var(--color-text-secondary)]">{contact.email || "—"}</td>
                <td className="px-3 py-3 text-[var(--color-text-secondary)]">{contact.phone || "—"}</td>
                <td className="px-3 py-3">{LIFECYCLE_LABELS[contact.lifecycleStage]}</td>
                <td className="px-3 py-3">{SOURCE_LABELS[contact.source]}</td>
                <td className="px-3 py-3">
                  <StatusBadge label={contact.isActive ? "Active" : "Inactive"} tone={contact.isActive ? "success" : "neutral"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {contacts.map((contact) => (
          <li key={contact.id} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
            <div className="flex items-start gap-3">
              {canManage && (
                <input
                  type="checkbox"
                  aria-label={`Select ${contact.fullName}`}
                  checked={selected.has(contact.id)}
                  onChange={() => toggle(contact.id)}
                  className="mt-1 h-5 w-5 accent-[var(--color-action-primary)]"
                />
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/marketing/contacts/${contact.id}`} className="block break-words font-semibold underline-offset-2 hover:underline">
                  {contact.fullName || "Unnamed contact"}
                </Link>
                <p className="mt-1 break-all text-sm text-[var(--color-text-secondary)]">{contact.email || "No email"}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">{contact.phone || "No phone"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusBadge label={LIFECYCLE_LABELS[contact.lifecycleStage]} tone="info" />
                  <StatusBadge label={contact.isActive ? "Active" : "Inactive"} tone={contact.isActive ? "success" : "neutral"} />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
