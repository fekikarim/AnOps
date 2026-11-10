"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck } from "@/shared/components/ui/brand-icons";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { BrowserFrame, WorkspaceMock } from "@/shared/components/home/workspace-mock";
import { getApp } from "@/shared/config/catalog";
import { cn } from "@/shared/lib/utils";

const steps = [
  { title: "Choose your applications", body: "Start with the apps you need today. Add the rest whenever you are ready.", url: "anops.app/trial" },
  { title: "Create the owner account", body: "Your name, a work email and a password. You become the owner of the organization.", url: "anops.app/get-started" },
  { title: "Establish your organization", body: "Name it, confirm the email we send, and your organization is activated.", url: "anops.app/get-started" },
  { title: "Enter your workspace", body: "Every application in your plan, one search and a Dock, ready on desktop and phone.", url: "anops.app/anops" },
  { title: "Invite your colleagues", body: "Send secure invitations with a role. Each person sees only what their role allows.", url: "anops.app/organization/members" },
];

const d = (ms: number) => ({ ["--d" as string]: `${ms}ms` });

/**
 * Scene 3: scroll-told onboarding. On large screens the device stays pinned beside the steps and
 * changes screen as each step reaches the middle of the viewport; on phones each step carries its own screen.
 */
export function OnboardingDemo() {
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const step = Number((entry.target as HTMLElement).dataset.step);
          setActive(step);
          setSeen((current) => (current.has(step) ? current : new Set(current).add(step)));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    refs.current.forEach((element) => element && observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
      <ol className="relative min-w-0">
        <span aria-hidden="true" className="absolute bottom-6 left-[19px] top-6 w-px bg-[var(--color-border-subtle)]" />
        {steps.map((step, index) => (
          <li
            key={step.title}
            ref={(element) => {
              refs.current[index] = element;
            }}
            data-step={index}
            className="relative pb-10 pl-14 lg:flex lg:min-h-[62vh] lg:flex-col lg:justify-center lg:pb-0"
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold transition-[background-color,border-color,color,transform] duration-500 lg:top-1/2 lg:-translate-y-1/2",
                active >= index
                  ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-canvas)]"
                  : "border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] text-[var(--color-text-secondary)]"
              )}
            >
              {active > index ? <IconCheck size={13} /> : index + 1}
            </span>
            <div className={cn("transition-opacity duration-500 lg:opacity-40", active === index && "lg:opacity-100")}>
              <h3 className="font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)] sm:text-2xl">{step.title}</h3>
              <p className="mt-2 max-w-md text-base leading-relaxed text-[var(--color-text-secondary)]">{step.body}</p>
            </div>
            {/* Phones and tablets: the screen travels with its step. */}
            <div className="relative mt-5 -ml-14 sm:ml-0 lg:hidden">
              <BrowserFrame url={step.url}>
                <Screen index={index} active={seen.has(index)} inline />
              </BrowserFrame>
            </div>
          </li>
        ))}
      </ol>

      <div className="hidden lg:block">
        <div className="sticky top-[calc(var(--home-header)+12vh)]">
          <BrowserFrame url={steps[active].url}>
            <div className="relative h-[460px]">
              {steps.map((step, index) => (
                <div key={step.title} className="home-screen" data-active={active === index} aria-hidden={active !== index}>
                  <Screen index={index} active={active === index} />
                </div>
              ))}
            </div>
          </BrowserFrame>
          <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">
            {steps.map((step, index) => (
              <span key={step.title} className={cn("h-1.5 rounded-full transition-[width,background-color] duration-500", active === index ? "w-6 bg-[var(--color-text-primary)]" : "w-1.5 bg-[var(--color-border-subtle)]")} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Screens re-mount when they become active so their entrance plays each time. */
function Screen({ index, active, inline = false }: { index: number; active: boolean; inline?: boolean }) {
  // Inline (phones, tablets): the screen takes its natural height so nothing is clipped at any width.
  const shell = cn(inline ? "relative min-h-[300px]" : "absolute inset-0", "overflow-hidden bg-[#F7F7F2] p-4 text-[#111F1D] sm:p-7");
  if (!active) return <div className={shell} aria-hidden="true" />;
  switch (index) {
    case 0:
      return <ChooseApps key="0" shell={shell} />;
    case 1:
      return (
        <div key="1" className={shell}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#59645F]">Get started</p>
          <p className="mt-1 font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.03em]">Create your owner account</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Field label="First name" value="Amira" delay={150} />
            <Field label="Last name" value="Ben Salah" delay={650} />
            <Field label="Work email" value="amira@qovri.tn" delay={1150} wide />
            <Field label="Password" value="••••••••••" delay={1750} wide />
          </div>
          <p className="home-pop mt-4 flex items-center gap-2 text-xs text-[#176247]" style={d(2400)}>
            <IconCheck size={11} /> Strong password
          </p>
        </div>
      );
    case 2:
      return (
        <div key="2" className={shell}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#59645F]">Get started</p>
          <p className="mt-1 font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.03em]">Your organization</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Field label="Organization name" value="Qovri" delay={150} wide />
            <Field label="Phone" value="+216 22 333 990" delay={650} wide />
            <Field label="Currency" value="TND" delay={1150} />
          </div>
          <div className="home-pop mt-5 flex flex-wrap items-center gap-3 rounded-[14px] border border-[#D8DDD5] bg-white p-3.5 shadow-[0_18px_40px_-28px_rgba(17,31,29,0.5)]" style={d(1500)}>
            <AnimatedIcon icon="wired-lineal-3094-mail-open-marketing-hover-pinch.webp" size={40} play="never" />
            <div className="min-w-[150px] flex-1">
              <p className="text-sm font-semibold">Activate your organization</p>
              <p className="truncate text-xs text-[#59645F]">Sent to amira@qovri.tn · valid 12 hours</p>
            </div>
            <span className="home-pop inline-flex shrink-0 items-center gap-1 rounded-full bg-[#E9F2EA] px-2.5 py-1 text-[11px] font-semibold text-[#176247]" style={d(2300)}>
              <IconCheck size={10} /> Activated
            </span>
          </div>
        </div>
      );
    case 3:
      return <WorkspaceMock key="3" compact animateIn className={inline ? "min-h-[300px]" : "absolute inset-0"} />;
    default:
      return (
        <div key="4" className={shell}>
          <p className="font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.03em]">Invite colleagues</p>
          <p className="mt-1 text-sm text-[#59645F]">Qovri · 3 invitations</p>
          <ul className="mt-5 space-y-2.5">
            {[
              ["youssef@qovri.tn", "Administrator"],
              ["sarra@qovri.tn", "Manager"],
              ["mehdi@qovri.tn", "Employee"],
            ].map(([email, role], index) => (
              <li key={email} className="home-pop flex items-center gap-3 rounded-[12px] border border-[#D8DDD5] bg-white p-3" style={d(150 + index * 450)}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#111F1D] text-xs font-bold uppercase text-[#F7F7F2]">{email[0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{email}</span>
                  <span className="block text-xs text-[#59645F]">{role}</span>
                </span>
                <span className="home-pop shrink-0 rounded-full bg-[#E9F2EA] px-2.5 py-1 text-[11px] font-semibold text-[#176247]" style={d(500 + index * 450)}>
                  Sent
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

function ChooseApps({ shell }: { shell: string }) {
  const picks = ["finance", "inventory", "purchasing", "hr-payroll", "manufacturing", "marketing"];
  const selected = new Set(["finance", "inventory", "purchasing"]);
  return (
    <div className={cn(shell, "flex flex-col")}>
      <p className="font-[family-name:var(--font-heading)] text-lg font-semibold tracking-[-0.03em] sm:text-xl">Which applications do you need?</p>
      <ul className="mb-4 mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:grid-cols-3 sm:gap-2.5">
        {picks.map((slug, index) => {
          const app = getApp(slug);
          if (!app) return null;
          const on = selected.has(slug);
          return (
            <li
              key={slug}
              className="home-pop relative flex min-w-0 items-center gap-2 rounded-[12px] border bg-white p-2 sm:gap-2.5 sm:p-2.5"
              style={{ ...d(index * 80), borderColor: on ? "#111F1D" : "#D8DDD5" }}
            >
              <AnimatedIcon icon={app.icon} size={34} play="never" />
              <span className="min-w-0 truncate text-xs font-semibold">{app.name}</span>
              {on && (
                <span className="home-pop absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#C8F03E] text-[#111F1D]" style={d(700 + [...selected].indexOf(slug) * 350)}>
                  <IconCheck size={10} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="home-pop mt-auto flex items-center justify-between gap-3 rounded-[12px] bg-[#111F1D] px-4 py-3 text-[#F7F7F2]" style={d(1900)}>
        <span className="text-sm">3 applications selected</span>
        <span className="rounded-[8px] bg-[#C8F03E] px-3 py-1.5 text-xs font-semibold text-[#111F1D]">Continue</span>
      </div>
    </div>
  );
}

function Field({ label, value, delay, wide }: { label: string; value: string; delay: number; wide?: boolean }) {
  return (
    <div className={cn("home-pop", wide && "col-span-2")} style={d(Math.max(0, delay - 150))}>
      <p className="text-[11px] font-medium text-[#59645F]">{label}</p>
      <div className="mt-1 flex h-10 min-w-0 items-center overflow-hidden rounded-[8px] border border-[#77847C] bg-white px-3 text-sm">
        <span className="home-type truncate whitespace-nowrap" style={d(delay)}>
          {value}
        </span>
      </div>
    </div>
  );
}
