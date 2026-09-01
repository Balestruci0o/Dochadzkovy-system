export const MONTH_NAMES = [
  "január",
  "február",
  "marec",
  "apríl",
  "máj",
  "jún",
  "júl",
  "august",
  "september",
  "október",
  "november",
  "december",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Pridá `delta` kalendárnych dní k dátumu (YYYY-MM-DD) — čistá kalendárna aritmetika, žiadna časová zóna. */
export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return toDateStr(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** ISO poradie: 1 = pondelok ... 7 = nedeľa (JS Date.getDay() je 0 = nedeľa). */
export function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return ((d.getDay() + 6) % 7) + 1;
}

/** ISO-8601 číslo týždňa (1–53) — týždeň patrí roku, ktorého štvrtok obsahuje. */
export function isoWeekNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0 = pondelok
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // najbližší štvrtok tohto týždňa
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

export function todayStr(): string {
  const d = new Date();
  return toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function monthLabel(year: number, month: number): string {
  const name = MONTH_NAMES[month - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** Predchádzajúci/nasledujúci mesiac s prechodom cez rok. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let m = month + delta;
  let y = year;
  while (m < 1) {
    m += 12;
    y--;
  }
  while (m > 12) {
    m -= 12;
    y++;
  }
  return { year: y, month: m };
}
