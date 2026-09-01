"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Crown, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { CalendarData, CalendarEmployee, CalendarCell } from "@/app/(app)/kalendar/data";
import { Avatar } from "@/components/avatar";
import { PositionPill } from "@/components/employees/position-pill";
import { daysInMonth, isoWeekday, monthLabel, shiftMonth, todayStr, toDateStr } from "@/lib/shared/dates";
import { WEEKDAYS } from "@/lib/shared/weekdays";
import { ABSENCE_KIND_CONFIG } from "./absence-kinds";
import { CellPicker, type PickerTarget } from "./cell-picker";
import { GenerateScheduleButton } from "./generate-schedule-button";
import { PublishScheduleButton } from "./publish-schedule-button";
import { ShiftLeaderPicker, type ShiftLeaderCandidate, type ShiftLeaderPickerTarget } from "./shift-leader-picker";

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function shiftDurationHours(start: string, end: string, breakMin: number, crossesMidnight: boolean): number {
  const startM = parseTimeToMinutes(start);
  let endM = parseTimeToMinutes(end);
  if (crossesMidnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, (endM - startM - breakMin) / 60);
}

function cellHours(cell: CalendarCell | undefined): number {
  if (!cell || cell.kind === "absence") return 0;
  if (cell.workedHours != null) return cell.workedHours;
  if (!cell.startTime || !cell.endTime) return 0;
  return shiftDurationHours(cell.startTime, cell.endTime, cell.breakMinutes ?? 0, cell.crossesMidnight);
}

