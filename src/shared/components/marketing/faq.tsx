export function Faq({ items, idPrefix = "faq" }: { items: readonly { question: string; answer: string }[]; idPrefix?: string }) {
  return (
    <div className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      {items.map((item, index) => (
        <details key={item.question} id={`${idPrefix}-${index}`} className="group px-5 py-4 sm:px-6">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-semibold text-[var(--color-text-primary)] [&::-webkit-details-marker]:hidden">
            {item.question}
            <span aria-hidden="true" className="text-xl leading-none text-[var(--color-text-secondary)] transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="faq-answer pb-2 pt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
