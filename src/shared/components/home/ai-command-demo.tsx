"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { IconArrowRight, IconCheck, IconSparkles } from "@/shared/components/ui/brand-icons";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { cn } from "@/shared/lib/utils";

/**
 * Sandboxed AnOps AI Command Center demo. Everything here is scripted sample data in the browser:
 * no request leaves the page and nothing is ever saved. Reads answer; writes are shown as proposals
 * that wait for a confirmation, exactly like the real Command Center.
 */

type Intent = "inventory" | "product" | "sales" | "performance" | "unknown";

const suggestions: { intent: Exclude<Intent, "unknown">; prompt: string }[] = [
  { intent: "inventory", prompt: "Show me my inventory overview." },
  { intent: "product", prompt: "Create a new product." },
  { intent: "sales", prompt: "Generate a sales report." },
  { intent: "performance", prompt: "Show my organization's performance." },
];

const meta: Record<Intent, { module: string; icon: string; steps: string[] }> = {
  inventory: { module: "Inventory", icon: "wired-lineal-108-box-hover-squeeze.webp", steps: ["Reading Inventory", "Checking your permissions", "Summarizing stock"] },
  product: { module: "Inventory", icon: "wired-lineal-108-box-hover-squeeze.webp", steps: ["Checking your permissions", "Preparing a draft", "Waiting for your confirmation"] },
  sales: { module: "Finance", icon: "wired-lineal-1377-file-invoice-dollar-hover-swipe.webp", steps: ["Reading invoices", "Grouping by month", "Building the report"] },
  performance: { module: "All applications", icon: "wired-lineal-3089-bar-chart-vertical-hover-pinch.webp", steps: ["Reading Finance, Inventory and HR", "Comparing with last month", "Preparing the overview"] },
  unknown: { module: "Command Center", icon: "wired-lineal-256x256-ai-chip-hover-pinch.webp", steps: ["Understanding the request"] },
};

export function detectIntent(text: string): Intent {
  const value = text.toLowerCase();
  if (/(create|new|add).*(product|item|sku)|product.*(create|new)/.test(value)) return "product";
  if (/(sale|revenue|report|invoice)/.test(value)) return "sales";
  if (/(perform|kpi|organi[sz]ation|company|overview of (my )?business|how are we)/.test(value)) return "performance";
  if (/(inventor|stock|warehouse|reorder)/.test(value)) return "inventory";
  return "unknown";
}

type Message = { id: number; role: "user" | "ai"; text: string; intent?: Intent; status?: "thinking" | "done" };

const THINK_MS = 1300;

