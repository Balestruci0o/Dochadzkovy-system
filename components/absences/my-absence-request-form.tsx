"use client";

import { useActionState, useState } from "react";
import { requestAbsenceAction, type ActionState } from "@/app/(app)/moje-ziadosti/actions";
import { ABSENCE_KIND_OPTIONS } from "@/components/calendar/absence-kinds";

const initialState: ActionState = {};
const inputClass = "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";
const labelClass = "flex flex-col gap-1 text-sm text-ink";

/** Zamestnanec podá žiadosť (typ, obdobie, dôvod). */
export function MyAbsenceRequestForm() {
  const [state, formAction, pending] = useActionState(requestAbsenceAction, initialState);
  const [isPartialDay, setIsPartialDay] = useState(false);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <input type="hidden" name="isPartialDay" value={isPartialDay ? "true" : "false"} />

      <label className={labelClass}>
        Druh neprítomnosti
        <select name="kind" defaultValue="dovolenka" className={inputClass}>
          {ABSENCE_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

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
        Dôvod
        <textarea name="reason" rows={2} className={inputClass} />
      </label>

      {state.error && <p className="text-sm text-late">{state.error}</p>}
      {state.success && <p className="text-sm text-sage-dark">Žiadosť podaná — čaká na schválenie.</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Odosielam…" : "Podať žiadosť"}
      </button>
    </form>
  );
}
