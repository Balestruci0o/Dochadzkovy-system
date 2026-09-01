"use client";

import { useActionState, useEffect, useState } from "react";
import { requestCorrectionAction, type ActionState } from "@/app/(app)/moja-dochadzka/actions";
import type { attendanceDays, punchCorrectionRequests } from "@/lib/db/schema";
import { ATTENDANCE_STATUS_LABELS, fmtHours, fmtTime } from "./attendance-status";

const initialState: ActionState = {};
const inputClass = "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

type Day = typeof attendanceDays.$inferSelect;
type CorrectionRequest = typeof punchCorrectionRequests.$inferSelect;

function CorrectionForm({ day, onDone }: { day: Day; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(requestCorrectionAction, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-3 rounded-md border border-line bg-cream p-3.5">
      <input type="hidden" name="attendanceDayId" value={day.id} />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Opravený príchod
          <input type="time" name="requestedStart" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Opravený odchod
          <input type="time" name="requestedEnd" className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Dôvod
        <textarea name="reason" rows={2} required className={inputClass} placeholder="Napr. zabudol/a som pípnuť odchod." />
      </label>
      {state.error && <p className="text-sm text-late">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
        >
          {pending ? "Odosielam…" : "Odoslať žiadosť"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
        >
          Zrušiť
        </button>
      </div>
    </form>
  );
}

export function AttendanceList({ days, requests }: { days: Day[]; requests: CorrectionRequest[] }) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const requestsByDay = new Map<string, CorrectionRequest[]>();
  for (const r of requests) {
    const list = requestsByDay.get(r.attendanceDayId) ?? [];
    list.push(r);
    requestsByDay.set(r.attendanceDayId, list);
  }

  return (
    <div className="flex flex-col gap-2">
      {days.map((day) => {
        const status = ATTENDANCE_STATUS_LABELS[day.status] ?? { label: day.status, color: "#9C988E" };
        const pendingRequest = (requestsByDay.get(day.id) ?? []).find((r) => r.status === "pending");
        return (
          <div key={day.id} className="rounded-md border border-line p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <b className="w-24 text-sm text-ink">{new Date(day.date).toLocaleDateString("sk-SK")}</b>
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                  style={{ background: `${status.color}22`, color: status.color }}
                >
                  {status.label}
                </span>
                <span className="text-sm text-ink-soft">
                  {fmtTime(day.actualStart)} – {fmtTime(day.actualEnd)}
                </span>
                <span className="text-sm font-semibold text-ink">{fmtHours(day.workedHours)}</span>
                {day.isCorrected && <span className="text-xs text-ink-faint">(opravené)</span>}
              </div>
              {!pendingRequest && day.status !== "planned" && (
                <button
                  type="button"
                  onClick={() => setOpenFor(openFor === day.id ? null : day.id)}
                  className="text-sm font-semibold text-orange hover:text-orange-dark"
                >
                  {openFor === day.id ? "Zrušiť" : "Požiadať o opravu"}
                </button>
              )}
              {pendingRequest && <span className="text-xs font-semibold text-gold">Žiadosť čaká na schválenie</span>}
            </div>
            {openFor === day.id && <CorrectionForm day={day} onDone={() => setOpenFor(null)} />}
          </div>
        );
      })}
      {days.length === 0 && <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadna dochádzka za posledných 30 dní.</p>}
    </div>
  );
}
