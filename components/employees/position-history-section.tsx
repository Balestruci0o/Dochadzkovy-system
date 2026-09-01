"use client";

import { useActionState, useState } from "react";
import { changePositionAction, type ActionState } from "@/app/(app)/zamestnanci/[id]/actions";
import { PositionPill } from "./position-pill";

const initialState: ActionState = {};

type PositionHistoryRow = {
  id: string;
  positionId: string;
  positionName: string;
  positionColor: string | null;
  validFrom: string;
  validTo: string | null;
};

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString("sk-SK") : "doteraz";
}

export function PositionHistorySection({
  employeeId,
  history,
  positionOptions,
  canEdit,
}: {
  employeeId: string;
  history: PositionHistoryRow[];
  positionOptions: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [state, formAction, pending] = useActionState(changePositionAction, initialState);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-base font-bold text-ink">História pozícií</h3>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="text-sm font-semibold text-orange hover:text-orange-dark"
          >
            {showForm ? "Zrušiť" : "Zmeniť pozíciu"}
          </button>
        )}
      </div>

      {showForm && (
        <form action={formAction} className="mb-4 flex flex-wrap items-end gap-3 rounded-md bg-cream p-3">
          <input type="hidden" name="employeeId" value={employeeId} />
          <label className="flex flex-col gap-1 text-sm text-ink">
            Nová pozícia
            <select
              name="positionId"
              required
              defaultValue=""
              className="rounded-md border border-line bg-paper px-3 py-2 text-sm"
            >
              <option value="" disabled>
                — vyber —
              </option>
              {positionOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
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
        Zmena pozície uzavrie starý záznam a otvorí nový — história sa nikdy neprepisuje.
      </p>

      <table className="w-full text-sm">
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-b border-line-soft last:border-none">
              <td className="py-2">
                <PositionPill name={h.positionName} color={h.positionColor} />
              </td>
              <td className="py-2 text-right text-ink-soft tabular-nums">
                {fmt(h.validFrom)} – {fmt(h.validTo)}
              </td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td className="py-3 text-ink-faint">Zatiaľ žiadna pozícia.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
