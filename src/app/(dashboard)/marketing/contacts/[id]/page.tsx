import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getContact } from "@/server/marketing/contact.service";
import { listConsentHistory } from "@/server/marketing/consent.service";
import { getTelegramConnection } from "@/server/marketing/telegram.service";
import { getTelegramState } from "@/server/marketing/providers/telegram/config";
import { listTags } from "@/server/marketing/tag.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { ContactDetail } from "@/features/marketing/components/contact-detail";
import { PERMISSIONS } from "@/server/security/permissions";
import { orNotFound } from "@/server/marketing/page-guard";

export const metadata: Metadata = { title: "Contact | AnOps ERP" };

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  const [contact, history, tags, telegram] = await orNotFound(() =>
    Promise.all([getContact(ctx, id), listConsentHistory(ctx, id), listTags(ctx), getTelegramConnection(ctx, id)])
  );
  return (
    <div className="space-y-6">
      <PageHeader title={contact.fullName || "Contact"} description="Contact details, tags, Telegram connection and marketing consent." />
      <ContactDetail
        contact={contact}
        history={history}
        tags={tags}
        canManage={ctx.permissions.has(PERMISSIONS.MARKETING_CONTACT_MANAGE)}
        canConsent={ctx.permissions.has(PERMISSIONS.MARKETING_CONSENT_MANAGE)}
        canTag={ctx.permissions.has(PERMISSIONS.MARKETING_TAG_MANAGE)}
        telegram={telegram}
        telegramBotReady={getTelegramState().configured}
      />
    </div>
  );
}
