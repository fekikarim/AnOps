import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/server/auth";
import clientPromise from "@/server/db/client";
import { previewInvitation } from "@/server/platform/invitation.service";
import { AcceptInvitationForm } from "@/features/platform/components/accept-invitation-form";
import { PlatformShell, panel } from "@/features/platform/components/platform-shell";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";

export const metadata: Metadata = { title: "Join your team on AnOps", robots: { index: false } };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const db = (await clientPromise).db();
  const [preview, session] = await Promise.all([previewInvitation(db, token), auth()]);
  const signedInEmail = session?.user?.email?.toLowerCase() ?? null;
  const callback = `/invite?token=${encodeURIComponent(token)}`;

  return (
    <PlatformShell>
      <div className={panel}>
        {!preview ? (
          <div className="text-center">
            <div className="flex justify-center">
              <AnimatedIcon icon="wired-lineal-1140-warning-triangle-hover-oscillate.webp" size={64} play="always" />
            </div>
            <h1 className="mt-6 font-[family-name:var(--font-heading)] text-2xl font-semibold text-[var(--color-text-primary)]">This invitation is not valid</h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">It may have expired, been used already, or been cancelled. Ask the person who invited you to send a new invitation.</p>
            <Link href="/" className="mt-6 inline-flex min-h-[44px] items-center font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
              Go to AnOps
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="flex justify-center">
                <AnimatedIcon icon="wired-lineal-2538-hands-teamwork-hover-pinch.webp" size={72} play="always" />
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">Invitation</p>
              <h1 className="mt-2 font-[family-name:var(--font-heading)] text-3xl font-semibold tracking-[-0.035em] text-[var(--color-text-primary)]">Join {preview.organizationName}</h1>
              <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                You are invited as <strong className="text-[var(--color-text-primary)]">{preview.roleLabel}</strong> with <strong className="text-[var(--color-text-primary)]">{preview.email}</strong>.
              </p>
            </div>
            <div className="mt-8">
              {preview.accountExists && signedInEmail !== preview.email ? (
                <div className="space-y-3 text-center">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {signedInEmail ? `You are signed in as ${signedInEmail}. ` : ""}Sign in as {preview.email} to accept this invitation.
                  </p>
                  <Link href={`/login?callbackUrl=${encodeURIComponent(callback)}`} className="inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)]">
                    Sign in to accept
                  </Link>
                </div>
              ) : (
                <AcceptInvitationForm token={token} email={preview.email} newAccount={!preview.accountExists} />
              )}
            </div>
          </>
        )}
      </div>
    </PlatformShell>
  );
}
