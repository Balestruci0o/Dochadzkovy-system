"use client";

import { useActionState, useEffect, useState } from "react";
import { submitAbsenceOnBehalfAction, type ActionState } from "@/app/(app)/ziadosti/actions";
import type { EmployeeOption } from "@/app/(app)/ziadosti/data";
import { ABSENCE_KIND_OPTIONS } from "@/components/calendar/absence-kinds";

const initialState: ActionState = {};
const inputClass = "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";
const labelClass = "flex flex-col gap-1 text-sm text-ink";

/** Manažér zadá žiadosť ZA zamestnanca (napr. PN prichádza spätne) — rovno schválené. */
export function AbsenceOnBehalfForm({ employees }: { employees: EmployeeOption[] }) {
  const [state, formAction, pending] = useActionState(submitAbsenceOnBehalfAction, initialState);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [isPartialDay, setIsPartialDay] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.success) setOpen(false);
  }, [state.success]);

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
      >
        Zadať žiadosť za zamestnanca
      </button>
    );
  }

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3 rounded-md border border-line bg-cream p-4">
      <input type="hidden" name="workplaceId" value={selectedEmployee?.workplaceId ?? ""} />
      <input type="hidden" name="isPartialDay" value={isPartialDay ? "true" : "false"} />

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Zamestnanec
          <select name="employeeId" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.workplaceName})
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Druh
          <select name="kind" defaultValue="pn" className={inputClass}>
            {ABSENCE_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Od
          <input name="dateFrom" type="date" required className={inputClass} />
        </label>
        <label className={labelClass}>
          Do
          <input name="dateTo" type="date" className={inputClass} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={isPartialDay} onChange={(e) => setIsPartialDay(e.target.checked)} className="accent-orange" />
        Len na hodiny (paragraf/lekár), nie celý deň
      </label>
      {isPartialDay && (
        <label className={labelClass}>
          Počet hodín
          <input name="hours" type="number" min={0.5} step={0.5} className={inputClass} />
        </label>
      )}

      <label className={labelClass}>
        Poznámka (voliteľné)
        <input name="reason" className={inputClass} />
      </label>

      {state.error && <p className="text-sm text-late">{state.error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-orange-dark disabled:opacity-60">
          {pending ? "Ukladám…" : "Zadať (rovno schválené)"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-cream-2">
          Zrušiť
        </button>
      </div>
    </form>
  );
}
