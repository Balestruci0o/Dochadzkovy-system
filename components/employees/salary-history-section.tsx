"use client";

import { useActionState, useState } from "react";
import { changeSalaryAction, type ActionState } from "@/app/(app)/zamestnanci/[id]/actions";

const initialState: ActionState = {};

type SalaryHistoryRow = {
  id: string;
  fixAmount: string;
  variableAmount: string;
  validFrom: string;
  validTo: string | null;
};

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString("sk-SK") : "doteraz";
}

function fmtEur(n: string) {
  return `${Number(n).toFixed(2).replace(".", ",")} €`;
}

/**
 * Fixný plat namiesto hodinovej sadzby, Fáza 2 — presná kópia
 * `RateHistorySection`, len BEZ prevádzky (fix je vlastnosť človeka, nie
 * prevádzky, viď schema.ts `employee_salary_history`) a s dvoma sumami
 * (fix + variabilná) namiesto jednej hodinovej sadzby. Zobrazuje sa MIESTO
 * `RateHistorySection`, keď je resolvovaný režim odmeňovania "fixny"
 * (`app/(app)/zamestnanci/[id]/page.tsx`) — nikdy oba naraz.
 */
export function SalaryHistorySection({
  employeeId,
  history,
  canEdit,
}: {
  employeeId: string;
  history: SalaryHistoryRow[];
  canEdit: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [state, formAction, pending] = useActionState(changeSalaryAction, initialState);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-base font-bold text-ink">História fixného platu</h3>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="text-sm font-semibold text-orange hover:text-orange-dark"
          >
            {showForm ? "Zrušiť" : "Zmeniť plat"}
          </button>
        )}
      </div>

      {!canEdit && (
        <p className="mb-2 text-xs text-ink-faint">Plat smie meniť len majiteľ alebo manažér s pravomocou na mzdy.</p>
      )}

      {showForm && (
        <form action={formAction} className="mb-4 flex flex-wrap items-end gap-3 rounded-md bg-cream p-3">
          <input type="hidden" name="employeeId" value={employeeId} />
          <label className="flex flex-col gap-1 text-sm text-ink">
            Fix (€)
            <input
              type="number"
              name="fixAmount"
              step="0.01"
              min="0"
              required
              className="w-28 rounded-md border border-line bg-paper px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Variabilná (€)
            <input
              type="number"
              name="variableAmount"
              step="0.01"
              min="0"
              defaultValue="0"
              className="w-28 rounded-md border border-line bg-paper px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Platí od
            <input
              type="date"
              name="validFrom"
              required
              defaultValue={today}
              className="rounded-md border border-line bg-paper px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-orange-dark disabled:opacity-60"
          >
            {pending ? "Ukladám…" : "Zmeniť"}
          </button>
          {state.error && <p className="w-full text-sm text-late">{state.error}</p>}
        </form>
      )}

      <p className="mb-2 text-xs text-ink-faint">
        Výkaz z minulého mesiaca vždy použije plat platný ku koncu toho mesiaca — staré záznamy sa nikdy neprepisujú.
      </p>

      <table className="w-full text-sm">
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-b border-line-soft last:border-none">
              <td className="py-2 text-ink-soft">
                fix {fmtEur(h.fixAmount)} + variabilná {fmtEur(h.variableAmount)}
              </td>
              <td className="py-2 pl-4 text-right text-ink-soft tabular-nums">
                {fmt(h.validFrom)} – {fmt(h.validTo)}
              </td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td className="py-3 text-ink-faint">Zatiaľ žiadny fixný plat.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
