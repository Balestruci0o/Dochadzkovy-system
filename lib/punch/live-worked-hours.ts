import { pairBreakPunches } from "./attendance";

export type LiveBreakEvent = { direction: "in" | "out"; occurredAt: Date };

/**
 * ZOBRAZENIE-only — kým je zmena OTVORENÁ (`attendance_days.status = 'working'`,
 * `actual_end` ešte NULL), stĺpec "Odpracované" ukazoval 0 h celé hodiny, lebo
 * `worked_hours` sa v DB dopočíta až pri odpípaní odchodu
 * (`calculateAttendanceDay`, `lib/payroll/calculate.ts`). Táto funkcia NIČ
 * nezapisuje a mzdového výpočtu sa vôbec netýka — len naživo (pri každom
 * vykreslení stránky, s aktuálnym `now`) dopočíta "koľko to vyzerá teraz":
 * (teraz − príchod) mínus SKUTOČNE ODPÍPANÉ prestávky (nie konfiguračná/
 * automatická hodnota zo šablóny — tá sa uplatní až vo finálnom výpočte).
 *
 * Kým je zamestnanec PRÁVE na prestávke (posledné "prestavka" razítko dňa je
 * "out" bez nasledujúceho "in"), čas sa ZAMRZNE presne v momente jej začiatku
 * — nerastie počas prestávky. Po návrate (prestávka dostane "end") sa počíta
 * ďalej od `now`, s touto prestávkou už zarátanou do odpočítaných minút.
 */
export function liveWorkedHours(actualStart: Date, breakEvents: LiveBreakEvent[], now: Date): number {
  const breaks = pairBreakPunches(breakEvents);
  const completedBreakMs = breaks
    .filter((b): b is { start: Date; end: Date } => b.end !== null)
    .reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()), 0);
  const openBreak = breaks.find((b) => b.end === null);

  const elapsedEndMs = openBreak ? openBreak.start.getTime() : now.getTime();
  const workedMs = elapsedEndMs - actualStart.getTime() - completedBreakMs;
  return Math.max(0, workedMs / 3_600_000);
}
