"use client";

import { PlusCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { addMissingPunchAction, type DirectCorrectionState } from "@/app/(app)/pipnutia/actions";
import { todayStr } from "@/lib/shared/dates";

const initialState: DirectCorrectionState = {};
const inputClass = "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

function Form({
  workplaceId,
  employeeOptions,
  onDone,
}: {
  workplaceId: string;
  employeeOptions: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(addMissingPunchAction, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3 rounded-md border border-line bg-cream p-3.5">
      <input type="hidden" name="workplaceId" value={workplaceId} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm text-ink sm:col-span-2">
          Zamestnanec
          <select name="employeeId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              — vyber —
            </option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Dátum
          <input type="date" name="date" required max={todayStr()} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Typ
          <select name="kind" defaultValue="zmena" className={inputClass}>
            <option value="zmena">Smena (príchod/odchod)</option>
            <option value="prestavka">Prestávka</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Smer
          <select name="direction" defaultValue="in" className={inputClass}>
            <option value="in">Príchod</option>
            <option value="out">Odchod</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Čas
          <input type="time" name="time" required className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Dôvod
        <input
          name="reason"
          required
          placeholder="Napr. terminál nefungoval, zamestnanec zabudol pípnuť."
          className={inputClass}
        />
      </label>
      {state.error && <p className="text-sm text-late">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
        >
          {pending ? "Pridávam…" : "Pridať pípnutie"}
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

/**
 * Manažér/owner pridá pípnutie PRIAMO komukoľvek, kto sa nepípol — bez
 * žiadosti, na rozdiel od `MissingPunchReviewList` (schvaľuje žiadosť
 * zamestnanca). Rieši prípad, keď zlyhá terminál a inak by zamestnanec
 * prišiel o celý deň.
 */
export function AddMissingPunchCard({
  workplaceId,
  employeeOptions,
}: {
  workplaceId: string;
  employeeOptions: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PlusCircle size={18} className="text-orange" />
          <h3 className="font-serif text-lg font-bold text-ink">Pridať chýbajúce pípnutie</h3>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm font-semibold text-orange hover:text-orange-dark"
        >
          {open ? "Zrušiť" : "Pridať"}
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-faint">Keď sa zamestnanec vôbec nepípol (terminál nešiel, appka spadla) — pridáš pípnutie priamo, bez žiadosti.</p>
      {open && <Form workplaceId={workplaceId} employeeOptions={employeeOptions} onDone={() => setOpen(false)} />}
    </div>
  );
}