export function AiCommandDemo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  // Keep the newest message in view inside the panel only: never scroll the page.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = (text: string) => {
    const prompt = text.trim().slice(0, 160);
    if (!prompt || busy) return;
    const intent = detectIntent(prompt);
    const userId = nextId.current++;
    const aiId = nextId.current++;
    setBusy(true);
    setInput("");
    setMessages((list) => [...list.slice(-6), { id: userId, role: "user", text: prompt }, { id: aiId, role: "ai", text: "", intent, status: "thinking" }]);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timers.current.push(
      window.setTimeout(
        () => {
          setMessages((list) => list.map((message) => (message.id === aiId ? { ...message, status: "done" } : message)));
          setBusy(false);
        },
        reduced ? 200 : THINK_MS
      )
    );
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(input);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#13221F] text-[#F7F7F2] shadow-[0_60px_140px_-50px_rgba(0,0,0,0.9)]">
      {/* Title bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#C8F03E] text-[#111F1D]">
          <IconSparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">AnOps AI Command Center</p>
          <p className="truncate text-[11px] text-[#B4BFB7]">Interactive demo · sample data · nothing is saved</p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-[#B4BFB7] sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[#7fd9ae]" /> Sandbox
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[200px_1fr]">
        {/* Context rail (desktop) */}
        <aside className="hidden flex-col gap-1 border-r border-white/10 p-3 md:flex" aria-label="Demo context">
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7f8f87]">Your access</p>
          {["Inventory", "Finance", "Purchasing", "HR & Payroll", "Manufacturing"].map((module) => (
            <span key={module} className="flex items-center justify-between rounded-[8px] px-2 py-1.5 text-xs text-[#D9E0DA]">
              {module}
              <IconCheck size={10} className="text-[#7fd9ae]" />
            </span>
          ))}
          <div className="mt-auto rounded-[12px] border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-[#B4BFB7]">
            AI only sees what your role allows. Every change waits for your confirmation.
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5" aria-live="polite" aria-relevant="additions">
            {messages.length === 0 && <EmptyState onPick={ask} />}
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="home-pop flex justify-end">
                  <p className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-[#C8F03E] px-3.5 py-2 text-sm font-medium text-[#111F1D]">{message.text}</p>
                </div>
              ) : (
                <AiMessage key={message.id} intent={message.intent ?? "unknown"} thinking={message.status === "thinking"} onPick={ask} />
              )
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 p-3 sm:p-4">
            {messages.length > 0 && (
              <div className="-mx-1 mb-2.5 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                {suggestions.map((item) => (
                  <button
                    key={item.intent}
                    type="button"
                    disabled={busy}
                    onClick={() => ask(item.prompt)}
                    className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-[#D9E0DA] transition-colors hover:border-[#C8F03E]/60 hover:text-white disabled:opacity-50"
                  >
                    {item.prompt}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-[14px] border border-white/15 bg-white/[0.04] p-1.5 pl-3.5 focus-within:border-[#C8F03E]/70">
              <label htmlFor="home-ai-input" className="sr-only">
                Ask the demo assistant
              </label>
              <input
                id="home-ai-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={160}
                autoComplete="off"
                placeholder="Ask about stock, products, sales or performance…"
                className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-[#7f8f87]"
                style={{ outline: "none" }}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Send"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#C8F03E] text-[#111F1D] transition-[opacity,transform] active:scale-95 disabled:opacity-40"
              >
                <IconArrowRight size={14} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-6 text-center">
      <AnimatedIcon icon="wired-lineal-256x256-ai-chip-hover-pinch.webp" size={64} play="always" />
      <p className="mt-4 font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.03em]">What should we look at?</p>
      <p className="mt-1 max-w-sm text-sm text-[#B4BFB7]">Pick a request or type your own. Answers use sample data from a demo organization.</p>
      <div className="mt-5 grid w-full max-w-lg gap-2 sm:grid-cols-2">
        {suggestions.map((item, index) => (
          <button
            key={item.intent}
            type="button"
            onClick={() => onPick(item.prompt)}
            className="home-pop group flex min-h-[48px] items-center justify-between gap-2 rounded-[12px] border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left text-sm text-[#F7F7F2] transition-colors hover:border-[#C8F03E]/60 hover:bg-white/[0.06]"
            style={{ ["--d" as string]: `${index * 70}ms` }}
          >
            {item.prompt}
            <IconArrowRight size={12} className="shrink-0 text-[#B4BFB7] transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

function AiMessage({ intent, thinking, onPick }: { intent: Intent; thinking: boolean; onPick: (prompt: string) => void }) {
  const info = meta[intent];
  return (
    <div className="home-pop flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-white/10 text-[#C8F03E]">
        <IconSparkles size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7f8f87]">{info.module}</p>
        {thinking ? (
          <div className="mt-2 space-y-1.5">
            {info.steps.map((step, index) => (
              <p key={step} className="home-pop flex items-center gap-2 text-sm text-[#B4BFB7]" style={{ ["--d" as string]: `${index * 300}ms` }}>
                <span className="home-thinking inline-flex gap-0.5" aria-hidden="true">
                  <span className="h-1 w-1 rounded-full bg-[#C8F03E]" />
                  <span className="h-1 w-1 rounded-full bg-[#C8F03E]" />
                  <span className="h-1 w-1 rounded-full bg-[#C8F03E]" />
                </span>
                {step}…
              </p>
            ))}
          </div>
        ) : (
          <div className="mt-2">{renderAnswer(intent, onPick)}</div>
        )}
      </div>
    </div>
  );
}

const panel = "rounded-[16px] border border-white/10 bg-white/[0.04] p-4";
const d = (ms: number) => ({ ["--d" as string]: `${ms}ms` });

function Kpis({ items }: { items: [string, string, string?][] }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map(([label, value, delta], index) => (
        <div key={label} className="home-pop rounded-[12px] border border-white/10 bg-white/[0.03] p-3" style={d(index * 80)}>
          <p className="truncate text-[11px] text-[#B4BFB7]">{label}</p>
          <p className="mt-1 truncate font-[family-name:var(--font-heading)] text-lg font-semibold tracking-[-0.03em]">{value}</p>
          {delta && <p className="text-[11px] font-semibold text-[#7fd9ae]">{delta}</p>}
        </div>
      ))}
    </div>
  );
}

function renderAnswer(intent: Intent, onPick: (prompt: string) => void): ReactNode {
  switch (intent) {
    case "inventory":
      return (
        <div className="space-y-3">
          <p className="text-sm">Here is your stock across 2 warehouses. Three products need attention.</p>
          <Kpis items={[["Products", "248"], ["Stock value", "184,320 TND"], ["Below reorder", "3"], ["Warehouses", "2"]]} />
          <div className={panel}>
            <p className="text-xs font-semibold text-[#B4BFB7]">Below reorder level</p>
            <ul className="mt-3 space-y-3">
              {[
                ["Aluminium panel 2M", 38, 100],
                ["Steel bolts M8", 120, 400],
                ["Large shipping box", 64, 150],
              ].map(([name, qty, level], index) => (
                <li key={name as string}>
                  <div className="flex justify-between text-xs">
                    <span>{name}</span>
                    <span className="text-[#B4BFB7]">
                      {qty} / {level}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="home-bar-x h-full rounded-full bg-[#C59A2B]" style={{ width: `${((qty as number) / (level as number)) * 100}%`, ...d(200 + index * 120) }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <FollowUp onPick={onPick} prompt="Create a new product." />
        </div>
      );
    case "product":
      return <ProductProposal />;
    case "sales": {
      const months: [string, number][] = [["Jun", 52], ["Jul", 61], ["Aug", 48], ["Sep", 70], ["Oct", 78], ["Nov", 92]];
      return (
        <div className="space-y-3">
          <p className="text-sm">Sales report from Finance invoices, last 6 months.</p>
          <div className={panel}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em]">401,500 TND</p>
              <p className="text-xs font-semibold text-[#7fd9ae]">+18% vs previous 6 months</p>
            </div>
            <div className="mt-4 flex h-32 items-end gap-2 sm:gap-3" role="img" aria-label="Monthly sales, rising from 52 to 92 thousand dinars">
              {months.map(([month, value], index) => (
                <div key={month} className="flex h-full flex-1 flex-col justify-end gap-1.5 text-center">
                  <div className="home-bar rounded-t-[6px] bg-[#14A39A]" style={{ height: `${value}%`, ...d(index * 90) }} />
                  <span className="text-[10px] text-[#B4BFB7]">{month}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={panel}>
            <p className="text-xs font-semibold text-[#B4BFB7]">Top customers</p>
            <ul className="mt-2 divide-y divide-white/10 text-sm">
              {[["Atlas Foods", "86,200 TND"], ["Medina Retail", "61,750 TND"], ["Carthage Build", "44,900 TND"]].map(([name, value], index) => (
                <li key={name} className="home-pop flex justify-between py-2" style={d(500 + index * 90)}>
                  <span>{name}</span>
                  <span className="font-semibold">{value}</span>
                </li>
              ))}
            </ul>
          </div>
          <FollowUp onPick={onPick} prompt="Show my organization's performance." />
        </div>
      );
    }
    case "performance":
      return (
        <div className="space-y-3">
          <p className="text-sm">November so far, compared with October.</p>
          <Kpis items={[["Revenue", "92,000 TND", "+12%"], ["Orders received", "34", "+6"], ["Work orders done", "18", "+3"], ["Team present", "41 / 44", "93%"]]} />
          <div className={panel}>
            <p className="text-xs font-semibold text-[#B4BFB7]">Cash in, last 30 days</p>
            <svg viewBox="0 0 300 70" className="mt-3 h-20 w-full" role="img" aria-label="Cash in trending upward over 30 days">
              <path
                className="home-draw"
                style={{ ["--len" as string]: 420 }}
                d="M0 58 C 25 55, 40 48, 60 50 S 100 40, 120 42 S 160 30, 180 34 S 220 20, 240 22 S 280 8, 300 10"
                fill="none"
                stroke="#C8F03E"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className="text-xs text-[#B4BFB7]">Only figures from applications your role can access are included.</p>
        </div>
      );
    default:
      return (
        <div className="space-y-3">
          <p className="text-sm">
            In this demo I can answer four requests. In your workspace, the Command Center works across every application your role can access.
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((item) => (
              <button key={item.intent} type="button" onClick={() => onPick(item.prompt)} className="rounded-full border border-white/15 px-3 py-1.5 text-xs hover:border-[#C8F03E]/60">
                {item.prompt}
              </button>
            ))}
          </div>
        </div>
      );
  }
}

function FollowUp({ onPick, prompt }: { onPick: (prompt: string) => void; prompt: string }) {
  return (
    <button type="button" onClick={() => onPick(prompt)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#C8F03E] hover:underline">
      Next: {prompt} <IconArrowRight size={11} />
    </button>
  );
}

function ProductProposal() {
  const [state, setState] = useState<"proposed" | "confirmed" | "cancelled">("proposed");
  const fields: [string, string][] = [
    ["Name", "Aluminium panel 3M"],
    ["SKU", "PNL-AL-3M"],
    ["Unit", "Piece"],
    ["Sale price", "185.000 TND"],
    ["Reorder level", "60"],
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm">I prepared this product. Nothing is created until you confirm.</p>
      <div className={cn(panel, "border-[#C8F03E]/30")}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Create product · draft</p>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#B4BFB7]">Proposal</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {fields.map(([label, value], index) => (
            <div key={label} className="home-pop min-w-0" style={d(index * 70)}>
              <dt className="text-[11px] text-[#B4BFB7]">{label}</dt>
              <dd className="truncate font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {state === "proposed" ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => setState("confirmed")} className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#C8F03E] px-4 text-sm font-semibold text-[#111F1D] active:scale-[0.98]">
              <IconCheck size={12} /> Confirm
            </button>
            <button type="button" onClick={() => setState("cancelled")} className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-[10px] border border-white/15 px-4 text-sm font-semibold">
              Cancel
            </button>
          </div>
        ) : (
          <p role="status" className="home-pop mt-4 flex items-start gap-2 rounded-[10px] bg-white/[0.06] p-3 text-sm">
            {state === "confirmed" ? (
              <>
                <IconCheck size={14} className="mt-0.5 shrink-0 text-[#7fd9ae]" />
                <span>
                  Confirmed in the demo. In your workspace, the product would now be saved to Inventory and recorded in the audit log. Nothing was changed here.
                </span>
              </>
            ) : (
              <span>Cancelled. Nothing was created.</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
