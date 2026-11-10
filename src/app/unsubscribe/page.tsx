import type { Metadata } from "next";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { viewUnsubscribe } from "@/server/marketing/unsubscribe.service";
import { UnsubscribeConfirm } from "@/features/marketing/components/unsubscribe-confirm";
import { ToastProvider } from "@/shared/components/ui/toast";

export const metadata: Metadata = { title: "Unsubscribe | AnOps", robots: { index: false, follow: false } };

/**
 * Public opt-out page. The signed token is the only credential. Nothing about the contact is shown; the page
 * names the company and the channel. Opening the page changes nothing: the opt-out happens on button press.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const token = typeof raw.token === "string" ? raw.token : "";
  let view: Awaited<ReturnType<typeof viewUnsubscribe>> = { valid: false };
  if (token.length > 0 && token.length <= 600) {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    view = await viewUnsubscribe(db, token);
  }

  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">Unsubscribe</h1>
        {!view.valid ? (
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">This link is not valid. If you still receive messages, reply to them and ask the sender to remove you.</p>
        ) : view.alreadyUnsubscribed ? (
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">You are already unsubscribed from {view.companyName} {view.channel === "email" ? "email" : "SMS"} messages.</p>
        ) : (
          <ToastProvider>
            <UnsubscribeConfirm token={token} companyName={view.companyName} channel={view.channel} />
          </ToastProvider>
        )}
      </div>
    </main>
  );
}
