"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { createClosureAction, deleteClosureAction, type ActionState } from "@/app/(app)/nastavenia/zatvorenia/actions";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

export type ExistingClosure = {
  id: string;
  workplaceId: string;
  date: string;
  reason: string | null;
};

function ClosureForm({
  workplaceOptions,
  onDone,
}: {
  workplaceOptions: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(createClosureAction, initialState);
  const [dateFrom, setDateFrom] = useState("");

  useEffect(() => {
    // Pri jednom dni sa formulár zavrie hneď (pôvodné správanie). Pri
    // intervale necháme otvorené, nech je vidieť súhrn (koľko dní pridaných,
    // koľko už zatvorenie malo) — inak by zmizol skôr, než si ho stihneš prečítať.
    if (state.success && !state.message) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success, state.message]);

  if (state.success && state.message) {
    return (
      <div className="rounded-md border border-[#C6DBC4] bg-ok-tint p-3.5">
        <p className="text-sm font-semibold text-sage-dark">{state.message}</p>
        <button
          type="button"
          onClick={onDone}
          className="mt-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
        >
          Zavrieť
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-cream p-3.5">
      <label className="flex flex-col gap-1 text-sm text-ink">
        Prevádzka
        <select name="workplaceId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            — vyber —
          </option>
          {workplaceOptions.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Od
        <input
          name="date"
          type="date"
          required
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Do (voliteľné — interval)
        <input name="dateTo" type="date" min={dateFrom || undefined} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Dôvod (voliteľné)
        <input name="reason" className={inputClass} />
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

export function ClosureList({
  closures,
  workplaceOptions,
}: {
  closures: ExistingClosure[];
  workplaceOptions: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-ink">Dni zatvorenia</h3>
        {!adding && workplaceOptions.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Pridať zatvorenie
          </button>
        )}
      </div>

      {adding && <ClosureForm workplaceOptions={workplaceOptions} onDone={() => setAdding(false)} />}

      <div className="flex flex-col gap-2">
        {closures.map((c) => {
          const workplaceName = workplaceOptions.find((w) => w.id === c.workplaceId)?.name;
          return (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
              <div>
                <b className="text-sm font-semibold text-ink">
                  {new Date(c.date).toLocaleDateString("sk-SK")} — {workplaceName}
                </b>
                {c.reason && <p className="mt-0.5 text-xs text-ink-faint">{c.reason}</p>}
              </div>
              <form action={deleteClosureAction}>
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton
                  className="rounded p-1.5 text-ink-soft transition hover:bg-late-tint hover:text-late disabled:opacity-60"
                  aria-label="Vymazať"
                  pendingContent={<Loader2 size={15} className="animate-spin" />}
                >
                  <Trash2 size={15} />
                </SubmitButton>
              </form>
            </div>
          );
        })}
        {closures.length === 0 && !adding && (
          <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadne zatvorenie.</p>
        )}
      </div>
    </div>
  );
}
