"use client";

import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  addPairingAction,
  deletePairingAction,
  type ActionState,
} from "@/app/(app)/zamestnanci/[id]/actions";
import type { EmployeePairing } from "@/app/(app)/zamestnanci/[id]/data";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

function AddPairingForm({
  employeeId,
  candidates,
  onDone,
}: {
  employeeId: string;
  candidates: { id: string; firstName: string; lastName: string }[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(addPairingAction, initialState);
  const [isHard, setIsHard] = useState(false);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="mb-4 flex flex-col gap-3 rounded-md border border-line bg-cream p-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label className="flex flex-col gap-1 text-sm text-ink">
        Spárovať s
        <select name="partnerId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            — vyber zamestnanca —
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-faint">
          Ktokoľvek aktívny v družstve — pár funguje aj naprieč rôznymi pozíciami a prevádzkami.
        </span>
      </label>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-ink">Ako prísne platí?</span>
        <div className="grid grid-cols-2 gap-2">
          <label
            className={`cursor-pointer rounded-md border-2 p-3 text-sm transition-colors ${
              !isHard ? "border-gold bg-gold-tint" : "border-line bg-paper"
            }`}
          >
            <input type="radio" name="isHard" value="false" checked={!isHard} onChange={() => setIsHard(false)} className="sr-only" />
            <b className="block text-ink">Mäkké (soft)</b>
            <span className="text-xs text-ink-soft">Generátor sa snaží dať ich v ten istý deň, ak to vyjde.</span>
          </label>
          <label
            className={`cursor-pointer rounded-md border-2 p-3 text-sm transition-colors ${
              isHard ? "border-late bg-late-tint" : "border-line bg-paper"
            }`}
          >
            <input type="radio" name="isHard" value="true" checked={isHard} onChange={() => setIsHard(true)} className="sr-only" />
            <b className="block text-ink">Tvrdé (hard)</b>
            <span className="text-xs text-ink-soft">Musia mať smenu v ten istý deň vždy — inak radšej diera pre oboch.</span>
          </label>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm text-ink">
        Poznámka (voliteľné)
        <input name="note" placeholder="napr. dôvod párovania" className={inputClass} />
      </label>

      {state.error && <p className="text-sm text-late">{state.error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
        >
          {pending ? "Pridávam…" : "Pridať pár"}
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

export function PairingsSection({
  employeeId,
  pairings,
  candidates,
  canEdit,
}: {
  employeeId: string;
  pairings: EmployeePairing[];
  candidates: { id: string; firstName: string; lastName: string }[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-serif text-lg font-bold text-ink">
          <Users size={18} className="text-ink-faint" /> Párovanie so zamestnancom
        </h3>
        {canEdit && !adding && candidates.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Pridať pár
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        „Pracuje preferovane s…&rdquo; — nezávisle od pozície aj prevádzky. Platí, keď obaja majú smenu v ten istý
        kalendárny deň, aj keď na inom mieste alebo v inom čase.
      </p>

      {adding && <AddPairingForm employeeId={employeeId} candidates={candidates} onDone={() => setAdding(false)} />}

      <div className="flex flex-col gap-2">
        {pairings.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-sm font-semibold text-ink">{p.partnerName}</b>
                {p.isHard ? (
                  <span className="rounded-full bg-late-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-late">
                    Hard
                  </span>
                ) : (
                  <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
                    Soft
                  </span>
                )}
              </div>
              {p.note && <p className="mt-1 text-xs text-ink-faint">„{p.note}&rdquo;</p>}
            </div>
            {canEdit && (
              <form action={deletePairingAction}>
                <input type="hidden" name="pairingId" value={p.id} />
                <input type="hidden" name="employeeId" value={employeeId} />
                <SubmitButton
                  className="rounded p-1.5 text-ink-soft transition hover:bg-late-tint hover:text-late disabled:opacity-60"
                  aria-label={`Zrušiť párovanie s ${p.partnerName}`}
                  pendingContent={<Loader2 size={15} className="animate-spin" />}
                >
                  <Trash2 size={15} />
                </SubmitButton>
              </form>
            )}
          </div>
        ))}
        {pairings.length === 0 && !adding && (
          <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadne párovanie.</p>
        )}
      </div>
    </div>
  );
}
