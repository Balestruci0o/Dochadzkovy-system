"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  confirmDeleteLegalRuleAction,
  createLegalRuleAction,
  requestDeleteLegalRuleCodeAction,
  toggleLegalRuleActiveAction,
  updateLegalRuleAction,
  type ActionState,
} from "@/app/(app)/nastavenia/pravidla/actions";
import { DeleteWithCodeButton } from "@/components/settings/delete-with-code-button";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

// Iba kozmetický preklad známych kľúčov na slovenský popisok. Neznámy kľúč sa
// zobrazí tak, ako je — pravidlo môže mať ĽUBOVOĽNÝ tvar params (JSONB),
// tento zoznam nič nevynucuje ani neobmedzuje.
const PARAM_LABELS: Record<string, string> = {
  hours: "Hodiny",
  after_hours: "Po koľkých hodinách práce",
  break_minutes: "Dĺžka prestávky (min)",
};

// Kódy, ktoré generátor (lib/scheduler/rules.ts, generate.ts, db-loader.ts)
// REÁLNE číta — len našepkávač (datalist), owner môže zadať aj vlastný kód
// (napr. na budúce použitie alebo len ako dokumentáciu).
const KNOWN_CODES = ["MIN_REST_DAILY", "MIN_REST_WEEKLY", "MAX_CONSEC_DAYS", "MAX_WEEKLY_HOURS", "MAX_SHIFT_HOURS", "BREAK_AFTER_HOURS"];

function paramLabel(key: string): string {
  return PARAM_LABELS[key] ?? key;
}

export type ExistingLegalRule = {
  id: string;
  code: string;
  name: string;
  params: Record<string, unknown>;
  isHard: boolean;
  lawReference: string | null;
  isActive: boolean;
};

function HardSoftPicker({ isHard, onChange }: { isHard: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-ink">Ako prísne platí?</span>
      <div className="grid grid-cols-2 gap-2">
        <label
          className={`cursor-pointer rounded-md border-2 p-3 text-sm transition-colors ${
            isHard ? "border-late bg-late-tint" : "border-line bg-paper"
          }`}
        >
          <input type="radio" name="isHard" value="true" checked={isHard} onChange={() => onChange(true)} className="sr-only" />
          <b className="block text-ink">Tvrdé (hard)</b>
          <span className="text-xs text-ink-soft">Generátor ho nikdy neporuší.</span>
        </label>
        <label
          className={`cursor-pointer rounded-md border-2 p-3 text-sm transition-colors ${
            !isHard ? "border-gold bg-gold-tint" : "border-line bg-paper"
          }`}
        >
          <input type="radio" name="isHard" value="false" checked={!isHard} onChange={() => onChange(false)} className="sr-only" />
          <b className="block text-ink">Mäkké (soft)</b>
          <span className="text-xs text-ink-soft">Poruší sa, len ak niet inej možnosti.</span>
        </label>
      </div>
    </div>
  );
}

