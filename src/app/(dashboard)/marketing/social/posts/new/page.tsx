import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { SocialPostForm } from "@/features/marketing/components/social-post-form";
import { connectedAccountOptions } from "@/server/marketing/social/accounts.service";
import { PERMISSIONS } from "@/server/security/permissions";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";

export const metadata: Metadata = { title: "New post | AnOps ERP" };

export default async function NewSocialPostPage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has(PERMISSIONS.MARKETING_SOCIAL_MANAGE)) {
    return <PermissionDenied backHref="/marketing/social" backLabel="Back to social" />;
  }
  const accounts = await connectedAccountOptions(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title="New post" description="Draft a post for a connected Page." />
      <SocialPostForm accounts={accounts} />
    </div>
  );
}
