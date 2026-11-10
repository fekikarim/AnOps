"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { IconArrowRight, IconCheck } from "@/shared/components/ui/brand-icons";
import { btnPrimary, btnSecondary, container } from "@/shared/components/marketing/styles";
import { useScrollProgress } from "@/shared/components/home/scroll-scene";
import { BrowserFrame, WorkspaceMock } from "@/shared/components/home/workspace-mock";

const words = (text: string, start: number) =>
  text.split(" ").map((word, index) => (
    <span key={`${word}-${index}`}>
      <span style={{ ["--d" as string]: `${start + index * 90}ms` }}>{word}</span>
      {" "}
    </span>
  ));

/** Scene 1: the opening. Headline rises word by word; the workspace flattens towards the visitor as they scroll. */
export function HomeHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useScrollProgress(sectionRef, "exit");

  // Gentle pointer tilt on desktop only (fine pointer, motion allowed).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!fine.matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        stage.style.setProperty("--tx", `${(x * 5).toFixed(2)}deg`);
        stage.style.setProperty("--ty", `${(-y * 4).toFixed(2)}deg`);
      });
    };
    const onLeave = () => {
      stage.style.setProperty("--tx", "0deg");
      stage.style.setProperty("--ty", "0deg");
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <section ref={sectionRef} className="relative overflow-hidden" aria-labelledby="hero-title" style={{ ["--p" as string]: 0 }}>
      <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_30%,black,transparent)]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[38%] h-[560px] w-[min(900px,120vw)] -translate-x-1/2 rounded-full bg-[var(--color-action-primary)] opacity-[0.14] blur-[140px]"
      />

      <div className={`${container} relative pt-14 text-center sm:pt-20 lg:pt-24`}>
        <a
          href="#command-center"
          className="home-rise group inline-flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] py-1 pl-1 pr-3 text-xs font-semibold text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-control)]"
        >
          <span className="rounded-full bg-[var(--color-action-primary)] px-2 py-0.5 text-[#111F1D]">New</span>
          Meet the AnOps AI Command Center
          <IconArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
        </a>
        <h1
          id="hero-title"
          className="home-words mx-auto mt-7 max-w-[15ch] font-[family-name:var(--font-heading)] text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--color-text-primary)] sm:text-[72px] lg:text-[92px]"
        >
          {words("One platform.", 100)}
          <br />
          {words("Every operation.", 320)}
        </h1>
        <p className="home-rise mx-auto mt-7 max-w-2xl text-base leading-relaxed text-[var(--color-text-secondary)] sm:text-xl" style={{ ["--d" as string]: "520ms" }}>
          People, finance, stock, purchasing, production and marketing in one calm workspace, with an AI that prepares the work and waits for your
          confirmation.
        </p>
        <div className="home-rise mt-9 flex flex-col justify-center gap-3 sm:flex-row" style={{ ["--d" as string]: "640ms" }}>
          <Link href="/trial" className={`${btnPrimary} h-12 px-7 text-[15px]`}>
            Try it free
            <IconArrowRight size={14} />
          </Link>
          <Link href="/login" className={`${btnSecondary} h-12 px-7 text-[15px]`}>
            Sign in
          </Link>
        </div>
        <ul className="home-rise mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-[var(--color-text-secondary)]" style={{ ["--d" as string]: "760ms" }}>
          {["Free plan: 1 organization, 1 app", "Role-based access", "AI that asks before it acts"].map((item) => (
            <li key={item} className="inline-flex items-center gap-2">
              <IconCheck size={12} className="text-[var(--color-text-primary)]" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div ref={stageRef} className="home-stage relative mx-auto mt-14 w-full max-w-[1120px] px-4 pb-20 sm:mt-16 sm:px-6 lg:pb-28">
        <div className="home-rise" style={{ ["--d" as string]: "820ms" }}>
          <div className="home-device">
            <BrowserFrame url="anops.app/anops">
              <WorkspaceMock className="min-h-[340px] sm:min-h-[460px]" />
            </BrowserFrame>
          </div>
        </div>

        {/* Depth layers: cards float in front of the device and drift at different speeds. */}
        <div aria-hidden="true" className="home-float pointer-events-none absolute left-0 top-[22%] hidden lg:block" style={{ ["--depth" as string]: "-90px" }}>
          <div className="home-rise" style={{ ["--d" as string]: "1100ms" }}>
          <div className="home-idle w-[230px] rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 text-left shadow-[0_30px_60px_-30px_rgba(17,31,29,0.55)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Inventory</p>
            <p className="mt-1.5 text-sm font-semibold text-[var(--color-text-primary)]">3 products below reorder level</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
              <div className="h-full w-[38%] rounded-full bg-[#C59A2B]" />
            </div>
          </div>
          </div>
        </div>
        <div aria-hidden="true" className="home-float pointer-events-none absolute right-0 top-[48%] hidden lg:block" style={{ ["--depth" as string]: "-150px" }}>
          <div className="home-rise" style={{ ["--d" as string]: "1250ms" }}>
          <div className="home-idle w-[240px] rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 text-left shadow-[0_30px_60px_-30px_rgba(17,31,29,0.55)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Finance</p>
            <p className="mt-1.5 text-sm font-semibold text-[var(--color-text-primary)]">Invoice INV-0142 paid</p>
            <p className="mt-0.5 font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">2,450.000 TND</p>
          </div>
          </div>
        </div>
      </div>
    </section>
  );
}
