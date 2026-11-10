import type { Metadata } from "next";
import { MembersManager } from "@/features/platform/components/members-manager";
import { getPageOrganization, isOrgManager } from "@/server/platform/access";
import { listInvitations } from "@/server/platform/invitation.service";
import { listMembers } from "@/server/platform/organization.service";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await getPageOrganization(orgId);
  const [members, invitations] = await Promise.all([listMembers(access), isOrgManager(access) ? listInvitations(access.ctx.db, access.ctx.companyId) : Promise.resolve([])]);
  return (
    <MembersManager
      orgId={orgId}
      viewerRole={access.companyRole}
      members={members}
      invitations={invitations}
      orgApps={access.entitlements.appIds}
      activationPending={access.organization.activationStatus === "pending"}
    />
  );
}
