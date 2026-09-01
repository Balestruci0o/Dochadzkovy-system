"use client";

import { Loader2, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  confirmDeleteShiftTemplateAction,
  createShiftTemplateAction,
  requestDeleteShiftTemplateCodeAction,
  toggleShiftTemplateActiveAction,
  updateShiftTemplateAction,
  type ActionState,
} from "@/app/(app)/nastavenia/zmeny/actions";
import { DeleteWithCodeButton } from "@/components/settings/delete-with-code-button";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";
const labelClass = "flex flex-col gap-1 text-sm text-ink";

export type ExistingShiftTemplate = {
  id: string;
  workplaceId: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  breakMode: "minuty" | "presny_cas";
  breakStartTime: string | null;
  breakEndTime: string | null;
  color: string | null;
  isActive: boolean;
};

function ShiftTemplateForm({
  existing,
  workplaceOptions,
  onDone,
}: {
  existing?: ExistingShiftTemplate;
  workplaceOptions: { id: string; name: string }[];
  onDone: () => void;
}) {
  const action = existing ? updateShiftTemplateAction : createShiftTemplateAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [breakMode, setBreakMode] = useState<"minuty" | "presny_cas">(existing?.breakMode ?? "minuty");

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="rounded-md border border-line bg-cream p-4">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div className="flex flex-col gap-4">
        {!existing && (
          <label className={labelClass}>
            Prevádzka
            <select name="workplaceId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                — vyber prevádzku —
              </option>
              {workplaceOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClass}>
            Názov
            <input name="name" required defaultValue={existing?.name} placeholder="Denná recepcia 11h" className={inputClass} />
          </label>
          <label className={labelClass}>
            Kód
            <input name="code" required defaultValue={existing?.code} placeholder="R11" className={inputClass} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClass}>
            Od
            <input name="startTime" type="time" required defaultValue={existing?.startTime} className={inputClass} />
          </label>
          <label className={labelClass}>
            Do
            <input name="endTime" type="time" required defaultValue={existing?.endTime} className={inputClass} />
          </label>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-line-soft bg-cream-2 p-3">
          <span className="text-sm font-semibold text-ink">Prestávka</span>
          <div className="flex gap-4 text-sm text-ink">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="breakMode"
                value="minuty"
                checked={breakMode === "minuty"}
                onChange={() => setBreakMode("minuty")}
                className="accent-orange"
              />
              Počet minút
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="breakMode"
                value="presny_cas"
                checked={breakMode === "presny_cas"}
                onChange={() => setBreakMode("presny_cas")}
                className="accent-orange"
              />
              Presný čas
            </label>
          </div>
          {breakMode === "minuty" ? (
            <label className={labelClass}>
              Minúty
              <input
                name="breakMinutes"
                type="number"
                min={0}
                defaultValue={existing?.breakMode === "minuty" ? existing.breakMinutes : 30}
                className={`${inputClass} max-w-[140px]`}
              />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <label className={labelClass}>
                Prestávka od
                <input name="breakStartTime" type="time" required defaultValue={existing?.breakStartTime ?? ""} className={inputClass} />
              </label>
              <label className={labelClass}>
                Prestávka do
                <input name="breakEndTime" type="time" required defaultValue={existing?.breakEndTime ?? ""} className={inputClass} />
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="crossesMidnight" defaultChecked={existing?.crossesMidnight} className="accent-orange" />
            Smena cez polnoc
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            Farba
            <input name="color" type="color" defaultValue={existing?.color ?? "#c96a3f"} className="h-[34px] w-14 rounded-md border border-line bg-paper" />
          </label>
        </div>

        {state.error && <p className="text-sm text-late">{state.error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
          >
            {pending ? "Ukladám…" : existing ? "Uložiť zmeny" : "Pridať šablónu"}
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

export function ShiftTemplateList({
  templates,
  workplaceOptions,
}: {
  templates: ExistingShiftTemplate[];
  workplaceOptions: { id: string; name: string }[];
}) {
  const [formMode, setFormMode] = useState<"none" | "add" | string>("none");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-ink">Šablóny smien</h3>
        {formMode === "none" && workplaceOptions.length > 0 && (
          <button
            type="button"
            onClick={() => setFormMode("add")}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Nová šablóna
          </button>
        )}
      </div>

      {workplaceOptions.length === 0 && (
        <p className="text-sm text-ink-faint">Najprv pridaj aspoň jednu prevádzku v záložke Prevádzky.</p>
      )}

      {formMode === "add" && (
        <ShiftTemplateForm workplaceOptions={workplaceOptions} onDone={() => setFormMode("none")} />
      )}

      <div className="flex flex-col gap-2">
        {templates.map((t) => {
          if (formMode === t.id) {
            return (
              <ShiftTemplateForm
                key={t.id}
                existing={t}
                workplaceOptions={workplaceOptions}
                onDone={() => setFormMode("none")}
              />
            );
          }
          const workplaceName = workplaceOptions.find((w) => w.id === t.workplaceId)?.name;
          return (
            <div
              key={t.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3 ${!t.isActive ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-3">
                <span className="h-[10px] w-[10px] flex-none rounded-[3px]" style={{ background: t.color ?? "#9C988E" }} />
                <div>
                  <div className="flex items-center gap-2">
                    <b className="text-sm font-semibold text-ink">{t.name}</b>
                    <span className="rounded bg-cream-2 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-ink-faint">
                      {t.code}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {workplaceName} · {t.startTime.slice(0, 5)}–{t.endTime.slice(0, 5)}
                    {t.crossesMidnight ? " (cez polnoc)" : ""} · prestávka{" "}
                    {t.breakMode === "presny_cas" && t.breakStartTime && t.breakEndTime
                      ? `${t.breakStartTime.slice(0, 5)}–${t.breakEndTime.slice(0, 5)}`
                      : `${t.breakMinutes} min`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFormMode(t.id)}
                  className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
                >
                  Upraviť
                </button>
                <form action={toggleShiftTemplateActiveAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="nextActive" value={t.isActive ? "false" : "true"} />
                  <SubmitButton
                    className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
                    pendingContent={<Loader2 size={14} className="animate-spin" />}
                  >
                    {t.isActive ? "Deaktivovať" : "Aktivovať"}
                  </SubmitButton>
                </form>
                <DeleteWithCodeButton
                  id={t.id}
                  label={t.name}
                  requestAction={requestDeleteShiftTemplateCodeAction}
                  confirmAction={confirmDeleteShiftTemplateAction}
                />
              </div>
            </div>
          );
        })}
        {templates.length === 0 && formMode !== "add" && (
          <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadna šablóna smeny.</p>
        )}
      </div>
    </div>
  );
}
