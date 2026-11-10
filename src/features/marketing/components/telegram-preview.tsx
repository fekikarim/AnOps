import { TELEGRAM_MESSAGE_MAX, TELEGRAM_OPT_OUT_FOOTER } from "@/features/marketing/utils/template";

/**
 * Chat-style preview of a Telegram message. Telegram receives plain text only, so what shows here is exactly
 * what the customer reads: the rendered body, a blank line, then the opt-out line the server always appends.
 * The count is checked against Telegram's own limit, and nothing is ever cut to fit.
 */
export function TelegramPreview({ body, botName = "AnOps Notifications" }: { body: string; botName?: string }) {
  const text = body.trim();
  const total = text.length === 0 ? 0 : text.length + 2 + TELEGRAM_OPT_OUT_FOOTER.length;
  const over = total > TELEGRAM_MESSAGE_MAX;
  return (
    <div>
      <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-subtle)] p-3">
        <div className="max-w-[34rem] rounded-[var(--radius-card)] rounded-tl-sm bg-[var(--color-bg-surface)] px-3.5 py-3 shadow-[0_1px_2px_rgba(17,31,29,0.12)]">
          <p className="text-xs font-semibold text-[var(--color-accent-blue)]">{botName}</p>
          {text ? (
            <>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
              <p className="mt-3 border-t border-[var(--color-border-subtle)] pt-2 text-xs text-[var(--color-text-secondary)]">{TELEGRAM_OPT_OUT_FOOTER}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Your Telegram message appears here.</p>
          )}
        </div>
      </div>
      <p className={`mt-3 text-xs tabular-nums ${over ? "font-semibold text-[var(--color-status-error)]" : "text-[var(--color-text-secondary)]"}`} aria-live="polite">
        {total.toLocaleString("en-US")} / {TELEGRAM_MESSAGE_MAX.toLocaleString("en-US")} characters including the opt-out line
        {over ? ". Too long: Telegram would reject it, and AnOps never shortens a message." : ""}
      </p>
    </div>
  );
}
