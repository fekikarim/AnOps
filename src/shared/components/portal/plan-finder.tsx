"use client";

import Link from "next/link";
import { useState } from "react";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { plans, type Plan } from "@/shared/config/site";
import { cn } from "@/shared/lib/utils";

type Answers = { apps: "one" | "few" | "many" | null; ai: "no" | "yes" | null };

const questions: { key: keyof Answers; label: string; options: { value: string; label: string }[] }[] = [
  { key: "apps", label: "How many applications do you need?", options: [{ value: "one", label: "Just one" }, { value: "few", label: "2 to 4" }, { value: "many", label: "5 or more" }] },
  { key: "ai", label: "Do you want AI features?", options: [{ value: "no", label: "Not now" }, { value: "yes", label: "Yes" }] },
];

function recommend(answers: Answers): Plan["id"] | null {
  if (!answers.apps || !answers.ai) return null;
  if (answers.apps === "many") return answers.ai === "yes" ? "maxops" : "allops";
  if (answers.apps === "few" || answers.ai === "yes") return "custom";
  return "oneops";
}

export function PlanFinder() {
  const [answers, setAnswers] = useState<Answers>({ apps: null, ai: null });
  const result = recommend(answers);
  const plan = plans.find((item) => item.id === result);

  return (
    <div className="grid gap-6 rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-8 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-6">
        {questions.map((question) => (
          <fieldset key={question.key}>
            <legend className="text-sm font-semibold text-[var(--color-text-primary)]">{question.label}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {question.options.map((option) => {
                const checked = answers[question.key] === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                      checked
                        ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-canvas)]"
                        : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-control)] hover:text-[var(--color-text-primary)]"
                    )}
                  >
                    <input
                      type="radio"
                      name={question.key}
                      value={option.value}
                      checked={checked}
                      onChange={() => setAnswers((current) => ({ ...current, [question.key]: option.value }))}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div aria-live="polite" className="flex flex-col justify-between rounded-[16px] bg-[var(--color-bg-subtle)] p-6">
        {plan ? (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Suggested plan</p>
              <p className="mt-2 font-[family-name:var(--font-heading)] text-4xl font-semibold tracking-[-0.04em] text-[var(--color-text-primary)]">{plan.name}</p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{plan.description}</p>
              <p className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">
                {plan.applications} · {plan.price}{plan.id === "custom" && answers.ai === "yes" ? " + AI add-on" : ""}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={plan.cta.href} className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)]">
                {plan.cta.label}
                <IconArrowRight size={14} />
              </Link>
              <button
                type="button"
                onClick={() => setAnswers({ apps: null, ai: null })}
                className="min-h-[44px] rounded-[var(--radius-control)] px-3 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                Start over
              </button>
            </div>
          </>
        ) : (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Suggested plan</p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Answer two questions and we will point you to the plan that fits. Larger organizations with specific requirements can ask for a
              Custom plan.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
