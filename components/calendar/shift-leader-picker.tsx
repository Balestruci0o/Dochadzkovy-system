"use client";

import { Crown, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { assignShiftLeaderAction, type AssignShiftLeaderState } from "@/app/(app)/kalendar/actions";
import { MONTH_NAMES } from "@/lib/shared/dates";
import { WEEKDAYS } from "@/lib/shared/weekdays";

export type ShiftLeaderPickerTarget = {
  positionId: string;
  positionName: string;
  date: string;
  x: number;
  y: number;
};

export type ShiftLeaderCandidate = {
  employeeId: string;
  name: string;
  canBeShiftLeader: boolean;
};

const initialState: AssignShiftLeaderState = {};

/**
 * Vedúci smeny, krok 5 — jeden kandidát = vlastný `useActionState`/`<form>`
 * (rovnaký dôvod ako `ShiftOption` v `cell-picker.tsx`: kliknutie na INÉHO
 * kandidáta nesmie zobraziť cudzie upozornenie). "AJ TAK" sa objaví LEN keď
 * `can_be_shift_leader` chýba — server to vráti ako `violations`, nie `error`
 * (na rozdiel od "nie je tam v ten deň priradený", čo je tvrdá chyba).
 */
function CandidateOption({
  candidate,
  isCurrent,
  workplaceId,
  target,
  onAssigned,
}: {
  candidate: ShiftLeaderCandidate;
  isCurrent: boolean;
  workplaceId: string;
  target: ShiftLeaderPickerTarget;
  onAssigned: () => void;
}) {
  const [state, formAction, pending] = useActionState(assignShiftLeaderAction, initialState);

  useEffect(() => {
    if (state.success) onAssigned();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAssigned je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  const violations = state.violations ?? [];
  const needsConfirm = violations.length > 0;

  return (
    <form action={formAction} className="px-2.5 py-1">
      <input type="hidden" name="workplaceId" value={workplaceId} />
      <input type="hidden" name="positionId" value={target.positionId} />
      <input type="hidden" name="date" value={target.date} />
      <input type="hidden" name="employeeId" value={candidate.employeeId} />
      {needsConfirm && <input type="hidden" name="confirmOverride" value="true" />}

      <button
        type="submit"
        disabled={pending}
        className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left text-[13.5px] transition-colors hover:bg-cream-2 disabled:opacity-60 ${isCurrent ? "bg-sage-tint" : ""}`}
      >
        {isCurrent && <Crown size={13} className="flex-none text-[#A8761A]" />}
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{candidate.name}</span>
        {!candidate.canBeShiftLeader && <span className="flex-none text-[10px] uppercase tracking-wide text-ink-faint">bez oprávnenia</span>}
      </button>

      {state.error && <p className="mt-1 pl-1 text-[11px] text-late">{state.error}</p>}

      {needsConfirm && (
        <div className="mt-1.5 rounded-md border border-late/40 bg-late-tint p-2">
          {violations.map((v, i) => (
            <p key={i} className="text-[11px] leading-snug text-[#A8761A]">
              {v.message}
            </p>
          ))}
          <button
            type="submit"
            disabled={pending}
            className="mt-1.5 w-full rounded-md bg-late px-2 py-1.5 text-[12px] font-semibold text-white transition hover:bg-late/90 disabled:opacity-60"
          >
            {pending ? "Priraďujem…" : "Priradiť AJ TAK"}
          </button>
        </div>
      )}
    </form>
  );
}

/** "— žiadny vedúci —" — VEDOMÁ voľba (employeeId prázdne → server zapíše employee_id=null, source='manual'), nie generátorová diera. */
function NoLeaderOption({ isCurrentlyNoLeader, workplaceId, target, onAssigned }: { isCurrentlyNoLeader: boolean; workplaceId: string; target: ShiftLeaderPickerTarget; onAssigned: () => void }) {
  const [state, formAction, pending] = useActionState(assignShiftLeaderAction, initialState);

  useEffect(() => {
    if (state.success) onAssigned();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAssigned je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="px-2.5 py-1">
      <input type="hidden" name="workplaceId" value={workplaceId} />
      <input type="hidden" name="positionId" value={target.positionId} />
      <input type="hidden" name="date" value={target.date} />
      <button
        type="submit"
        disabled={pending}
        className={`flex w-full items-center gap-2 rounded-lg py-1.5 text-left text-[13.5px] text-ink-soft transition-colors hover:bg-cream-2 disabled:opacity-60 ${isCurrentlyNoLeader ? "bg-sage-tint" : ""}`}
      >
        <X size={13} className="flex-none" />
        Bez vedúceho
      </button>
      {state.error && <p className="mt-1 pl-1 text-[11px] text-late">{state.error}</p>}
    </form>
  );
}

export function ShiftLeaderPicker({
  target,
  workplaceId,
  candidates,
  currentEmployeeId,
  onClose,
}: {
  target: ShiftLeaderPickerTarget;
  workplaceId: string;
  candidates: ShiftLeaderCandidate[];
  /** `null` = žiadny vedúci ešte rozhodnutý ALEBO vedome nastavené "bez vedúceho" — obe UI predvyplní rovnako, konkrétny stav je vidieť v riadku kalendára. */
  currentEmployeeId: string | null;
  onClose: () => void;
}) {
  const d = new Date(`${target.date}T00:00:00`);
  const dow = ((d.getDay() + 6) % 7) + 1;
  const weekdayLabel = WEEKDAYS.find((w) => w.value === dow)?.label ?? "";
  const title = `${target.positionName} — ${weekdayLabel} ${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}`;

  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", left: target.x, top: target.y + 6, visibility: "hidden", zIndex: 60 });

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxHeight = vh - margin * 2;
    const height = Math.min(el.scrollHeight, maxHeight);
    const left = Math.min(target.x, vw - el.offsetWidth - margin);
    let top = target.y + 6;
    if (top + height > vh - margin) top = Math.max(margin, vh - margin - height);
    setStyle({ position: "fixed", left: Math.max(margin, left), top, maxHeight, zIndex: 60 });
  }, [target.x, target.y]);

  return (
    <div ref={panelRef} style={style} onClick={(e) => e.stopPropagation()} className="w-64 overflow-y-auto rounded-[12px] border border-line bg-paper py-1.5 shadow-lg">
      <div className="flex items-center justify-between px-2.5 pb-2 pt-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{title}</span>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-ink-faint hover:bg-cream-2" aria-label="Zavrieť">
          <X size={14} />
        </button>
      </div>

      <div className="px-2.5 pb-1 pt-1 text-[10px] font-extrabold uppercase tracking-wide text-ink-faint">Vedúci zmeny</div>
      {candidates.length === 0 && <p className="px-2.5 pb-2 text-xs text-ink-faint">V tento deň nie je na tejto pozícii nikto priradený.</p>}
      {candidates.map((c) => (
        <CandidateOption key={c.employeeId} candidate={c} isCurrent={c.employeeId === currentEmployeeId} workplaceId={workplaceId} target={target} onAssigned={onClose} />
      ))}

      <NoLeaderOption isCurrentlyNoLeader={currentEmployeeId === null} workplaceId={workplaceId} target={target} onAssigned={onClose} />
    </div>
  );
}
