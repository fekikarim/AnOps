import Link from "next/link";
import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { ReportComposer } from "@/shared/components/portal/report-composer";
import { CtaBand, Notice, PageHero, SectionHeading, delay } from "@/shared/components/portal/sections";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { docs } from "@/shared/config/docs";
import { cn } from "@/shared/lib/utils";

export const metadata: Metadata = {
  title: "Community",
  description: "AnOps documentation, guides, forum, events, open-source plans, social channels and feedback, in one place.",
};

type Hub = { id: string; title: string; body: string; icon: string; state: "available" | "planned" };

const hubs: Hub[] = [
  { id: "documentation", title: "Documentation", body: "How AnOps works and how to use every application.", icon: "wired-lineal-3853-info-book-hover-pinch.webp", state: "available" },
  { id: "guides", title: "Guides & tutorials", body: "Step-by-step walkthroughs of real workflows.", icon: "wired-lineal-728-notebook-pen-hover-pinch.webp", state: "available" },
  { id: "forum", title: "Forum", body: "Discussions inside your company workspace.", icon: "wired-lineal-3953-forum-hover-pinch.webp", state: "available" },
  { id: "feedback", title: "Reports & feedback", body: "Report a bug or request a feature.", icon: "wired-lineal-1140-warning-triangle-hover-oscillate.webp", state: "available" },
  { id: "github", title: "GitHub", body: "Source code and contribution.", icon: "wired-lineal-2572-logo-github-hover-pinch.webp", state: "planned" },
  { id: "social", title: "Social channels", body: "Official AnOps accounts.", icon: "wired-lineal-963-multichannel-hover-pinch.webp", state: "planned" },
  { id: "events", title: "Events", body: "Webinars, launches and meetups.", icon: "wired-lineal-759-ticket-perforated-hover-pinch.webp", state: "planned" },
];

const stateBadge = (state: Hub["state"]) => (
  <span
    className={cn(
      "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
      state === "available" ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]" : "bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral)]"
    )}
  >
    {state === "available" ? "Available" : "Planned"}
  </span>
);

