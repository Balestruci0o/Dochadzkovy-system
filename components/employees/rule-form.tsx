"use client";

import { useActionState, useEffect, useState } from "react";
import {
  addAvailabilityRuleAction,
  updateAvailabilityRuleAction,
  type ActionState,
} from "@/app/(app)/zamestnanci/[id]/actions";
import {
  RULE_TYPE_CONFIG,
  RULE_TYPE_OPTIONS,
  type AvailabilityRuleType,
} from "./availability-rule-types";
import { RuleParamInputs } from "./rule-param-inputs";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

export type ExistingRule = {
  id: string;
  ruleType: AvailabilityRuleType;
  params: Record<string, unknown>;
  isHard: boolean;
  priority: number;
  note: string | null;
  workplaceId: string | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
};

export function RuleForm({
  employeeId,
  workplaceOptions,
  shiftTemplateOptions,
  existing,
  onDone,
}: {
  employeeId: string;
  workplaceOptions: { id: string; name: string }[];
  shiftTemplateOptions: { id: string; name: string }[];
  existing?: ExistingRule;
  onDone: () => void;
}) {
  const action = existing ? updateAvailabilityRuleAction : addAvailabilityRuleAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [ruleType, setRuleType] = useState<AvailabilityRuleType>(
    existing?.ruleType ?? RULE_TYPE_OPTIONS[0].value,
  );
  const [isHard, setIsHard] = useState(existing?.isHard ?? true);

  useEffect(() => {
    // Akcia dobehla úspešne — zavri formulár (revalidatePath už obnovil dáta).
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone by mal byť stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="rounded-md border border-line bg-cream p-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      {existing && <input type="hidden" name="ruleId" value={existing.id} />}

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Typ pravidla
          <select
            name="ruleType"
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value as AvailabilityRuleType)}
            className={inputClass}
          >
            {RULE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-faint">{RULE_TYPE_CONFIG[ruleType].shortHelp}</span>
        </label>

        <RuleParamInputs
          shape={RULE_TYPE_CONFIG[ruleType].paramShape}
          params={existing?.ruleType === ruleType ? existing.params : undefined}
          shiftTemplateOptions={shiftTemplateOptions}
        />

        {/* Hard/soft — najdôležitejší prepínač v celej appke. */}
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
              <span className="text-xs text-ink-soft">
                Generátor ho nikdy neporuší — radšej nechá v rozvrhu dieru.
              </span>
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
              <span className="text-xs text-ink-soft">
                Poruší sa, len ak niet inej možnosti — a vždy sa to nahlási.
              </span>
            </label>
          </div>
        </div>

        {!isHard && (
          <label className="flex flex-col gap-1 text-sm text-ink">
            Priorita (nižšie číslo = dôležitejšie pri porušení)
            <input
              type="number"
              name="priority"
              min={1}
              defaultValue={existing?.priority ?? 100}
              className={`${inputClass} w-28`}
            />
          </label>
        )}

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Platí len v prevádzke
            <select name="workplaceId" defaultValue={existing?.workplaceId ?? ""} className={inputClass}>
              <option value="">— všade —</option>
              {workplaceOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm text-ink">
              Platné od
              <input
                type="date"
                name="validFrom"
                defaultValue={existing?.validFrom ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Platné do
              <input type="date" name="validTo" defaultValue={existing?.validTo ?? ""} className={inputClass} />
            </label>
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm text-ink">
          Poznámka
          <textarea name="note" rows={2} defaultValue={existing?.note ?? ""} className={inputClass} />
        </label>

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
