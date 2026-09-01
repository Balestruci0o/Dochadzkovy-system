"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { approveCorrectionAction, rejectCorrectionAction } from "@/app/(app)/dnes/actions";
import type { PendingCorrection } from "@/app/(app)/dnes/data";
import { SubmitButton } from "@/components/ui/submit-button";
import { fmtTime } from "./attendance-status";

function RejectForm({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  return (
    <form action={rejectCorrectionAction} className="mt-2 flex items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input
        name="decisionNote"
        placeholder="Dôvod zamietnutia (voliteľné)"
        className="flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink outline-none focus:border-orange"
      />
      <SubmitButton
        // onDone() v onSubmit by unmountol <form> skôr, než prehliadač stihne
        // odoslať natívny submit ("Form submission canceled because the form
        // is not connected") — posunuté o jeden tick, nech submit prebehne prvý.
        onClick={() => setTimeout(onDone, 0)}
        className="rounded-md bg-late px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        pendingContent={
          <span className="flex items-center gap-1.5">
            <Loader2 size={14} className="animate-spin" /> Zamietam…
          </span>
        }
      >
        Zamietnuť
      </SubmitButton>
    </form>
  );
}

export function CorrectionReviewList({ corrections }: { corrections: PendingCorrection[] }) {
  const [rejecting, setRejecting] = useState<string | null>(null);

  if (corrections.length === 0) {
    return <p className="text-sm text-ink-faint">Žiadne žiadosti o opravu razítka nečakajú na schválenie.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {corrections.map((c) => (
        <div key={c.id} className="rounded-md border border-line p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <b className="text-sm text-ink">{c.employeeName}</b>
              <span className="ml-2 text-xs text-ink-faint">
                {c.workplaceName} · {new Date(c.date).toLocaleDateString("sk-SK")}
              </span>
              <p className="mt-1 text-sm text-ink-soft">
                {c.requestedStart && <>Príchod → {fmtTime(c.requestedStart)}&nbsp;&nbsp;</>}
                {c.requestedEnd && <>Odchod → {fmtTime(c.requestedEnd)}</>}
              </p>
              <p className="mt-1 text-xs text-ink-faint">„{c.reason}“</p>
            </div>
            <div className="flex flex-none items-center gap-1.5">
              <form action={approveCorrectionAction}>
                <input type="hidden" name="requestId" value={c.id} />
                <SubmitButton
                  className="rounded-md bg-sage px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sage-dark disabled:opacity-60"
                  pendingContent={
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={14} className="animate-spin" /> Schvaľujem…
                    </span>
                  }
                >
                  Schváliť
                </SubmitButton>
              </form>
              <button
                type="button"
                onClick={() => setRejecting(rejecting === c.id ? null : c.id)}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-cream-2"
              >
                Zamietnuť
              </button>
            </div>
          </div>
          {rejecting === c.id && <RejectForm requestId={c.id} onDone={() => setRejecting(null)} />}
        </div>
      ))}
    </div>
  );
}
