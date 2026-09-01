"use client";

import { useActionState, useEffect } from "react";
import { createWorkplaceAction, updateWorkplaceAction, type ActionState } from "@/app/(app)/nastavenia/prevadzky/actions";
import { WEEKDAYS } from "@/lib/shared/weekdays";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";
const labelClass = "flex flex-col gap-1 text-sm text-ink";

export type ExistingWorkplace = {
  id: string;
  name: string;
  code: string;
  timezone: string;
  operatingDays: number[];
  operatesHolidays: boolean;
  gpsLat: string | null;
  gpsLng: string | null;
  gpsRadiusM: number | null;
  isActive: boolean;
};

export function WorkplaceForm({ existing, onDone }: { existing?: ExistingWorkplace; onDone: () => void }) {
  const action = existing ? updateWorkplaceAction : createWorkplaceAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="rounded-md border border-line bg-cream p-4">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClass}>
            Názov
            <input name="name" required defaultValue={existing?.name} className={inputClass} />
          </label>
          <label className={labelClass}>
            Kód
            <input name="code" required defaultValue={existing?.code} placeholder="HOTEL" className={inputClass} />
          </label>
        </div>

        <label className={labelClass}>
          Časové pásmo
          <input
            name="timezone"
            defaultValue={existing?.timezone ?? "Europe/Bratislava"}
            className={inputClass}
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm text-ink">Prevádzkové dni</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <label
                key={d.value}
                className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm has-[:checked]:border-orange has-[:checked]:bg-orange-tint"
              >
                <input
                  type="checkbox"
                  name="operatingDays"
                  value={d.value}
                  defaultChecked={existing ? existing.operatingDays.includes(d.value) : true}
                  className="accent-orange"
                />
                {d.short}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="operatesHolidays"
            defaultChecked={existing?.operatesHolidays ?? true}
            className="accent-orange"
          />
          V prevádzke aj počas sviatkov
        </label>

        <div>
          <span className="mb-1.5 block text-sm text-ink">GPS (pre soft kontrolu pri pípaní z webu)</span>
          <div className="grid grid-cols-3 gap-3">
            <label className={labelClass}>
              Zemepisná šírka
              <input
                name="gpsLat"
                type="number"
                step="0.0000001"
                defaultValue={existing?.gpsLat ?? ""}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Zemepisná dĺžka
              <input
                name="gpsLng"
                type="number"
                step="0.0000001"
                defaultValue={existing?.gpsLng ?? ""}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Okruh (m)
              <input
                name="gpsRadiusM"
                type="number"
                min={0}
                defaultValue={existing?.gpsRadiusM ?? 150}
                className={inputClass}
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            GPS nikdy neblokuje pípnutie — mimo okruhu sa razítko len označí ako podozrivé.
          </p>
        </div>

        {state.error && <p className="text-sm text-late">{state.error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
          >
            {pending ? "Ukladám…" : existing ? "Uložiť zmeny" : "Pridať prevádzku"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
          >
            Zrušiť
          </button>
        </div>
      </div>
    </form>
  );
}
