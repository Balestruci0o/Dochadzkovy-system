"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { approveAbsenceRequestAction, rejectAbsenceRequestAction, type ActionState } from "@/app/(app)/ziadosti/actions";
import type { PendingAbsenceRequest } from "@/app/(app)/ziadosti/data";
import { ABSENCE_KIND_CONFIG } from "@/components/calendar/absence-kinds";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: ActionState = {};

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("sk-SK");
}

function RejectForm({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(rejectAbsenceRequestAction, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-1.5">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex items-center gap-2">
        <input
          name="decisionNote"
          required
          placeholder="Dôvod zamietnutia (povinné)"
          className="flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink outline-none focus:border-orange"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-late px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Zamietam…" : "Zamietnuť"}
        </button>
      </div>
      {state.error && <p className="text-xs text-late">{state.error}</p>}
    </form>
  );
}

export function AbsenceReviewList({ requests }: { requests: PendingAbsenceRequest[] }) {
  const [rejecting, setRejecting] = useState<string | null>(null);

  if (requests.length === 0) {
    return <p className="text-sm text-ink-faint">Žiadne žiadosti nečakajú na schválenie.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {requests.map((r) => {
        const kindCfg = ABSENCE_KIND_CONFIG[r.kind];
        return (
          <div key={r.id} className="rounded-md border border-line p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm text-ink">{r.employeeName}</b>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                    style={{ background: `${kindCfg.color}22`, color: kindCfg.color }}
                  >
                    {kindCfg.label}
                  </span>
                  <span className="text-xs text-ink-faint">{r.workplaceName}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {fmtDate(r.dateFrom)}
                  {r.dateTo !== r.dateFrom && <> – {fmtDate(r.dateTo)}</>}
                  {r.isPartialDay && r.hours != null && <> · {r.hours} h</>}
                </p>
                {r.reason && <p className="mt-1 text-xs text-ink-faint">„{r.reason}“</p>}
                {r.othersOffInPeriod.length > 0 && (
                  <p className="mt-1.5 text-xs text-[#A8761A]">
                    V tomto termíne má voľno aj: {r.othersOffInPeriod.map((o) => o.employeeName).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")}
                  </p>
                )}
              </div>
              <div className="flex flex-none items-center gap-1.5">
                <form action={approveAbsenceRequestAction}>
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
        );
      })}
    </div>
  );
}
