import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listTags } from "@/server/marketing/tag.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { TagManager } from "@/features/marketing/components/tag-manager";
import { PERMISSIONS } from "@/server/security/permissions";

export const metadata: Metadata = { title: "Tags | AnOps ERP" };

export default async function TagsPage() {
  const ctx = await getPageWorkspace();
  const tags = await listTags(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title="Tags" description="Group contacts by interest, segment or source. A contact can have many tags at once." />
      <TagManager tags={tags} canManage={ctx.permissions.has(PERMISSIONS.MARKETING_TAG_MANAGE)} />
    </div>
  );
}
