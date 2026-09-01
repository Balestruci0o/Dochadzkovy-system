"use client";

import { Loader2, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  confirmDeleteCoverageAction,
  createCoverageAction,
  requestDeleteCoverageCodeAction,
  toggleCoverageActiveAction,
  updateCoverageAction,
  type ActionState,
} from "@/app/(app)/nastavenia/pokrytie/actions";
import { DeleteWithCodeButton } from "@/components/settings/delete-with-code-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { WEEKDAYS } from "@/lib/shared/weekdays";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";
const labelClass = "flex flex-col gap-1 text-sm text-ink";

export type ExistingCoverage = {
  id: string;
  workplaceId: string;
  positionId: string | null;
  shiftTemplateId: string | null;
  minPeople: number;
  maxPeople: number | null;
  weekdays: number[] | null;
  appliesHolidays: boolean;
  isHard: boolean;
  isActive: boolean;
};

export type ShiftTemplateOption = { id: string; name: string; workplaceId: string; startTime: string; endTime: string };

function describeDays(days: number[] | null): string {
  if (!days || days.length === 7) return "každý deň";
  return WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => d.short)
    .join(", ");
}

function CoverageForm({
  existing,
  workplaceOptions,
  positionOptions,
  shiftTemplateOptions,
  onDone,
}: {
  existing?: ExistingCoverage;
  workplaceOptions: { id: string; name: string }[];
  positionOptions: { id: string; name: string }[];
  shiftTemplateOptions: ShiftTemplateOption[];
  onDone: () => void;
}) {
  const action = existing ? updateCoverageAction : createCoverageAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [isHard, setIsHard] = useState(existing?.isHard ?? true);
  // Šablóny zmien sú viazané na PREVÁDZKU — pri zakladaní sa výber zmeny
  // odomkne až po výbere prevádzky (kaskáda), pri úprave je prevádzka pevná.
  const [workplaceId, setWorkplaceId] = useState(existing?.workplaceId ?? "");
  const templatesForWorkplace = shiftTemplateOptions.filter((t) => t.workplaceId === workplaceId);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="rounded-md border border-line bg-cream p-4">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          {!existing && (
            <label className={labelClass}>
              Prevádzka
              <select
                name="workplaceId"
                required
                value={workplaceId}
                onChange={(e) => setWorkplaceId(e.target.value)}
                className={inputClass}
              >
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
          <label className={labelClass}>
            Pozícia
            <select name="positionId" defaultValue={existing?.positionId ?? ""} className={inputClass}>
              <option value="">— ktokoľvek —</option>
              {positionOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className={labelClass}>
          Smena
          <select
            name="shiftTemplateId"
            required
            defaultValue={existing?.shiftTemplateId ?? ""}
            disabled={!workplaceId}
            className={inputClass}
          >
            <option value="" disabled>
              {workplaceId ? "— vyber smenu —" : "— najprv vyber prevádzku —"}
            </option>
            {templatesForWorkplace.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.startTime.slice(0, 5)}–{t.endTime.slice(0, 5)})
              </option>
            ))}
          </select>
          {workplaceId && templatesForWorkplace.length === 0 && (
            <span className="text-xs text-late">Táto prevádzka nemá zatiaľ žiadnu šablónu smeny — pridaj ju v Nastaveniach → Smeny.</span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className={labelClass}>
            Min. počet ľudí
            <input
              name="minPeople"
              type="number"
              min={0}
              required
              defaultValue={existing?.minPeople ?? 1}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Max. počet ľudí (voliteľné)
            <input name="maxPeople" type="number" min={0} defaultValue={existing?.maxPeople ?? ""} className={inputClass} />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-sm text-ink">Kedy platí</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <label
                key={d.value}
                className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm has-[:checked]:border-orange has-[:checked]:bg-orange-tint"
              >
                <input
                  type="checkbox"
                  name="weekdays"
                  value={d.value}
                  defaultChecked={existing ? (existing.weekdays ?? []).includes(d.value) : true}
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
            name="appliesHolidays"
            defaultChecked={existing?.appliesHolidays ?? true}
            className="accent-orange"
          />
          Platí aj počas sviatkov
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-ink">Ako prísne platí?</span>
          <div className="grid grid-cols-2 gap-2">
            <label
              className={`cursor-pointer rounded-md border-2 p-3 text-sm transition-colors ${
                isHard ? "border-late bg-late-tint" : "border-line bg-paper"
              }`}
            >
              <input
                type="radio"
                name="isHard"
                value="true"
                checked={isHard}
                onChange={() => setIsHard(true)}
                className="sr-only"
              />
              <b className="block text-ink">Tvrdé (hard)</b>
              <span className="text-xs text-ink-soft">Generátor ho nikdy neporuší — radšej nechá v rozvrhu dieru.</span>
            </label>
            <label
              className={`cursor-pointer rounded-md border-2 p-3 text-sm transition-colors ${
                !isHard ? "border-gold bg-gold-tint" : "border-line bg-paper"
              }`}
            >
              <input
                type="radio"
                name="isHard"
                value="false"
                checked={!isHard}
                onChange={() => setIsHard(false)}
                className="sr-only"
              />
              <b className="block text-ink">Mäkké (soft)</b>
              <span className="text-xs text-ink-soft">Poruší sa, len ak niet inej možnosti — a vždy sa to nahlási.</span>
            </label>
          </div>
        </div>

        {state.error && <p className="text-sm text-late">{state.error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
          >
            {pending ? "Ukladám…" : existing ? "Uložiť zmeny" : "Pridať pravidlo"}
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

export function CoverageList({
  requirements,
  workplaceOptions,
  positionOptions,
  shiftTemplateOptions,
}: {
  requirements: ExistingCoverage[];
  workplaceOptions: { id: string; name: string }[];
  positionOptions: { id: string; name: string }[];
  shiftTemplateOptions: ShiftTemplateOption[];
}) {
  const [formMode, setFormMode] = useState<"none" | "add" | string>("none");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-ink">Požiadavky na pokrytie</h3>
        {formMode === "none" && workplaceOptions.length > 0 && (
          <button
            type="button"
            onClick={() => setFormMode("add")}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Nové pravidlo
          </button>
        )}
      </div>

      {workplaceOptions.length === 0 && (
        <p className="text-sm text-ink-faint">Najprv pridaj aspoň jednu prevádzku v záložke Prevádzky.</p>
      )}

      {formMode === "add" && (
        <CoverageForm
          workplaceOptions={workplaceOptions}
          positionOptions={positionOptions}
          shiftTemplateOptions={shiftTemplateOptions}
          onDone={() => setFormMode("none")}
        />
      )}

      <div className="flex flex-col gap-2">
        {requirements.map((r) => {
          if (formMode === r.id) {
            return (
              <CoverageForm
                key={r.id}
                existing={r}
                workplaceOptions={workplaceOptions}
                positionOptions={positionOptions}
                shiftTemplateOptions={shiftTemplateOptions}
                onDone={() => setFormMode("none")}
              />
            );
          }
          const workplaceName = workplaceOptions.find((w) => w.id === r.workplaceId)?.name;
          const positionName = positionOptions.find((p) => p.id === r.positionId)?.name ?? "ktokoľvek";
          const shiftTemplate = shiftTemplateOptions.find((t) => t.id === r.shiftTemplateId);
          return (
            <div
              key={r.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3.5 ${!r.isActive ? "opacity-50" : ""}`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm font-semibold text-ink">{workplaceName}</b>
                  <span className="text-sm text-ink-soft">{positionName}</span>
                  {r.isHard ? (
                    <span className="rounded-full bg-late-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-late">
                      Hard
                    </span>
                  ) : (
                    <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
                      Soft
                    </span>
                  )}
                  {!shiftTemplate && (
                    <span className="rounded-full bg-late-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-late">
                      ⚠ Bez smeny
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  min. {r.minPeople}
                  {r.maxPeople ? `, max. ${r.maxPeople}` : ""} ľudí · {describeDays(r.weekdays)}
                  {r.appliesHolidays ? "" : " · nie počas sviatkov"}
                  {shiftTemplate
                    ? ` · ${shiftTemplate.name} (${shiftTemplate.startTime.slice(0, 5)}–${shiftTemplate.endTime.slice(0, 5)})`
                    : " · chýba priradená smena — generátor toto pravidlo ignoruje"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFormMode(r.id)}
                  className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
                >
                  Upraviť
                </button>
                <form action={toggleCoverageActiveAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="nextActive" value={r.isActive ? "false" : "true"} />
                  <SubmitButton
                    className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
                    pendingContent={<Loader2 size={14} className="animate-spin" />}
                  >
                    {r.isActive ? "Deaktivovať" : "Aktivovať"}
                  </SubmitButton>
                </form>
                <DeleteWithCodeButton
                  id={r.id}
                  label={`${workplaceName} — ${positionName}`}
                  requestAction={requestDeleteCoverageCodeAction}
                  confirmAction={confirmDeleteCoverageAction}
                />
              </div>
            </div>
          );
        })}
        {requirements.length === 0 && formMode !== "add" && (
          <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadne pravidlo pokrytia.</p>
        )}
      </div>
    </div>
  );
}
