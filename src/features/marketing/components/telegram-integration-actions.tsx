"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { configureTelegramWebhookAction, testTelegramIntegrationAction } from "@/features/marketing/actions/integrations.action";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/shared/components/ui/toast";

/** Test calls getMe; Register webhook calls setWebhook and reads it back. Neither sends a message to any chat. */
export function TelegramIntegrationActions({ canRegisterWebhook }: { canRegisterWebhook: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const test = () =>
    startTransition(async () => {
      const result = await testTelegramIntegrationAction();
      if (!result.ok) return toast.fromError(result.error);
      if (result.data.ok) toast.success(`Connected to @${result.data.botUsername ?? "the bot"}. No message was sent.`);
      else toast.error(`Telegram check failed: ${result.data.errorCode ?? "UNKNOWN"}`);
      router.refresh();
    });

  const register = () =>
    startTransition(async () => {
      const result = await configureTelegramWebhookAction();
      if (!result.ok) return toast.fromError(result.error);
      if (result.data.ok) toast.success("Webhook registered and confirmed by Telegram.");
      else toast.error(`Webhook not confirmed: ${result.data.errorCode ?? "UNKNOWN"}`);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={pending} onClick={test}>{pending ? "Working…" : "Test connection"}</Button>
      {canRegisterWebhook && <Button variant="secondary" disabled={pending} onClick={register}>Register webhook</Button>}
    </div>
  );
}
