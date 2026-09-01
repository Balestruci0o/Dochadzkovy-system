"use client";

import { Crown, Lock, X } from "lucide-react";
import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  assignAbsenceAction,
  assignShiftAction,
  assignShiftLeaderAction,
  clearCellAction,
  type AssignShiftLeaderState,
  type AssignShiftState,
} from "@/app/(app)/kalendar/actions";
import { MONTH_NAMES } from "@/lib/shared/dates";
import { WEEKDAYS } from "@/lib/shared/weekdays";
import { ABSENCE_KIND_OPTIONS } from "./absence-kinds";
import type { CalendarCell, CalendarShiftTemplate } from "@/app/(app)/kalendar/data";

export type PickerTarget = {
  employeeId: string;
  date: string;
  x: number;
  y: number;
};

const initialAssignState: AssignShiftState = {};
const initialLeaderState: AssignShiftLeaderState = {};

/**
 * Q3 — "obsaď aj tak, len upozorni". Jedna šablóna = jeden
 * nezávislý formulár/`useActionState` (nie jeden zdieľaný stav pre celý
 * picker), aby kliknutie na INÚ zmenu nezobrazovalo cudzie upozornenie a aby
 * BEŽNÝ prípad (žiadne porušenie) zostal presne 1 klik ako predtým — druhé
 * tlačidlo ("Priradiť AJ TAK") sa objaví LEN vtedy, keď server vráti
 * porušenia, a posiela ROVNAKÝ formulár znova s `confirmOverride=true`.
 */
function ShiftOption({
  template,
  isCurrent,
  defaultBreakMinutes,
  target,
  workplaceId,
  onAssigned,
}: {
  template: CalendarShiftTemplate;
  isCurrent: boolean;
  defaultBreakMinutes: number;
  target: PickerTarget;
  workplaceId: string;
  onAssigned: () => void;
}) {
  const [state, formAction, pending] = useActionState(assignShiftAction, initialAssignState);
  const [breakMinutes, setBreakMinutes] = useState(defaultBreakMinutes);

  useEffect(() => {
    if (state.success) onAssigned();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAssigned je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  const violations = state.violations ?? [];
  const needsConfirm = violations.length > 0;

  return (
    <form action={formAction} className="px-2.5 py-1">
      <input type="hidden" name="employeeId" value={target.employeeId} />
      <input type="hidden" name="workplaceId" value={workplaceId} />
      <input type="hidden" name="date" value={target.date} />
      <input type="hidden" name="shiftTemplateId" value={template.id} />
      <input type="hidden" name="breakMinutes" value={breakMinutes} />
      {needsConfirm && <input type="hidden" name="confirmOverride" value="true" />}

      <button
        type="submit"
        disabled={pending}
        className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left text-[13.5px] transition-colors hover:bg-cream-2 disabled:opacity-60 ${isCurrent ? "bg-sage-tint" : ""}`}
      >
        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: template.color ?? "#9C988E" }} />
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{template.name}</span>
        <span className="flex-none font-mono text-xs tabular-nums text-ink-faint">
          {template.startTime.slice(0, 5)}–{template.endTime.slice(0, 5)}
        </span>
      </button>
      <label className="mt-1 flex items-center gap-1.5 pl-5 text-[11px] text-ink-faint">
        Prestávka
        <input
          type="number"
          min={0}
          value={breakMinutes}
          onChange={(e) => setBreakMinutes(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="w-14 rounded border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-orange"
        />
        min
      </label>

      {needsConfirm && (
        <div className="mt-1.5 rounded-md border border-late/40 bg-late-tint p-2">
          {violations.map((v, i) => (
            <p key={i} className={`text-[11px] leading-snug ${v.isHard ? "font-semibold text-late" : "text-[#A8761A]"}`}>
              {v.isHard ? "Tvrdé porušenie" : "Mäkké porušenie"} — {v.message}
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

/**
 * Vedúci smeny — druhý vstupný bod do TEJ ISTEJ `assignShiftLeaderAction`
 * (prvý je samostatný korunkový 👑 riadok v pätičke kalendára,
 * `shift-leader-picker.tsx`, ktorý ostáva bezo zmeny). Namiesto zoznamu
 * VŠETKÝCH kandidátov (tamto rieši prehliadanie naprieč celým tímom) je toto
 * jeden PREPÍNAČ pre TOHTO KONKRÉTNEHO zamestnanca — presne v paneli, kde mu
 * manažér práve priraďuje zmenu, aby ho nemusel hľadať inde.
 *
 * Rovnaké pravidlá ako korunkový picker: neoprávnený (`canBeShiftLeader
 * === false`) → server vráti `violations`, potvrdenie cez "Priradiť AJ TAK"
 * (rovnaký vzor ako `ShiftOption` vyššie). Odobratie (klik, keď JE aktuálne
 * vedúci) je vždy čisté — server túto kontrolu robí LEN keď sa `employeeId`
 * posiela (viď `assignShiftLeaderAction`), takže sa tu zámerne vynechá.
 */
function ShiftLeaderToggle({
  workplaceId,
  target,
  positionId,
  positionName,
  employeeName,
  canBeShiftLeader,
  isCurrentLeader,
  onAssigned,
}: {
  workplaceId: string;
  target: PickerTarget;
  positionId: string;
  positionName: string;
  employeeName: string;
  canBeShiftLeader: boolean;
  isCurrentLeader: boolean;
  onAssigned: () => void;
}) {
  const [state, formAction, pending] = useActionState(assignShiftLeaderAction, initialLeaderState);

  useEffect(() => {
    if (state.success) onAssigned();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAssigned je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  const violations = state.violations ?? [];
  const needsConfirm = violations.length > 0;

  return (
    <form action={formAction} className="px-2.5 py-1">
      <input type="hidden" name="workplaceId" value={workplaceId} />
      <input type="hidden" name="positionId" value={positionId} />
      <input type="hidden" name="date" value={target.date} />
      {/* Keď JE aktuálne vedúci, klik ho ODOBERIE — employeeId sa vôbec nepošle (rovnaká cesta ako "Bez vedúceho" v korunkovom pickeri). */}
      {!isCurrentLeader && <input type="hidden" name="employeeId" value={target.employeeId} />}
      {needsConfirm && <input type="hidden" name="confirmOverride" value="true" />}

      <button
        type="submit"
        disabled={pending}
        className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left text-[13.5px] transition-colors hover:bg-cream-2 disabled:opacity-60 ${isCurrentLeader ? "bg-gold-tint" : ""}`}
      >
        <Crown size={13} className={`flex-none ${isCurrentLeader ? "text-[#A8761A]" : "text-ink-faint"}`} />
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">
          {isCurrentLeader ? `Odobrať ako vedúceho — ${positionName}` : `Označiť ako vedúceho zmeny — ${positionName}`}
        </span>
        {!canBeShiftLeader && !isCurrentLeader && <span className="flex-none text-[10px] uppercase tracking-wide text-ink-faint">bez oprávnenia</span>}
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
            {pending ? "Priraďujem…" : `Priradiť ${employeeName} AJ TAK`}
          </button>
        </div>
      )}
    </form>
  );
}

