import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { TemplateForm } from "@/features/marketing/components/template-form";
import { PERMISSIONS } from "@/server/security/permissions";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";

export const metadata: Metadata = { title: "New template | AnOps ERP" };

export default async function NewTemplatePage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has(PERMISSIONS.MARKETING_TEMPLATE_MANAGE)) {
    return <PermissionDenied backHref="/marketing/templates" backLabel="Back to templates" />;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="New template" description="Write plain text, pick a design, and preview the email as you type." />
      <TemplateForm canManage />
    </div>
  );
}
