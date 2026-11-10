"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { activateBomAction, archiveBomAction } from "@/features/manufacturing/actions/manufacturing.action";
import { Button } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";

/** Activating a revision archives the previous active one. Work orders keep their snapshot either way. */
export function BomActions({ bomId, version, canActivate, canArchive }: { bomId: string; version: number; canActivate: boolean; canArchive: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  if (!canActivate && !canArchive) return null;

  const run = (action: "activate" | "archive") => {
    setMessage(null);
    startTransition(async () => {
      const result = action === "activate" ? await activateBomAction(bomId, version) : await archiveBomAction(bomId);
      if (!result.ok) {
        setMessage({ kind: "error", text: `${result.error.message} (ref ${result.error.requestId.slice(0, 8)})` });
        return;
      }
      setMessage({ kind: "success", text: action === "activate" ? "Revision activated. The previous active revision is archived." : "Revision archived." });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canActivate && <Button variant="primary" onClick={() => run("activate")} disabled={pending}>Activate revision</Button>}
        {canArchive && <Button variant="danger" onClick={() => run("archive")} disabled={pending}>Archive</Button>}
      </div>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
    </div>
  );
}
