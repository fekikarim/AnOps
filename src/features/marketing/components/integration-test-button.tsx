"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { testEmailIntegrationAction } from "@/features/marketing/actions/integrations.action";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/shared/components/ui/toast";

/**
 * Runs a connection/authentication check against the shared SMTP account.
 * It never sends a message, so testing cannot reach a contact.
 */
export function EmailIntegrationTestButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const test = () =>
    startTransition(async () => {
      const result = await testEmailIntegrationAction();
      if (!result.ok) return toast.fromError(result.error);
      if (result.data.ok) {
        toast.success("SMTP connection and login succeeded. No message was sent.");
      } else {
        toast.error(`SMTP check failed: ${result.data.errorCode ?? "UNKNOWN"}`);
      }
      router.refresh();
    });

  return (
    <Button variant="secondary" disabled={pending} onClick={test}>
      {pending ? "Testing..." : "Test connection"}
    </Button>
  );
}
