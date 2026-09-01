"use client";

import { CheckCircle2, Loader2, Megaphone } from "lucide-react";
import { publishScheduleAction } from "@/app/(app)/kalendar/actions";
import { SubmitButton } from "@/components/ui/submit-button";

/** Blok 11 — "nový rozvrh zverejnený" notifikácia potrebuje reálnu udalosť; toto ju spúšťa. */
export function PublishScheduleButton({
  workplaceId,
  year,
  month,
  scheduleStatus,
}: {
  workplaceId: string;
  year: number;
  month: number;
  scheduleStatus: "draft" | "published" | null;
}) {
  if (scheduleStatus === "published") {
    return (
      <span className="flex items-center gap-1.5 rounded-md border border-[#C6DBC4] bg-ok-tint px-3 py-2 text-sm font-semibold text-sage-dark">
        <CheckCircle2 size={15} />
        Zverejnené
      </span>
    );
  }

  return (
    <form action={publishScheduleAction}>
      <input type="hidden" name="workplaceId" value={workplaceId} />
      <input type="hidden" name="date" value={`${year}-${String(month).padStart(2, "0")}-01`} />
      <SubmitButton
        className="flex items-center gap-1.5 rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
        pendingContent={
          <>
            <Loader2 size={15} className="animate-spin" />
            Zverejňujem…
          </>
        }
      >
        <Megaphone size={15} />
        Zverejniť rozvrh
      </SubmitButton>
    </form>
  );
}
