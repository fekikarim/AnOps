import Link from "next/link";
import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { HelpCenter } from "@/shared/components/portal/help-center";
import { Eyebrow, SectionHeading, delay, display } from "@/shared/components/portal/sections";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { apps } from "@/shared/config/catalog";
import { docs } from "@/shared/config/docs";
import { gettingStarted } from "@/shared/config/site";

export const metadata: Metadata = {
  title: "Help center",
  description: "Search AnOps help: troubleshooting, frequently asked questions, application support and documentation shortcuts.",
};

const shortcuts = [
  { label: "Getting started", href: "/docs/getting-started", icon: "wired-lineal-12-layers-hover-slide.webp" },
  { label: "Roles and permissions", href: "/docs/roles-and-permissions", icon: "wired-lineal-1004-avatars-settings-hover-smooth.webp" },
  { label: "Give AI access", href: "/docs/grant-ai-access", icon: "wired-lineal-256x256-ai-chip-hover-pinch.webp" },
  { label: "All guides", href: "/docs#guides", icon: "wired-lineal-728-notebook-pen-hover-pinch.webp" },
];

const channels = [
  { title: "Documentation", body: "References for every app and step-by-step guides.", href: "/docs", cta: "Browse docs", icon: "wired-lineal-3853-info-book-hover-pinch.webp" },
  { title: "Your company forum", body: "Ask colleagues inside your workspace (sign-in required).", href: "/community", cta: "Open forum", icon: "wired-lineal-3953-forum-hover-pinch.webp" },
  { title: "Report a problem", body: "Compose a clear bug report or feature request.", href: "/community-hub#feedback", cta: "Write a report", icon: "wired-lineal-1140-warning-triangle-hover-oscillate.webp" },
  { title: "Contact", body: "Talk to us about plans, setup or anything else.", href: "/contact", cta: "Contact page", icon: "wired-lineal-958-chats-faq-hover-slide.webp" },
];

export default function HelpPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-[var(--color-border-subtle)]">
        <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_65%)]" />
        <div className={`${container} relative pb-14 pt-14 sm:pb-20 sm:pt-20`}>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div data-reveal className="max-w-2xl">
              <AnimatedIcon icon="wired-lineal-36-help-blink.webp" size={64} play="always" />
              <Eyebrow className="mt-6">Help center</Eyebrow>
              <h1 className={`${display} mt-4`}>How can we help?</h1>
              <p className="mt-5 text-base leading-relaxed text-[var(--color-text-secondary)] sm:text-lg">Search fixes and answers, or jump to the documentation for your application.</p>
            </div>
            <ul className="grid grid-cols-2 gap-2 lg:w-[420px]" data-reveal style={delay(1)}>
              {shortcuts.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="group flex min-h-[56px] items-center gap-3 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2.5 text-sm font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-border-control)]">
                    <AnimatedIcon icon={item.icon} size={36} />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-12" data-reveal style={delay(2)}>
            <HelpCenter />
          </div>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-24`} aria-labelledby="apps-help-heading">
        <SectionHeading id="apps-help-heading" eyebrow="Support by application" title="Help for each app." lead="Each application has a reference page and, where available, step-by-step guides." />
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {apps.map((app, i) => {
            const count = docs.filter((doc) => doc.app === app.slug).length;
            return (
              <li key={app.slug} data-reveal style={delay(i, 35)}>
                <Link href={`/docs/app-${app.slug}`} className="group flex h-full items-center gap-3 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3.5 hover:border-[var(--color-border-control)]">
                  <AnimatedIcon icon={app.icon} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{app.name}</span>
                    <span className="block text-xs text-[var(--color-text-secondary)]">
                      {count} {count === 1 ? "article" : "articles"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="getting-started" className="scroll-mt-24 border-y border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50" aria-labelledby="gs-heading">
        <div className={`${container} py-16 sm:py-20`}>
          <SectionHeading id="gs-heading" eyebrow="New to AnOps?" title="Three steps to get going." />
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {gettingStarted.map((item, index) => (
              <li key={item.step} data-reveal style={delay(index)}>
                <Link href={item.href} className="group flex h-full flex-col rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 hover:border-[var(--color-border-control)]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-sm font-semibold text-[#111F1D]">{index + 1}</span>
                  <span className="mt-4 text-lg font-semibold text-[var(--color-text-primary)]">{item.step}</span>
                  <span className="mt-1 text-sm text-[var(--color-text-secondary)]">{item.detail}</span>
                  <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-[var(--color-text-primary)]">
                    Open
                    <IconArrowRight size={13} className="transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="contact-options" className={`${container} scroll-mt-24 py-16 sm:py-24`} aria-labelledby="channels-heading">
        <SectionHeading id="channels-heading" eyebrow="Still stuck?" title="Other ways to get help." />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {channels.map((channel, i) => (
            <li key={channel.title} data-reveal style={delay(i)}>
              <Link href={channel.href} className="group flex h-full flex-col rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 hover:border-[var(--color-border-control)]">
                <AnimatedIcon icon={channel.icon} size={48} />
                <span className="mt-5 text-base font-semibold text-[var(--color-text-primary)]">{channel.title}</span>
                <span className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{channel.body}</span>
                <span className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-semibold text-[var(--color-text-primary)]">
                  {channel.cta}
                  <IconArrowRight size={13} className="transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
