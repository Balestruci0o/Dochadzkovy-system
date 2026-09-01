"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { approveMissingPunchAction, rejectMissingPunchAction } from "@/app/(app)/dnes/actions";
import type { PendingMissingPunch } from "@/app/(app)/dnes/data";
import { SubmitButton } from "@/components/ui/submit-button";
import { fmtTime } from "./attendance-status";

const DIRECTION_LABEL: Record<"in" | "out", string> = { in: "Príchod", out: "Odchod" };
const KIND_LABEL: Record<"zmena" | "prestavka", string> = { zmena: "Smena", prestavka: "Prestávka" };

function RejectForm({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  return (
    <form action={rejectMissingPunchAction} className="mt-2 flex items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input
        name="decisionNote"
        placeholder="Dôvod zamietnutia (voliteľné)"
        className="flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink outline-none focus:border-orange"
      />
      <SubmitButton
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

export function MissingPunchReviewList({ requests }: { requests: PendingMissingPunch[] }) {
  const [rejecting, setRejecting] = useState<string | null>(null);

  if (requests.length === 0) {
    return <p className="text-sm text-ink-faint">Žiadne žiadosti o chýbajúce pípnutie nečakajú na schválenie.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {requests.map((r) => (
        <div key={r.id} className="rounded-md border border-line p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <b className="text-sm text-ink">{r.employeeName}</b>
              <span className="ml-2 text-xs text-ink-faint">
                {r.workplaceName} · {new Date(`${r.date}T00:00:00`).toLocaleDateString("sk-SK")}
              </span>
              <p className="mt-1 text-sm text-ink-soft">
                {KIND_LABEL[r.kind]} · {DIRECTION_LABEL[r.direction]} → {fmtTime(r.requestedTime)}
              </p>
              <p className="mt-1 text-xs text-ink-faint">„{r.reason}“</p>
            </div>
            <div className="flex flex-none items-center gap-1.5">
              <form action={approveMissingPunchAction}>
                <input type="hidden" name="requestId" value={r.id} />
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
                onClick={() => setRejecting(rejecting === r.id ? null : r.id)}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-cream-2"
              >
                Zamietnuť
              </button>
            </div>
          </div>
          {rejecting === r.id && <RejectForm requestId={r.id} onDone={() => setRejecting(null)} />}
        </div>
      ))}
    </div>
  );
}
