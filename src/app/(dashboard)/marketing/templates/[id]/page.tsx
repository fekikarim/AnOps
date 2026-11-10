import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getTemplate } from "@/server/marketing/template.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { TemplateForm } from "@/features/marketing/components/template-form";
import { PERMISSIONS } from "@/server/security/permissions";
import { orNotFound } from "@/server/marketing/page-guard";

export const metadata: Metadata = { title: "Template | AnOps ERP" };

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  const template = await orNotFound(() => getTemplate(ctx, id));
  return (
    <div className="space-y-6">
      <PageHeader title={template.name} description={`Version ${template.version}. Editing creates a new version; campaigns keep the text they copied.`} />
      <TemplateForm template={template} canManage={ctx.permissions.has(PERMISSIONS.MARKETING_TEMPLATE_MANAGE)} />
    </div>
  );
}