export default function CommunityHubPage() {
  const guides = docs.filter((doc) => doc.kind === "guide");
  const starters = docs.filter((doc) => doc.kind === "start");

  return (
    <>
      <PageHero
        eyebrow="Community"
        title="Learn AnOps, share ideas, help shape what comes next."
        lead="Documentation, guides, discussion and feedback in one place. Items marked Planned are being prepared and will be announced here."
      />

      <nav aria-label="Community sections" className={`${container} py-12 sm:py-16`}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {hubs.map((hub, index) => (
            <li key={hub.id} data-reveal style={delay(index, 50)}>
              <a
                href={`#${hub.id}`}
                className="group flex h-full flex-col rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 transition-colors hover:border-[var(--color-border-control)]"
              >
                <div className="flex items-start justify-between">
                  <AnimatedIcon icon={hub.icon} size={44} />
                  {stateBadge(hub.state)}
                </div>
                <p className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">{hub.title}</p>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{hub.body}</p>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Documentation */}
      <section id="documentation" className="scroll-mt-24 border-t border-[var(--color-border-subtle)]" aria-labelledby="docs-heading">
        <div className={`${container} grid gap-10 py-16 sm:py-20 lg:grid-cols-[0.9fr_1.1fr]`}>
          <div>
            <SectionHeading id="docs-heading" eyebrow="Documentation" title="Understand the platform, one app at a time." />
            <p className="mt-4 text-base leading-relaxed text-[var(--color-text-secondary)]">
              Start with the basics, then read the reference for each application: what it does, where to find it and its current limits.
            </p>
            <Link href="/docs" className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)]">
              Open the documentation
              <IconArrowRight size={14} />
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {starters.map((doc, i) => (
              <li key={doc.slug} data-reveal style={delay(i)}>
                <Link href={`/docs/${doc.slug}`} className="group flex h-full flex-col rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 hover:border-[var(--color-border-control)]">
                  <AnimatedIcon icon={doc.icon} size={44} />
                  <p className="mt-4 font-semibold text-[var(--color-text-primary)]">{doc.title}</p>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{doc.summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Guides */}
      <section id="guides" className="scroll-mt-24 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50" aria-labelledby="guides-heading">
        <div className={`${container} py-16 sm:py-20`}>
          <SectionHeading id="guides-heading" eyebrow="Guides & tutorials" title="Learn by doing." action={<Link href="/docs#guides" className="text-sm font-semibold text-[var(--color-text-primary)] underline underline-offset-4">All guides</Link>} />
          <ul className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {guides.map((doc, i) => (
              <li key={doc.slug} data-reveal style={delay(i, 50)}>
                <Link href={`/docs/${doc.slug}`} className="group flex h-full gap-4 rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 hover:border-[var(--color-border-control)]">
                  <AnimatedIcon icon={doc.icon} size={44} />
                  <span>
                    <span className="block font-semibold text-[var(--color-text-primary)]">{doc.title}</span>
                    <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">{doc.minutes} min · {doc.summary}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Forum */}
      <section id="forum" className="scroll-mt-24 border-t border-[var(--color-border-subtle)]" aria-labelledby="forum-heading">
        <div className={`${container} grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-2`}>
          <div>
            <SectionHeading id="forum-heading" eyebrow="Forum" title="Discussions where your team already works." />
            <p className="mt-4 text-base leading-relaxed text-[var(--color-text-secondary)]">
              Every company workspace includes Blogs &amp; Community: a forum with topics and comments, a company blog with AI summaries and live chat.
              Discussions stay private to your company.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/community" className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)]">
                Open your company forum
                <IconArrowRight size={14} />
              </Link>
              <Link href="/apps/community" className="inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
                About Blogs &amp; Community
              </Link>
            </div>
            <p className="mt-4 text-xs text-[var(--color-text-secondary)]">Requires sign-in. A public forum for all AnOps users is planned.</p>
          </div>
          <div data-reveal="scale" className="rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
            <p className="text-xs text-[var(--color-text-secondary)]">Illustrative example</p>
            <ul className="mt-3 divide-y divide-[var(--color-border-subtle)]">
              {[
                ["Q3 stock count planning", "Pinned · 12 replies"],
                ["New receiving procedure: questions", "5 replies"],
                ["Ideas for the onboarding checklist", "3 replies"],
              ].map(([topic, meta]) => (
                <li key={topic} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <span className="font-medium text-[var(--color-text-primary)]">{topic}</span>
                  <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{meta}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Feedback */}
      <section id="feedback" className="scroll-mt-24 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50" aria-labelledby="feedback-heading">
        <div className={`${container} py-16 sm:py-20`}>
          <SectionHeading id="feedback-heading" eyebrow="Reports & feedback" title="Found a bug? Missing a feature?" lead="Describe it here. The composer formats a clear report you can copy and share with us." />
          <div className="mt-10" data-reveal>
            <ReportComposer />
          </div>
        </div>
      </section>

      {/* Planned */}
      <section className="border-t border-[var(--color-border-subtle)]" aria-labelledby="planned-heading">
        <div className={`${container} py-16 sm:py-20`}>
          <SectionHeading id="planned-heading" eyebrow="Coming next" title="Open source, social channels and events." />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {hubs
              .filter((hub) => hub.state === "planned")
              .map((hub, i) => (
                <article key={hub.id} id={hub.id} data-reveal style={delay(i)} className="group scroll-mt-24 rounded-[18px] border border-dashed border-[var(--color-border-control)] p-6">
                  <div className="flex items-start justify-between">
                    <AnimatedIcon icon={hub.icon} size={52} />
                    {stateBadge(hub.state)}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-[var(--color-text-primary)]">{hub.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                    {hub.id === "github" && "The AnOps source repository is private today. Public repository links and contribution guidelines will be published here."}
                    {hub.id === "social" && "Official AnOps social media accounts have not been announced yet. Only links published on this page are official."}
                    {hub.id === "events" && "No events are scheduled right now. Launches, webinars and announcements will be listed here."}
                  </p>
                </article>
              ))}
          </div>
          <div className="mt-6 max-w-2xl">
            <Notice>Be careful with accounts or repositories claiming to be AnOps that are not linked from this page.</Notice>
          </div>
        </div>
      </section>

      <CtaBand title="The best way to learn AnOps is to use it." />
    </>
  );
}
