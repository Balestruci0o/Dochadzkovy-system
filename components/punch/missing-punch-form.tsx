"use client";

import { AlertCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { requestMissingPunchAction, type ActionState } from "@/app/(app)/moja-dochadzka/actions";
import type { missingPunchRequests } from "@/lib/db/schema";
import { todayStr } from "@/lib/shared/dates";

const initialState: ActionState = {};
const inputClass = "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

type MissingPunchRequest = typeof missingPunchRequests.$inferSelect;

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "Čaká na schválenie", color: "#A8761A" },
  approved: { label: "Pridané", color: "#5C8A5E" },
  rejected: { label: "Zamietnuté", color: "#C9692E" },
  cancelled: { label: "Zrušené", color: "#9C988E" },
};

function Form({ workplaces, onDone }: { workplaces: { workplaceId: string; workplaceName: string; isPrimary: boolean }[]; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(requestMissingPunchAction, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3 rounded-md border border-line bg-cream p-3.5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Dátum
          <input type="date" name="date" required max={todayStr()} className={inputClass} />
        </label>
        {workplaces.length > 1 && (
          <label className="flex flex-col gap-1 text-sm text-ink">
            Prevádzka
            <select name="workplaceId" required defaultValue={workplaces.find((w) => w.isPrimary)?.workplaceId ?? workplaces[0]?.workplaceId} className={inputClass}>
              {workplaces.map((w) => (
                <option key={w.workplaceId} value={w.workplaceId}>
                  {w.workplaceName}
                </option>
              ))}
            </select>
          </label>
        )}
        {workplaces.length <= 1 && <input type="hidden" name="workplaceId" value={workplaces[0]?.workplaceId ?? ""} />}
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
      </div>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Čas
        <input type="time" name="time" required className={`${inputClass} max-w-[160px]`} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Dôvod
        <textarea name="reason" rows={2} required className={inputClass} placeholder="Napr. terminál nefungoval, telefón mi spadol." />
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

/** "Chýba mi pípnutie" (terminál nešiel/appka spadla), nie oprava existujúceho. */
export function MissingPunchCard({
  workplaces,
  requests,
}: {
  workplaces: { workplaceId: string; workplaceName: string; isPrimary: boolean }[];
  requests: MissingPunchRequest[];
}) {
  const [open, setOpen] = useState(false);
  const recent = requests.slice(0, 5);

  if (workplaces.length === 0) return null;

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertCircle size={18} className="text-orange" />
          <h3 className="font-serif text-lg font-bold text-ink">Chýba mi pípnutie</h3>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm font-semibold text-orange hover:text-orange-dark"
        >
          {open ? "Zrušiť" : "Nahlásiť"}
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-faint">Terminál nešiel, appka spadla — nahlás, kedy si prišiel/odišiel, manažér to schváli.</p>
      {open && <Form workplaces={workplaces} onDone={() => setOpen(false)} />}
      {recent.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {recent.map((r) => {
            const status = STATUS_LABEL[r.status] ?? { label: r.status, color: "#9C988E" };
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <span className="tabular-nums">{new Date(`${r.date}T00:00:00`).toLocaleDateString("sk-SK")}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                  style={{ background: `${status.color}22`, color: status.color }}
                >
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
