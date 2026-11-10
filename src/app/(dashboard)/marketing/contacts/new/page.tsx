import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { ContactForm } from "@/features/marketing/components/contact-form";
import { PERMISSIONS } from "@/server/security/permissions";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";

export const metadata: Metadata = { title: "New contact | AnOps ERP" };

export default async function NewContactPage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has(PERMISSIONS.MARKETING_CONTACT_MANAGE)) {
    return <PermissionDenied backHref="/marketing/contacts" backLabel="Back to contacts" />;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="New contact" description="Add a person who may receive your messages. Consent is recorded separately." />
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6">
        <ContactForm mode="create" />
      </section>
    </div>
  );
}
