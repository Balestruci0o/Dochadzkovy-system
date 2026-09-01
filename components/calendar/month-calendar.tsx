import { daysInMonth, isoWeekday, todayStr, toDateStr } from "@/lib/shared/dates";
import { WEEKDAYS } from "@/lib/shared/weekdays";
import { ABSENCE_KIND_CONFIG } from "./absence-kinds";
import type { MyCalendarCell } from "@/app/(app)/moj-rozvrh/data";

function fmtHours(h: number): string {
  return `${h.toFixed(1).replace(".0", "")} h`;
}

/** Nástenný mesačný kalendár jedného zamestnanca. Len na čítanie. */
export function MonthCalendar({
  year,
  month,
  cells,
  holidays,
}: {
  year: number;
  month: number;
  cells: Record<string, MyCalendarCell>;
  holidays: Record<string, string>;
}) {
  const dim = daysInMonth(year, month);
  const firstDow = isoWeekday(toDateStr(year, month, 1)) - 1; // 0 = pondelok
  const today = todayStr();

  const boxes: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) boxes.push(null);
  for (let d = 1; d <= dim; d++) boxes.push(d);
  while (boxes.length % 7 !== 0) boxes.push(null);

  return (
    <div>
      {/* 7-stĺpcová mriežka sa na úzkom mobile (≤640px) nezmestí čitateľne —
          texty smien sa odsekávali ("Uprat" namiesto "Upratovanie", "08:00-"
          bez konca). Pod touto hranicou preto namiesto mriežky zobrazíme
          zoznam dní pod sebou (deň + smena), mriežka ostáva pre širšie
          obrazovky nezmenená. */}
      <div className="max-[640px]:hidden">
        <div className="mb-2 grid grid-cols-7 gap-[7px]">
          {WEEKDAYS.map((w) => (
            <div
              key={w.value}
              className={`pb-0.5 text-center text-[11px] font-bold uppercase tracking-wide ${
                w.value >= 6 ? "text-gold" : "text-ink-faint"
              }`}
            >
              {w.short}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-[7px]">
          {boxes.map((d, i) => {
          if (d == null) return <div key={i} />;
          const ds = toDateStr(year, month, d);
          const dow = isoWeekday(ds);
          const hol = holidays[ds];
          const isToday = ds === today;
          const isFuture = ds > today;
          const cell = cells[ds];

          return (
            <div
              key={i}
              className={`flex min-h-[78px] flex-col gap-1.5 rounded-[10px] border p-2 ${
                isToday
                  ? "border-orange shadow-[0_0_0_1px_var(--color-orange)]"
                  : hol
                    ? "border-[#EBD9AE] bg-gold-tint"
                    : dow >= 6
                      ? "border-line bg-cream"
                      : "border-line bg-paper"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-serif text-[15px] font-bold ${isToday ? "text-orange" : ""}`}>{d}</span>
                {hol && (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-[#A8761A]" title={hol}>
                    sviatok
                  </span>
                )}
              </div>

              {cell?.kind === "absence" && cell.absenceKind && (
                <div
                  className="flex flex-1 flex-col justify-center gap-0 rounded-md border px-1.5 py-1"
                  style={{
                    color: ABSENCE_KIND_CONFIG[cell.absenceKind].color,
                    background: `${ABSENCE_KIND_CONFIG[cell.absenceKind].color}1A`,
                    borderColor: `${ABSENCE_KIND_CONFIG[cell.absenceKind].color}55`,
                  }}
                >
                  <b className="text-[13px] font-extrabold leading-none">{ABSENCE_KIND_CONFIG[cell.absenceKind].code}</b>
                  <span className="mt-0.5 text-[10px] font-semibold opacity-85">
                    {ABSENCE_KIND_CONFIG[cell.absenceKind].label}
                  </span>
                </div>
              )}

              {cell?.kind === "shift" && (
                <div
                  className={`flex flex-1 flex-col justify-center gap-0.5 rounded-md bg-cream py-1 pl-2 pr-1.5 ${
                    isFuture && cell.attendanceStatus !== "working" && !cell.workedHours
                      ? "bg-[repeating-linear-gradient(135deg,var(--color-cream),var(--color-cream)_5px,var(--color-cream-2)_5px,var(--color-cream-2)_10px)]"
                      : ""
                  }`}
                  style={{ borderLeft: `3px solid ${cell.templateColor ?? "#7E9082"}` }}
                >
                  <div className="text-[11.5px] font-bold leading-tight">{cell.templateName ?? "Smena"}</div>
                  <div className="text-[10px] text-ink-soft">
                    {cell.startTime?.slice(0, 5)}–{cell.endTime?.slice(0, 5)}
                  </div>
                  {cell.workedHours != null && cell.workedHours > 0 && (
                    <div className="mt-0.5 text-[11px] font-extrabold text-sage-dark">{fmtHours(cell.workedHours)}</div>
                  )}
                  {cell.attendanceStatus === "working" && (
                    <div className="mt-0.5 text-[11px] font-extrabold text-orange">v práci</div>
                  )}
                  {isFuture && cell.attendanceStatus !== "working" && !cell.workedHours && (
                    <div className="mt-0.5 text-[11px] font-semibold text-ink-faint">plán</div>
                  )}
                </div>
              )}
            </div>
          );
          })}
        </div>
      </div>

      <div className="hidden flex-col gap-2 max-[640px]:flex">
        {Array.from({ length: dim }, (_, i) => i + 1).map((d) => {
          const ds = toDateStr(year, month, d);
          const dow = isoWeekday(ds);
          const hol = holidays[ds];
          const isToday = ds === today;
          const isFuture = ds > today;
          const cell = cells[ds];
          const weekday = WEEKDAYS.find((w) => w.value === dow);

          return (
            <div
              key={ds}
              className={`flex items-start gap-3 rounded-[10px] border p-2.5 ${
                isToday
                  ? "border-orange shadow-[0_0_0_1px_var(--color-orange)]"
                  : hol
                    ? "border-[#EBD9AE] bg-gold-tint"
                    : dow >= 6
                      ? "border-line bg-cream"
                      : "border-line bg-paper"
              }`}
            >
              <div className="flex w-11 flex-none flex-col items-center">
                <span className={`font-serif text-lg font-bold leading-tight ${isToday ? "text-orange" : ""}`}>{d}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wide ${dow >= 6 ? "text-gold" : "text-ink-faint"}`}>
                  {weekday?.short}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                {hol && (
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#A8761A]">{hol}</div>
                )}

                {cell?.kind === "absence" && cell.absenceKind && (
                  <div
                    className="flex flex-col gap-0 rounded-md border px-2 py-1.5"
                    style={{
                      color: ABSENCE_KIND_CONFIG[cell.absenceKind].color,
                      background: `${ABSENCE_KIND_CONFIG[cell.absenceKind].color}1A`,
                      borderColor: `${ABSENCE_KIND_CONFIG[cell.absenceKind].color}55`,
                    }}
                  >
                    <b className="text-sm font-extrabold leading-tight">{ABSENCE_KIND_CONFIG[cell.absenceKind].label}</b>
                  </div>
                )}

                {cell?.kind === "shift" && (
                  <div
                    className={`flex flex-col gap-0.5 rounded-md bg-cream px-2.5 py-1.5 ${
                      isFuture && cell.attendanceStatus !== "working" && !cell.workedHours
                        ? "bg-[repeating-linear-gradient(135deg,var(--color-cream),var(--color-cream)_5px,var(--color-cream-2)_5px,var(--color-cream-2)_10px)]"
                        : ""
                    }`}
                    style={{ borderLeft: `3px solid ${cell.templateColor ?? "#7E9082"}` }}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <span className="text-sm font-bold leading-tight">{cell.templateName ?? "Smena"}</span>
                      <span className="text-[12px] text-ink-soft">
                        {cell.startTime?.slice(0, 5)}–{cell.endTime?.slice(0, 5)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {cell.workedHours != null && cell.workedHours > 0 && (
                        <span className="text-[12px] font-extrabold text-sage-dark">{fmtHours(cell.workedHours)}</span>
                      )}
                      {cell.attendanceStatus === "working" && (
                        <span className="text-[12px] font-extrabold text-orange">v práci</span>
                      )}
                      {isFuture && cell.attendanceStatus !== "working" && !cell.workedHours && (
                        <span className="text-[12px] font-semibold text-ink-faint">plán</span>
                      )}
                    </div>
                  </div>
                )}

                {!cell && !hol && <div className="text-[12px] text-ink-faint">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