export function TeamCalendar({ data, year, month }: { data: CalendarData; year: number; month: number }) {
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [leaderPicker, setLeaderPicker] = useState<ShiftLeaderPickerTarget | null>(null);
  // Zbalené predvolene — 4 plné odstavce porušení (každý s dôvodom a
  // kandidátmi) vedia na mobile zabrať výšku niekoľkých obrazoviek ešte PRED
  // samotným kalendárom. Súhrn (počet + prvá vec) je vždy vidieť, celý zoznam
  // je za jedným klikom, nie automaticky.
  const [violationsExpanded, setViolationsExpanded] = useState(false);

  const dim = daysInMonth(year, month);
  const dateStrs = Array.from({ length: dim }, (_, i) => toDateStr(year, month, i + 1));
  const today = todayStr();
  const workplaceId = data.workplace?.id;

  function cellFor(employeeId: string, date: string): CalendarCell | undefined {
    return data.cells[`${employeeId}|${date}`];
  }

  function employeeMonthHours(employeeId: string): number {
    return dateStrs.reduce((sum, ds) => sum + cellHours(cellFor(employeeId, ds)), 0);
  }

  function ruleAppliesOn(rule: CalendarData["coverageRules"][number], ds: string): boolean {
    const dow = isoWeekday(ds);
    const weekdays = rule.weekdays ?? [1, 2, 3, 4, 5, 6, 7];
    if (!weekdays.includes(dow)) return false;
    if (!rule.appliesHolidays && data.holidays[ds]) return false;
    return true;
  }

  function coverageCount(rule: CalendarData["coverageRules"][number], ds: string): number {
    let n = 0;
    for (const e of data.employees) {
      const c = cellFor(e.id, ds);
      if (!c || c.kind !== "shift") continue;
      if (rule.positionId && e.positionId !== rule.positionId) continue;
      n++;
    }
    return n;
  }

  // Vedúci smeny, krok 5 — kto je v ten deň na TEJTO pozícii reálne
  // priradený (jediní prípustní kandidáti pre ručný prepis, viď
  // `assignShiftLeaderAction`).
  function leaderCandidatesFor(positionId: string, ds: string): ShiftLeaderCandidate[] {
    return data.employees
      .filter((e) => e.positionId === positionId && cellFor(e.id, ds)?.kind === "shift")
      .map((e) => ({ employeeId: e.id, name: `${e.firstName} ${e.lastName}`, canBeShiftLeader: e.canBeShiftLeader }));
  }

  function leaderFor(positionId: string, ds: string): CalendarData["shiftLeaders"][string] | undefined {
    return data.shiftLeaders[`${positionId}|${ds}`];
  }

  function leaderGapMessage(positionId: string, ds: string): string | undefined {
    return data.violations.find((v) => v.ruleCode === "NO_SHIFT_LEADER" && v.positionId === positionId && v.date === ds)?.message;
  }

  const gapDates = new Set<string>();
  for (const rule of data.coverageRules.filter((r) => r.isHard)) {
    for (const ds of dateStrs) {
      if (ruleAppliesOn(rule, ds) && coverageCount(rule, ds) < rule.minPeople) gapDates.add(ds);
    }
  }

  const templatesById = new Map(data.shiftTemplates.map((s) => [s.id, s]));

  // Blok 9d-5 — rozlišuje "Generovať" (prázdny mesiac) od "Pregenerovať"
  // (už niečo existuje) v GenerateScheduleButton, bez extra dotazu (data.cells
  // už tu je). Počíta LEN bunky viditeľné v aktuálne zobrazenom mesiaci.
  let generatedCount = 0;
  let lockedCount = 0;
  for (const ds of dateStrs) {
    for (const e of data.employees) {
      const c = cellFor(e.id, ds);
      if (c?.kind !== "shift") continue;
      if (c.source === "generated") generatedCount++;
      if (c.locked) lockedCount++;
    }
  }

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const nowDate = new Date();
  const wpParam = workplaceId ? `&workplace=${workplaceId}` : "";

  function monthHref(y: number, m: number) {
    return `/kalendar?y=${y}&m=${m}${wpParam}`;
  }

  return (
    <div
      onClick={() => {
        if (picker) setPicker(null);
        if (leaderPicker) setLeaderPicker(null);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center overflow-hidden rounded-md border border-line">
            <Link
              href={monthHref(prev.year, prev.month)}
              className="flex items-center px-2.5 py-2 text-ink-soft hover:bg-cream-2"
              aria-label="Predchádzajúci mesiac"
            >
              <ChevronLeft size={16} />
            </Link>
            <span className="min-w-[168px] px-2 py-2 text-center text-sm font-semibold text-ink">
              {monthLabel(year, month)}
            </span>
            <Link
              href={monthHref(next.year, next.month)}
              className="flex items-center px-2.5 py-2 text-ink-soft hover:bg-cream-2"
              aria-label="Nasledujúci mesiac"
            >
              <ChevronRight size={16} />
            </Link>
          </div>
          <Link
            href={monthHref(nowDate.getFullYear(), nowDate.getMonth() + 1)}
            className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-cream-2"
          >
            Aktuálny mesiac
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {data.allWorkplaces.length > 1 && (
            <div className="flex items-center overflow-hidden rounded-md border border-line">
              {data.allWorkplaces.map((w) => (
                <Link
                  key={w.id}
                  href={`/kalendar?y=${year}&m=${month}&workplace=${w.id}`}
                  className={`px-3.5 py-2 text-sm font-semibold transition-colors ${
                    w.id === workplaceId ? "bg-sage-tint text-sage-dark" : "text-ink-soft hover:bg-cream-2"
                  }`}
                >
                  {w.name}
                </Link>
              ))}
            </div>
          )}
          {data.workplace && (
            <>
              <GenerateScheduleButton
                workplaceId={data.workplace.id}
                workplaceName={data.workplace.name}
                year={year}
                month={month}
                generatedCount={generatedCount}
                lockedCount={lockedCount}
              />
              <PublishScheduleButton workplaceId={data.workplace.id} year={year} month={month} scheduleStatus={data.scheduleStatus} />
            </>
          )}
        </div>
      </div>

      {data.violations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[11px] border border-[#E9C9AE] bg-late-tint px-4 py-2.5 text-[13.5px] font-medium text-late">
          <AlertTriangle size={16} className="flex-none" />
          <b className="font-extrabold">{data.violations.length} porušení / dier v rozvrhu</b>
          <button
            type="button"
            onClick={() => setViolationsExpanded((v) => !v)}
            className="ml-auto rounded-md border border-late/40 px-2 py-1 text-[11.5px] font-semibold text-late transition hover:bg-late/10"
          >
            {violationsExpanded ? "Skryť" : "Zobraziť všetky"}
          </button>
          {violationsExpanded ? (
            <span className="basis-full pl-6 text-[12.5px] font-normal text-ink-soft">
              {data.violations
                .map((v) => `${new Date(v.date).getDate()}. — ${v.employeeName ? `${v.employeeName}: ` : ""}${v.message}`)
                .join(" · ")}
            </span>
          ) : (
            <span className="basis-full pl-6 text-[12.5px] font-normal text-ink-soft">
              {(() => {
                const first = data.violations[0];
                return `${new Date(first.date).getDate()}. — ${first.employeeName ? `${first.employeeName}: ` : ""}${first.message}`;
              })()}
              {data.violations.length > 1 && ` · +${data.violations.length - 1} ďalších`}
            </span>
          )}
        </div>
      )}

      <div
        className={`flex flex-wrap items-center gap-2 rounded-[11px] border px-4 py-2.5 text-[13.5px] font-medium ${
          gapDates.size ? "border-[#E9C9AE] bg-late-tint text-late" : "border-[#C6DBC4] bg-ok-tint text-sage-dark"
        }`}
      >
        {gapDates.size ? (
          <>
            <AlertTriangle size={16} className="flex-none" />
            <b className="font-extrabold">{gapDates.size} dní</b> s neúplným pokrytím (pod minimom pre tvrdé pravidlo).
          </>
        ) : data.coverageRules.length ? (
          <>Pokrytie kompletné — každý deň má obsadené minimum podľa pravidiel.</>
        ) : (
          <>Pre túto prevádzku nie sú nastavené žiadne pravidlá pokrytia (Nastavenia → Pokrytie).</>
        )}
      </div>

      {(data.shiftTemplates.length > 0 || true) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-soft">
          {data.shiftTemplates.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color ?? "#9C988E" }} />
              {s.name} <span className="font-mono text-ink-faint">{s.startTime.slice(0, 5)}</span>
            </span>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          {Object.entries(ABSENCE_KIND_CONFIG).map(([key, a]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span
                className="rounded border px-1.5 py-0.5 text-[10px] font-extrabold"
                style={{ background: `${a.color}22`, borderColor: a.color, color: a.color }}
              >
                {a.code}
              </span>
              {a.label}
            </span>
          ))}
        </div>
      )}

      <div className="relative overflow-hidden rounded-[14px] border border-line bg-paper shadow-sm">
        {/* Vizuálny náznak, že tabuľka sa dá scrollovať do strán — na mobile
            (bez tejto rady) nič nenaznačuje, že za okrajom obrazovky sú ďalšie
            dni, hoci scroll funguje. Čisto dekoratívne, neblokuje klik. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[5] w-6 bg-gradient-to-l from-paper to-transparent max-[640px]:block hidden" />
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-[4] min-w-[188px] border-b border-r border-line bg-cream px-3.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-ink-faint max-[640px]:min-w-[100px] max-[640px]:px-2">
                  Zamestnanec
                </th>
                {dateStrs.map((ds) => {
                  const dow = isoWeekday(ds);
                  const we = dow >= 6;
                  const hol = Boolean(data.holidays[ds]);
                  const isToday = ds === today;
                  return (
                    <th
                      key={ds}
                      title={data.holidays[ds]}
                      className={`min-w-[40px] border-b border-line py-2 text-center font-bold ${
                        isToday ? "bg-orange-tint" : hol ? "bg-gold-tint" : we ? "bg-cream" : "bg-cream"
                      }`}
                    >
                      <div
                        className={`text-[10px] uppercase tracking-wide ${we ? "text-gold" : "text-ink-faint"}`}
                      >
                        {WEEKDAYS.find((w) => w.value === dow)?.short}
                      </div>
                      <div
                        className={`mt-0.5 font-serif text-base font-bold ${
                          isToday ? "text-orange" : hol ? "text-[#A8761A]" : we ? "text-gold" : "text-ink"
                        }`}
                      >
                        {ds.slice(-2)}
                      </div>
                    </th>
                  );
                })}
                <th className="min-w-[54px] border-b border-l border-line bg-cream py-2 text-center text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">
                  Σ h
                </th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => (
                <EmployeeRow
                  key={e.id}
                  employee={e}
                  dateStrs={dateStrs}
                  today={today}
                  holidays={data.holidays}
                  cellFor={cellFor}
                  templatesById={templatesById}
                  monthHours={employeeMonthHours(e.id)}
                  workplaceId={workplaceId}
                  onOpenPicker={setPicker}
                />
              ))}
              {data.employees.length === 0 && (
                <tr>
                  <td colSpan={dim + 2} className="py-8 text-center text-sm text-ink-faint">
                    V tejto prevádzke nie sú priradení žiadni zamestnanci.
                  </td>
                </tr>
              )}
            </tbody>
            {data.coverageRules.length > 0 && (
              <tfoot>
                {data.coverageRules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="sticky left-0 z-[2] border-r border-t border-line bg-cream px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">
                      {rule.positionName ?? "Ktokoľvek"}
                    </td>
                    {dateStrs.map((ds) => {
                      const applies = ruleAppliesOn(rule, ds);
                      const count = coverageCount(rule, ds);
                      const bad = applies && count < rule.minPeople;
                      return (
                        <td
                          key={ds}
                          title={`${rule.positionName ?? "Ktokoľvek"}: ${count}/${rule.minPeople}`}
                          className={`border-t border-line py-1.5 text-center text-[11px] font-bold tabular-nums ${
                            !applies ? "bg-cream text-ink-faint" : bad ? "bg-late-tint text-late" : "bg-cream text-sage-dark"
                          }`}
                        >
                          {applies ? `${count}/${rule.minPeople}` : "·"}
                        </td>
                      );
                    })}
                    <td className="border-l border-t border-line bg-cream" />
                  </tr>
                ))}
              </tfoot>
            )}
            {data.leaderPositions.length > 0 && (
              <tfoot>
                {data.leaderPositions.map((pos) => (
                  <tr key={pos.id}>
                    <td className="sticky left-0 z-[2] flex items-center gap-1 border-r border-t border-line bg-gold-tint px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[#A8761A]">
                      <Crown size={11} /> {pos.name}
                    </td>
                    {dateStrs.map((ds) => {
                      const leader = leaderFor(pos.id, ds);
                      const candidates = leaderCandidatesFor(pos.id, ds);
                      const gapMessage = leaderGapMessage(pos.id, ds);
                      const label = leader?.employeeName
                        ? leader.employeeName
                            .split(" ")
                            .map((p) => p[0])
                            .join("")
                        : leader && leader.employeeId === null
                          ? "—"
                          : gapMessage
                            ? "!"
                            : "·";
                      return (
                        <td key={ds} className="border-t border-line p-[3px] text-center align-middle">
                          <button
                            type="button"
                            disabled={!workplaceId || candidates.length === 0}
                            title={leader?.employeeName ?? (gapMessage ?? (leader?.employeeId === null ? "Vedome bez vedúceho" : undefined))}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              const rect = ev.currentTarget.getBoundingClientRect();
                              setLeaderPicker({ positionId: pos.id, positionName: pos.name, date: ds, x: rect.left, y: rect.bottom });
                            }}
                            className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-dashed text-[10.5px] font-bold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              leader?.employeeId
                                ? "border-transparent bg-gold-tint text-[#A8761A] hover:border-ink-faint"
                                : gapMessage
                                  ? "border-late/50 bg-late-tint text-late hover:border-late"
                                  : "border-transparent text-ink-faint hover:border-ink-faint hover:bg-cream-2"
                            }`}
                          >
                            {label}
                          </button>
                        </td>
                      );
                    })}
                    <td className="border-l border-t border-line bg-cream" />
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {picker && workplaceId && (() => {
        const pickerEmployee = data.employees.find((e) => e.id === picker.employeeId);
        const pickerLeaderPosition = pickerEmployee?.positionId ? data.leaderPositions.find((p) => p.id === pickerEmployee.positionId) : undefined;
        return (
          <CellPicker
            target={picker}
            workplaceId={workplaceId}
            shiftTemplates={data.shiftTemplates}
            current={cellFor(picker.employeeId, picker.date)}
            employeeName={pickerEmployee ? `${pickerEmployee.firstName} ${pickerEmployee.lastName}` : ""}
            canBeShiftLeader={pickerEmployee?.canBeShiftLeader ?? false}
            leaderPosition={pickerLeaderPosition}
            currentLeaderEmployeeId={pickerLeaderPosition ? (leaderFor(pickerLeaderPosition.id, picker.date)?.employeeId ?? null) : null}
            onClose={() => setPicker(null)}
          />
        );
      })()}

      {leaderPicker && workplaceId && (
        <ShiftLeaderPicker
          target={leaderPicker}
          workplaceId={workplaceId}
          candidates={leaderCandidatesFor(leaderPicker.positionId, leaderPicker.date)}
          currentEmployeeId={leaderFor(leaderPicker.positionId, leaderPicker.date)?.employeeId ?? null}
          onClose={() => setLeaderPicker(null)}
        />
      )}
    </div>
  );
}

function EmployeeRow({
  employee,
  dateStrs,
  today,
  holidays,
  cellFor,
  templatesById,
  monthHours,
  workplaceId,
  onOpenPicker,
}: {
  employee: CalendarEmployee;
  dateStrs: string[];
  today: string;
  holidays: Record<string, string>;
  cellFor: (employeeId: string, date: string) => CalendarCell | undefined;
  templatesById: Map<string, CalendarData["shiftTemplates"][number]>;
  monthHours: number;
  workplaceId: string | undefined;
  onOpenPicker: (t: PickerTarget) => void;
}) {
  return (
    <tr className="group">
      <td className="sticky left-0 z-[2] border-r border-b border-line-soft bg-paper px-3.5 py-2 group-hover:bg-cream-2 max-[640px]:px-2 max-[640px]:py-1.5">
        <Link
          href={`/zamestnanci/${employee.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-orange max-[640px]:gap-1.5"
        >
          <Avatar name={`${employee.firstName} ${employee.lastName}`} size={30} />
          <div className="min-w-0">
            <b className="block truncate text-[13px] hover:underline">
              {employee.firstName} {employee.lastName}
            </b>
            {/* Pozícia sa na úzkom sticky stĺpci (max-[640px]:min-w-[100px] vyššie)
                nezmestí bez orezania mena — na fóne dôležitejšie je vidieť CELÉ
                meno než pozíciu, tá je aj tak vidieť na karte zamestnanca. */}
            <span className="max-[640px]:hidden">
              <PositionPill name={employee.positionName} color={employee.positionColor} />
            </span>
          </div>
        </Link>
      </td>
      {dateStrs.map((ds) => {
        const dow = isoWeekday(ds);
        const we = dow >= 6;
        const hol = Boolean(holidays[ds]);
        const isToday = ds === today;
        const cell = cellFor(employee.id, ds);

        return (
          <td
            key={ds}
            className={`border-b border-line-soft p-[3px] text-center align-middle ${
              isToday ? "bg-orange-tint/40" : hol ? "bg-gold-tint/40" : we ? "bg-cream" : ""
            }`}
          >
            <button
              type="button"
              disabled={!workplaceId}
              onClick={(ev) => {
                ev.stopPropagation();
                const rect = ev.currentTarget.getBoundingClientRect();
                onOpenPicker({ employeeId: employee.id, date: ds, x: rect.left, y: rect.bottom });
              }}
              className="relative inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-dashed border-transparent transition-colors hover:border-ink-faint hover:bg-paper disabled:cursor-not-allowed"
            >
              <CellContent cell={cell} template={cell?.shiftTemplateId ? templatesById.get(cell.shiftTemplateId) : undefined} />
            </button>
          </td>
        );
      })}
      <td className="border-b border-l border-line bg-cream text-center text-[13px] font-bold tabular-nums">
        {Math.round(monthHours)}
      </td>
    </tr>
  );
}