function LegalRuleForm({ rule, onDone }: { rule: ExistingLegalRule; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateLegalRuleAction, initialState);
  const [isHard, setIsHard] = useState(rule.isHard);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="rounded-md border border-line bg-cream p-4">
      <input type="hidden" name="id" value={rule.id} />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Object.entries(rule.params).map(([key, value]) => (
            <label key={key} className="flex flex-col gap-1 text-sm text-ink">
              {paramLabel(key)}
              <input
                name={`param__${key}`}
                type="number"
                step="any"
                defaultValue={typeof value === "number" ? value : String(value)}
                className={inputClass}
              />
            </label>
          ))}
        </div>

        <HardSoftPicker isHard={isHard} onChange={setIsHard} />

        {state.error && <p className="text-sm text-late">{state.error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
          >
            {pending ? "Ukladám…" : "Uložiť zmeny"}
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

type NewParamRow = { id: number; key: string; value: string };
let nextRowId = 0;

function CreateLegalRuleForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(createLegalRuleAction, initialState);
  const [isHard, setIsHard] = useState(true);
  const [rows, setRows] = useState<NewParamRow[]>([{ id: nextRowId++, key: "", value: "" }]);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  function updateRow(id: number, field: "key" | "value", v: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: v } : r)));
  }

  return (
    <form action={formAction} className="rounded-md border border-line bg-cream p-4">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Kód
            <input name="code" list="known-legal-codes" required placeholder="napr. MAX_WEEKLY_HOURS" className={`${inputClass} uppercase`} />
            <datalist id="known-legal-codes">
              {KNOWN_CODES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <span className="text-xs text-ink-faint">
              Generátor priamo pozná len tieto kódy: {KNOWN_CODES.join(", ")}. Iný kód sa uloží, ale generátor ho zatiaľ nečíta.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Názov
            <input name="name" required placeholder="napr. Max. hodín týždenne" className={inputClass} />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-ink">
          Zákonná referencia (voliteľné)
          <input name="lawReference" placeholder="napr. §85 ods. 5 ZP" className={inputClass} />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-ink">Parametre</span>
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <input
                  name="paramKey"
                  value={row.key}
                  onChange={(e) => updateRow(row.id, "key", e.target.value)}
                  placeholder="kľúč, napr. hours"
                  className={`${inputClass} flex-1`}
                />
                <input
                  name="paramValue"
                  type="number"
                  step="any"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, "value", e.target.value)}
                  placeholder="hodnota"
                  className={`${inputClass} w-28`}
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                    className="rounded p-1.5 text-ink-faint hover:bg-cream-2 hover:text-late"
                    aria-label="Odobrať parameter"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { id: nextRowId++, key: "", value: "" }])}
            className="mt-2 text-xs font-semibold text-orange hover:underline"
          >
            + pridať parameter
          </button>
        </div>

        <HardSoftPicker isHard={isHard} onChange={setIsHard} />

        {state.error && <p className="text-sm text-late">{state.error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
          >
            {pending ? "Vytváram…" : "Pridať pravidlo"}
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

export function LegalRuleList({ rules }: { rules: ExistingLegalRule[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-lg font-bold text-ink">§ZP pravidlá</h3>
          <p className="mt-1 text-xs text-ink-faint">
            Zákonné limity — nie sú zadrátované v kóde. Zmena parametra sa okamžite prejaví v generátore rozvrhu.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex flex-none items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Nové pravidlo
          </button>
        )}
      </div>

      {creating && <CreateLegalRuleForm onDone={() => setCreating(false)} />}

      <div className="flex flex-col gap-2">
        {rules.map((r) => {
          if (editingId === r.id) {
            return <LegalRuleForm key={r.id} rule={r} onDone={() => setEditingId(null)} />;
          }
          return (
            <div
              key={r.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3.5 ${!r.isActive ? "opacity-50" : ""}`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm font-semibold text-ink">{r.name}</b>
                  <span className="rounded bg-cream-2 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-ink-faint">{r.code}</span>
                  {r.lawReference && <span className="text-xs text-ink-faint">{r.lawReference}</span>}
                  {r.isHard ? (
                    <span className="rounded-full bg-late-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-late">
                      Hard
                    </span>
                  ) : (
                    <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
                      Soft
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  {Object.entries(r.params)
                    .map(([key, value]) => `${paramLabel(key)}: ${value}`)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditingId(r.id)}
                  className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
                >
                  Upraviť
                </button>
                <form action={toggleLegalRuleActiveAction}>
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
                  label={`${r.name} (${r.code})`}
                  requestAction={requestDeleteLegalRuleCodeAction}
                  confirmAction={confirmDeleteLegalRuleAction}
                />
              </div>
            </div>
          );
        })}
        {rules.length === 0 && <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadne §ZP pravidlo.</p>}
      </div>
    </div>
  );
}
