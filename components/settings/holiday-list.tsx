"use client";

import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  createHolidayAction,
  deleteHolidayAction,
  importSkHolidaysAction,
  type ActionState,
} from "@/app/(app)/nastavenia/sviatky/actions";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

export type ExistingHoliday = { date: string; name: string; country: string };

function AddHolidayForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(createHolidayAction, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-cream p-3.5">
      <label className="flex flex-col gap-1 text-sm text-ink">
        Dátum
        <input name="date" type="date" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Názov
        <input name="name" required className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Ukladám…" : "Pridať"}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
      >
        Zrušiť
      </button>
      {state.error && <p className="w-full text-sm text-late">{state.error}</p>}
    </form>
  );
}

function ImportForm() {
  const [state, formAction, pending] = useActionState(importSkHolidaysAction, initialState);
  const thisYear = new Date().getFullYear();

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-sage bg-sage-tint p-3.5">
      <label className="flex flex-col gap-1 text-sm text-ink">
        Import SK sviatkov pre rok
        <input name="year" type="number" defaultValue={thisYear} min={2000} max={2100} className={`${inputClass} w-28`} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1.5 rounded-md bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark disabled:opacity-60"
      >
        <Download size={15} /> {pending ? "Importujem…" : "Importovať"}
      </button>
      {state.success && (
        <span className="text-sm font-medium text-sage-dark">Importovaných {state.imported} sviatkov.</span>
      )}
      {state.error && <p className="w-full text-sm text-late">{state.error}</p>}
    </form>
  );
}

export function HolidayList({ holidays }: { holidays: ExistingHoliday[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-ink">Sviatky</h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Pridať ručne
          </button>
        )}
      </div>

      <ImportForm />
      {adding && <AddHolidayForm onDone={() => setAdding(false)} />}

      <div className="flex flex-col gap-2">
        {holidays.map((h) => (
          <div key={h.date} className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
            <div>
              <b className="text-sm font-semibold text-ink">{new Date(h.date).toLocaleDateString("sk-SK")}</b>
              <span className="ml-2 text-sm text-ink-soft">{h.name}</span>
            </div>
            <form action={deleteHolidayAction}>
              <input type="hidden" name="date" value={h.date} />
              <SubmitButton
                className="rounded p-1.5 text-ink-soft transition hover:bg-late-tint hover:text-late disabled:opacity-60"
                aria-label="Vymazať"
                pendingContent={<Loader2 size={15} className="animate-spin" />}
              >
                <Trash2 size={15} />
              </SubmitButton>
            </form>
          </div>
        ))}
        {holidays.length === 0 && <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadny sviatok.</p>}
      </div>
    </div>
  );
}