function CellContent({
  cell,
  template,
}: {
  cell: CalendarCell | undefined;
  template: CalendarData["shiftTemplates"][number] | undefined;
}) {
  if (!cell) return <span className="text-base text-transparent group-hover:text-ink-faint">+</span>;

  if (cell.kind === "absence" && cell.absenceKind) {
    const a = ABSENCE_KIND_CONFIG[cell.absenceKind];
    return (
      <span
        className="flex h-6 min-w-[28px] items-center justify-center rounded-md border px-1 text-[10.5px] font-extrabold"
        style={{ background: `${a.color}22`, borderColor: `${a.color}66`, color: a.color }}
      >
        {a.code}
      </span>
    );
  }

  if (cell.kind === "shift") {
    const done = cell.attendanceStatus === "done" || cell.attendanceStatus === "auto_closed";
    const inProgress = cell.attendanceStatus === "working";
    const color = template?.color ?? "#7E9082";
    return (
      <span
        className={`relative flex h-6 w-7 items-center justify-center rounded-md border text-[11px] font-extrabold ${
          inProgress ? "animate-pulse" : ""
        } ${done ? "shadow-[inset_0_0_0_1.5px_currentColor]" : ""}`}
        style={{ background: `${color}1E`, borderColor: `${color}70`, color }}
        title={`${template?.name ?? ""} ${template?.startTime.slice(0, 5) ?? ""}–${template?.endTime.slice(0, 5) ?? ""}${cell.locked ? " · ručne zamknuté" : ""}`}
      >
        {cell.locked && <Lock size={8} className="absolute -right-1 -top-1 rounded-full bg-paper text-ink-faint" />}
        {template?.code ?? "?"}
      </span>
    );
  }

  return <span className="text-base text-transparent">+</span>;
}