export function CellPicker({
  target,
  workplaceId,
  shiftTemplates,
  current,
  employeeName,
  canBeShiftLeader,
  leaderPosition,
  currentLeaderEmployeeId,
  onClose,
}: {
  target: PickerTarget;
  workplaceId: string;
  shiftTemplates: CalendarShiftTemplate[];
  current: CalendarCell | undefined;
  employeeName: string;
  canBeShiftLeader: boolean;
  /** `undefined` = zamestnancova pozícia NEVYŽADUJE vedúceho zmeny — sekcia sa vôbec nezobrazí. */
  leaderPosition: { id: string; name: string } | undefined;
  /** Kto je dnes vedúci na (leaderPosition, target.date), ak už niekto je. */
  currentLeaderEmployeeId: string | null;
  onClose: () => void;
}) {
  const d = new Date(`${target.date}T00:00:00`);
  const dow = ((d.getDay() + 6) % 7) + 1;
  const weekdayLabel = WEEKDAYS.find((w) => w.value === dow)?.label ?? "";
  const title = `${weekdayLabel} ${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}`;

  const panelRef = useRef<HTMLDivElement>(null);
  // Panel s VIAC pozíciami/šablónami (viac zmien, viac typov neprítomnosti)
  // môže byť vyšší než miesto pod kurzorom — pôvodne sa `top`/`maxHeight`
  // počítali z pevného odhadu výšky (460px), takže pri skutočne vyššom
  // obsahu spodok (napr. "Náhradné voľno", tlačidlo "Voľno") vyrenderoval
  // AŽ POD viditeľnú oblasť okna. Keďže panel je `position: fixed`, scroll
  // stránky ho tam nedotiahne späť — jediná oprava je zmerať SKUTOČNÚ výšku
  // obsahu (`scrollHeight`) až po prvom vykreslení a podľa nej dopočítať
  // `top`/`maxHeight` tak, aby sa spodok nikdy nedostal za okraj okna.
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    left: target.x,
    top: target.y + 6,
    visibility: "hidden",
    zIndex: 60,
  });

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
    if (top + height > vh - margin) {
      top = Math.max(margin, vh - margin - height);
    }
    setStyle({ position: "fixed", left: Math.max(margin, left), top, maxHeight, zIndex: 60 });
  }, [target.x, target.y]);

  const hidden = (
    <>
      <input type="hidden" name="employeeId" value={target.employeeId} />
      <input type="hidden" name="workplaceId" value={workplaceId} />
      <input type="hidden" name="date" value={target.date} />
    </>
  );

  return (
    <div
      ref={panelRef}
      style={style}
      onClick={(e) => e.stopPropagation()}
      className="w-60 overflow-y-auto rounded-[12px] border border-line bg-paper py-1.5 shadow-lg"
    >
      <div className="flex items-center justify-between px-2.5 pb-2 pt-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{title}</span>
        <div className="flex items-center gap-1.5">
          {current?.locked && <Lock size={12} className="text-ink-faint" aria-label="Ručne zamknuté" />}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-ink-faint hover:bg-cream-2"
            aria-label="Zavrieť"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="px-2.5 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-wide text-ink-faint">Smena</div>
      {shiftTemplates.length === 0 && (
        <p className="px-2.5 pb-1 text-xs text-ink-faint">Žiadne šablóny smien pre túto prevádzku.</p>
      )}
      {shiftTemplates.map((s) => {
        const isCurrent = current?.kind === "shift" && current.shiftTemplateId === s.id;
        // Pri UŽ priradenej zmene predvyplní JEJ skutočnú prestávku (mohla
        // byť predtým individuálne upravená) — inak default zo šablóny.
        const defaultBreak = isCurrent && current?.breakMinutes != null ? current.breakMinutes : s.breakMinutes;
        return (
          <ShiftOption
            key={s.id}
            template={s}
            isCurrent={isCurrent}
            defaultBreakMinutes={defaultBreak}
            target={target}
            workplaceId={workplaceId}
            onAssigned={onClose}
          />
        );
      })}

      {leaderPosition && (
        <>
          <div className="px-2.5 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-wide text-ink-faint">Vedúci zmeny</div>
          {current?.kind === "shift" ? (
            <ShiftLeaderToggle
              workplaceId={workplaceId}
              target={target}
              positionId={leaderPosition.id}
              positionName={leaderPosition.name}
              employeeName={employeeName}
              canBeShiftLeader={canBeShiftLeader}
              isCurrentLeader={currentLeaderEmployeeId === target.employeeId}
              onAssigned={onClose}
            />
          ) : (
            <p className="px-2.5 pb-1 text-xs text-ink-faint">Pozícia {leaderPosition.name} vyžaduje vedúceho — najprv priraď zmenu vyššie.</p>
          )}
        </>
      )}

      <div className="px-2.5 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-wide text-ink-faint">
        Neprítomnosť
      </div>
      {ABSENCE_KIND_OPTIONS.map((a) => {
        const isCurrent = current?.kind === "absence" && current.absenceKind === a.value;
        return (
          <form key={a.value} action={assignAbsenceAction}>
            {hidden}
            <input type="hidden" name="kind" value={a.value} />
            <button
              type="submit"
              // onClose() synchrónne v onClick by unmountol <form> skôr, než
              // prehliadač stihne odoslať natívny submit ("Form submission
              // canceled because the form is not connected") — posunuté o
              // jeden tick, nech submit prebehne prvý.
              onClick={() => setTimeout(onClose, 0)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-cream-2 ${isCurrent ? "bg-sage-tint" : ""}`}
            >
              <span
                className="flex h-5 w-9 flex-none items-center justify-center rounded-md border text-[10px] font-extrabold"
                style={{ background: `${a.color}22`, borderColor: `${a.color}66`, color: a.color }}
              >
                {a.code}
              </span>
              <span className="font-semibold text-ink">{a.label}</span>
            </button>
          </form>
        );
      })}

      <form action={clearCellAction}>
        {hidden}
        <button
          type="submit"
          onClick={() => setTimeout(onClose, 0)}
          className="mt-1 flex w-full items-center gap-2 rounded-b-[10px] border-t border-line-soft px-2.5 py-2.5 text-left text-[13px] text-ink-soft transition-colors hover:bg-late-tint hover:text-late"
        >
          <X size={13} /> Voľno (vymazať)
        </button>
      </form>
    </div>
  );
}
