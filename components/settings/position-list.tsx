"use client";

import { Loader2, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  confirmDeletePositionAction,
  createPositionAction,
  requestDeletePositionCodeAction,
  togglePositionActiveAction,
  updatePositionAction,
  type ActionState,
} from "@/app/(app)/nastavenia/pozicie/actions";
import { PositionPill } from "@/components/employees/position-pill";
import { HelpTooltip } from "@/components/help/help-tooltip";
import { DeleteWithCodeButton } from "@/components/settings/delete-with-code-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { GLOSSARY } from "@/lib/help/glossary";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

export type ExistingPosition = {
  id: string;
  name: string;
  color: string | null;
  workplaceId: string | null;
  isActive: boolean;
  breakTrackingMode: "automaticky" | "pipa";
  payMode: "hodinovy" | "fixny";
  departureMode: "pipa" | "nepipa";
  requiresShiftLeader: boolean;
};

function PositionForm({
  existing,
  workplaceOptions,
  onDone,
}: {
  existing?: ExistingPosition;
  workplaceOptions: { id: string; name: string }[];
  onDone: () => void;
}) {
  const action = existing ? updatePositionAction : createPositionAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-cream p-3.5">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <label className="flex flex-col gap-1 text-sm text-ink">
        Názov
        <input name="name" required defaultValue={existing?.name} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Farba
        <input name="color" type="color" defaultValue={existing?.color ?? "#8a9a5b"} className="h-[38px] w-14 rounded-md border border-line bg-paper" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Prevádzka
        <select name="workplaceId" defaultValue={existing?.workplaceId ?? ""} className={inputClass}>
          <option value="">— naprieč všetkými —</option>
          {workplaceOptions.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        <span className="inline-flex items-center gap-1">
          Prestávky
          <HelpTooltip term={GLOSSARY.rezimPrestavky.term} explanation={GLOSSARY.rezimPrestavky.explanation} />
        </span>
        <select name="breakTrackingMode" defaultValue={existing?.breakTrackingMode ?? "automaticky"} className={inputClass}>
          <option value="automaticky">Automaticky zo šablóny</option>
          <option value="pipa">Pípa si prestávky</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        <span className="inline-flex items-center gap-1">
          Režim odchodu
          <HelpTooltip term={GLOSSARY.rezimOdchodu.term} explanation={GLOSSARY.rezimOdchodu.explanation} />
        </span>
        <select name="departureMode" defaultValue={existing?.departureMode ?? "pipa"} className={inputClass}>
          <option value="pipa">Pípa odchod</option>
          <option value="nepipa">Nepípa (auto na konci smeny)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        <span className="inline-flex items-center gap-1">
          Režim odmeňovania
          <HelpTooltip term={GLOSSARY.rezimOdmenovania.term} explanation={GLOSSARY.rezimOdmenovania.explanation} />
        </span>
        <select name="payMode" defaultValue={existing?.payMode ?? "hodinovy"} className={inputClass}>
          <option value="hodinovy">Hodinová sadzba</option>
          <option value="fixny">Fixný plat</option>
        </select>
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm text-ink">
        <input
          type="checkbox"
          name="requiresShiftLeader"
          defaultChecked={existing?.requiresShiftLeader ?? false}
          className="accent-orange"
        />
        Vyžaduje vedúceho zmeny
        <HelpTooltip term={GLOSSARY.veduciSmeny.term} explanation={GLOSSARY.veduciSmeny.explanation} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Ukladám…" : existing ? "Uložiť" : "Pridať"}
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

export function PositionList({
  positions,
  workplaceOptions,
}: {
  positions: ExistingPosition[];
  workplaceOptions: { id: string; name: string }[];
}) {
  const [formMode, setFormMode] = useState<"none" | "add" | string>("none");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-ink">Pozície</h3>
        {formMode === "none" && (
          <button
            type="button"
            onClick={() => setFormMode("add")}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Nová pozícia
          </button>
        )}
      </div>

      {formMode === "add" && (
        <PositionForm workplaceOptions={workplaceOptions} onDone={() => setFormMode("none")} />
      )}

      <div className="flex flex-col gap-2">
        {positions.map((p) => {
          if (formMode === p.id) {
            return (
              <PositionForm
                key={p.id}
                existing={p}
                workplaceOptions={workplaceOptions}
                onDone={() => setFormMode("none")}
              />
            );
          }
          const workplaceName = workplaceOptions.find((w) => w.id === p.workplaceId)?.name;
          return (
            <div
              key={p.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3 ${!p.isActive ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-3">
                <PositionPill name={p.name} color={p.color} />
                <span className="text-xs text-ink-faint">{workplaceName ?? "naprieč všetkými prevádzkami"}</span>
                {p.breakTrackingMode === "pipa" && (
                  <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sage-dark">
                    Pípa prestávky
                  </span>
                )}
                {p.departureMode === "nepipa" && (
                  <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sage-dark">
                    Nepípa odchod (auto)
                  </span>
                )}
                {p.payMode === "fixny" && (
                  <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sage-dark">
                    Fixný plat
                  </span>
                )}
                {p.requiresShiftLeader && (
                  <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
                    Vyžaduje vedúceho
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFormMode(p.id)}
                  className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
                >
                  Upraviť
                </button>
                <form action={togglePositionActiveAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="nextActive" value={p.isActive ? "false" : "true"} />
                  <SubmitButton
                    className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
                    pendingContent={<Loader2 size={14} className="animate-spin" />}
                  >
                    {p.isActive ? "Deaktivovať" : "Aktivovať"}
                  </SubmitButton>
                </form>
                <DeleteWithCodeButton
                  id={p.id}
                  label={p.name}
                  requestAction={requestDeletePositionCodeAction}
                  confirmAction={confirmDeletePositionAction}
                />
              </div>
            </div>
          );
        })}
        {positions.length === 0 && formMode !== "add" && (
          <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadna pozícia.</p>
        )}
      </div>
    </div>
  );
}
