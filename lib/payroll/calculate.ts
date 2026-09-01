import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { employeeRateHistory, employeeSalaryHistory } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { addDays } from "@/lib/shared/dates";
import { zonedTimeToUtc } from "@/lib/shared/time";

type Db = PostgresJsDatabase<typeof schema>;

const TIMEZONE = "Europe/Bratislava";

export type AttendanceDayCalcInput = {
  /** Prvé razítko 'in' toho dňa (null = zamestnanec ešte neprišiel). */
  actualStart: Date | null;
  /** Posledné razítko 'out' toho dňa (null = ešte pracuje / nedokončené). */
  actualEnd: Date | null;
  /** `scheduled_shifts.start_time` ("HH:MM:SS"), null = žiadna naplánovaná zmena. */
  plannedStart: string | null;
  /** `scheduled_shifts.end_time` ("HH:MM:SS"). */
  plannedEnd: string | null;
  /** `scheduled_shifts.break_minutes` (0, ak nie je naplánovaná zmena). */
  breakMinutes: number;
  /**
   * Pípanie prestávok, krok 4 — "automaticky" (default) NEMENÍ NIČ: `breakMinutes`
   * vyššie sa použije presne tak ako doteraz. "pipa" + aspoň JEDNA reálna
   * prestávka toho dňa (`breakPunches`) → namiesto `breakMinutes` sa odráta
   * SÚČET reálnych trvaní (aj viac prestávok za deň) — inak (pípa, ale ani
   * jedna prestávka sa nestala) padá späť na `breakMinutes` (naplánovaná zo
   * šablóny), rovnaký fail-safe ako inde v projekte.
   */
  breakTrackingMode?: "automaticky" | "pipa";
  /** Reálne prestávkové intervaly toho dňa. `end: null` = ešte neskončená (viď realBreakMinutes nižšie). */
  breakPunches?: { start: Date; end: Date | null }[];
  /**
   * "Teraz" — LEN pre `effectiveBreakMinutes` zatiaľ prebiehajúcej prestávky
   * (zmena ešte nemá `actualEnd`, viď nižšie). Voliteľné a testom
   * vstrekovateľné (deterministické testy), v produkcii vždy `new Date()`.
   */
  now?: Date;
  /** `scheduled_shifts.crosses_midnight` — `plannedEnd` patrí dňu PO `date`. */
  crossesMidnight: boolean;
  /** Kalendárny deň, ku ktorému je `attendance_days` riadok priradený (deň ZAČIATKU zmeny). */
  date: string;
  /** Je daný kalendárny deň (YYYY-MM-DD) sviatok? */
  isHoliday: (dateStr: string) => boolean;
  /**
   * Nočná práca (§123 ZP) — `legal_rules` kód `NIGHT_HOURS`, `params: {from, to}`
   * ("HH:MM:SS", cez polnoc — `to` < `from`). `null`/`undefined` (org ešte
   * nemá tento riadok aktívny) → `nightHours` vždy 0, žiadny pád.
   */
  nightWindow?: { from: string; to: string } | null;
  timeZone?: string;
};

export type AttendanceDayCalcResult = {
  workedHours: number;
  overtimeHours: number;
  weekendHours: number;
  holidayHours: number;
  /** PREKRÝVA SA s weekendHours/holidayHours (napr. nočná zmena v sobotu je oboje) — nie je to samostatný bucket, ktorý by sa od nich odpočítaval. */
  nightHours: number;
  isLate: boolean;
  lateMinutes: number;
  status: "planned" | "working" | "done";
  /** Pípanie prestávok, krok 4 — SKUTOČNE použitý počet minút (config, alebo súčet reálnych prestávok pri "pipa"), na uloženie do attendance_days.break_minutes. */
  effectiveBreakMinutes: number;
};

const ZERO: Omit<AttendanceDayCalcResult, "status" | "effectiveBreakMinutes"> = {
  workedHours: 0,
  overtimeHours: 0,
  weekendHours: 0,
  holidayHours: 0,
  nightHours: 0,
  isLate: false,
  lateMinutes: 0,
};

/** ISO poradie: 1 = pondelok ... 7 = nedeľa. Sobota/nedeľa = víkend. */
function isWeekend(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00`);
  const iso = ((d.getDay() + 6) % 7) + 1;
  return iso === 6 || iso === 7;
}

/**
 * Rozdelí odpracovaný interval na dennú klasifikáciu (víkend/sviatok) podľa
 * LOKÁLNEHO kalendárneho dňa — pri zmene cez polnoc padá časť intervalu do
 * `date` a časť do `date + 1 deň`. Zmena nemôže prekročiť 2 kalendárne dni
 * (MAX_SHIFT_HOURS je 12 h), takže stačí jeden možný bod zlomu (lokálna
 * polnoc). Vracia hodiny podľa PODIELU reálneho (pred prestávkou) trvania na
 * každej strane — inak by sme museli riešiť, na ktorej strane polnoci presne
 * prestávka nastala, čo appka dnes nevie a nepotrebuje.
 */
function classifyWeekendHoliday(
  effectiveStart: Date,
  actualEnd: Date,
  date: string,
  crossesMidnight: boolean,
  isHoliday: (d: string) => boolean,
  timeZone: string,
): { weekendMs: number; holidayMs: number; totalMs: number } {
  const totalMs = actualEnd.getTime() - effectiveStart.getTime();
  if (totalMs <= 0) return { weekendMs: 0, holidayMs: 0, totalMs: 0 };

  const nextDate = addDays(date, 1);
  const midnight = crossesMidnight ? zonedTimeToUtc(nextDate, "00:00:00", timeZone) : null;

  const segments: Array<{ ms: number; date: string }> = [];
  if (midnight && midnight.getTime() > effectiveStart.getTime() && midnight.getTime() < actualEnd.getTime()) {
    segments.push({ ms: midnight.getTime() - effectiveStart.getTime(), date });
    segments.push({ ms: actualEnd.getTime() - midnight.getTime(), date: nextDate });
  } else {
    // Celý interval padá na jednu stranu polnoci (bežný prípad — žiadna zmena cez polnoc).
    const day = midnight && effectiveStart.getTime() >= midnight.getTime() ? nextDate : date;
    segments.push({ ms: totalMs, date: day });
  }

  let weekendMs = 0;
  let holidayMs = 0;
  for (const seg of segments) {
    if (isHoliday(seg.date)) holidayMs += seg.ms;
    else if (isWeekend(seg.date)) weekendMs += seg.ms;
  }
  return { weekendMs, holidayMs, totalMs };
}

/**
 * Prekryv [aStart,aEnd) a [bStart,bEnd), v ms (0, ak sa nepretínajú).
 */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Nočná práca (§123 ZP) — PREKRÝVAJÚCI SA štítok nad odpracovaným intervalom
 * (rovnaká proporčná technika ako `classifyWeekendHoliday`), NIE samostatná
 * kategória, ktorá by sa odpočítavala od weekend/holiday. Okno "22:00–06:00"
 * je opakovaná inštancia raz za kalendárny deň — pri max. dĺžke zmeny 12 h
 * (MAX_SHIFT_HOURS, hard) nemôže odpracovaný interval zasiahnuť viac než 2
 * susedné inštancie (okná sú 24 h od seba, medzi nimi 16 h denný odstup) —
 * preto stačí skontrolovať inštanciu pre deň PRED, deň zmeny a deň PO
 * (prekryv s tou, čo sa reálne netýka, vyjde 0, nič sa nezráta dvakrát —
 * inštancie sú navzájom disjunktné, keďže sú 24 h od seba a každá trvá len 8 h).
 */
function nightOverlapMs(
  effectiveStart: Date,
  actualEnd: Date,
  date: string,
  nightWindow: { from: string; to: string } | null | undefined,
  timeZone: string,
): number {
  if (!nightWindow) return 0;
  const workedStart = effectiveStart.getTime();
  const workedEnd = actualEnd.getTime();

  let ms = 0;
  for (const anchor of [addDays(date, -1), date, addDays(date, 1)]) {
    const windowStart = zonedTimeToUtc(anchor, nightWindow.from, timeZone).getTime();
    const windowEnd = zonedTimeToUtc(addDays(anchor, 1), nightWindow.to, timeZone).getTime();
    ms += overlapMs(workedStart, workedEnd, windowStart, windowEnd);
  }
  return ms;
}

/**
 * Pípanie prestávok, krok 4 — súčet REÁLNYCH trvaní prestávok toho dňa (v
 * minútach). Neuzavretá prestávka (`end: null`) nastane v DVOCH prípadoch:
 * (1) auto-close zastihol zamestnanca na prestávke a uzavrel celú zmenu —
 * volajúci vtedy odovzdá `actualEnd`, čím jej príspevok vyjde presne
 * `actualEnd - start` (celý čas od odchodu do konca zmeny sa počíta ako
 * prestávka, keďže sa už nevrátil); (2) prestávka PRÁVE PREBIEHA (zmena ešte
 * nemá `actualEnd`) — volajúci vtedy odovzdá `openEnd = now`, aby sa
 * zobrazoval REÁLNY plynúci čas namiesto ešte neuplynutej naplánovanej
 * hodnoty (viď `calculateAttendanceDay` vyššie).
 */
function realBreakMinutes(breakPunches: { start: Date; end: Date | null }[], openEnd: Date): number {
  let ms = 0;
  for (const b of breakPunches) {
    const end = b.end ?? openEnd;
    if (end.getTime() > b.start.getTime()) ms += end.getTime() - b.start.getTime();
  }
  return ms / 60_000;
}

/**
 * Blok 8 (🔍) — z razítok + naplánovanej zmeny spočíta odpracované hodiny.
 * Čistá funkcia (žiadne DB volanie) — všetky vstupy (vrátane sviatkov) sa jej
 * odovzdajú, aby sa dala testovať bez pripojenia. Volá ju
 * `lib/punch/attendance.ts` (`recomputeAttendanceDay`) po každom razítku.
 *
 * Kľúčové pravidlá:
 * - hodiny sa počítajú od PLÁNOVANÉHO začiatku, nie od skoršieho príchodu —
 *   `effectiveStart = max(actualStart, plannedStartInstant)`. Meškanie sa
 *   NEODPOČÍTAVA navyše — samotné neskoršie effectiveStart už prirodzene
 *   skráti odpracované hodiny, len sa navyše eviduje (`isLate`/`lateMinutes`).
 * - prestávka sa odráta len z "riadnej" časti (do plánovaného konca) —
 *   nadčas prestávku nemá.
 * - nadčas = čas nad plánovaný koniec (`actualEnd - plannedEndInstant`, ak kladné).
 * - víkend/sviatok sú DOPLNKOVÉ štítky nad worked_hours+overtime_hours (na
 *   neskorší výpočet príplatku), nie samostatná kategória navyše — sviatok
 *   má prednosť pred víkendom (sviatok v sobotu sa nepočíta dvakrát).
 */
export function calculateAttendanceDay(input: AttendanceDayCalcInput): AttendanceDayCalcResult {
  const { actualStart, actualEnd, plannedStart, plannedEnd, breakMinutes, crossesMidnight, date, isHoliday } = input;
  const timeZone = input.timeZone ?? TIMEZONE;

  const status: AttendanceDayCalcResult["status"] = actualStart && actualEnd ? "done" : actualStart ? "working" : "planned";

  if (!actualStart || !actualEnd) {
    // Zamestnanec ešte len pracuje (prípadne práve teraz na prestávke) —
    // "pipa" prestávka sa NESMIE hlásiť ako naplánovaná (config) hodnota, kým
    // reálne neuplynula. Prebiehajúca (`end: null`) prestávka sa počíta
    // živo — od odchodu po `now`, nie fixných 30 min zo šablóny.
    const liveBreakMinutes =
      actualStart && input.breakTrackingMode === "pipa" && input.breakPunches && input.breakPunches.length > 0
        ? realBreakMinutes(input.breakPunches, input.now ?? new Date())
        : breakMinutes;
    return { ...ZERO, status, effectiveBreakMinutes: liveBreakMinutes };
  }

  const plannedStartInstant = plannedStart ? zonedTimeToUtc(date, plannedStart, timeZone) : null;
  const plannedEndInstant = plannedEnd
    ? zonedTimeToUtc(crossesMidnight ? addDays(date, 1) : date, plannedEnd, timeZone)
    : null;

  const effectiveStart = plannedStartInstant && plannedStartInstant.getTime() > actualStart.getTime()
    ? plannedStartInstant
    : actualStart;

  const regularEndInstant =
    plannedEndInstant && plannedEndInstant.getTime() < actualEnd.getTime() ? plannedEndInstant : actualEnd;

  const regularMs = Math.max(0, regularEndInstant.getTime() - effectiveStart.getTime());
  const overtimeMs = plannedEndInstant && actualEnd.getTime() > plannedEndInstant.getTime()
    ? actualEnd.getTime() - plannedEndInstant.getTime()
    : 0;

  // Pípanie prestávok, krok 4 — "pipa" s aspoň jednou reálnou prestávkou
  // vymení ZDROJ tohto čísla (real namiesto config), zvyšný výpočet
  // (odrátanie len z riadnej časti, nikdy z nadčasu) ostáva nezmenený.
  const effectiveBreakMinutes =
    input.breakTrackingMode === "pipa" && input.breakPunches && input.breakPunches.length > 0
      ? realBreakMinutes(input.breakPunches, actualEnd)
      : breakMinutes;

  const workedHours = Math.max(0, regularMs / 3_600_000 - effectiveBreakMinutes / 60);
  const overtimeHours = overtimeMs / 3_600_000;

  let lateMinutes = 0;
  if (plannedStartInstant && actualStart.getTime() > plannedStartInstant.getTime()) {
    lateMinutes = Math.round((actualStart.getTime() - plannedStartInstant.getTime()) / 60_000);
  }

  const { weekendMs, holidayMs, totalMs } = classifyWeekendHoliday(
    effectiveStart,
    actualEnd,
    date,
    crossesMidnight,
    isHoliday,
    timeZone,
  );
  const totalPaidHours = workedHours + overtimeHours;
  const weekendHours = totalMs > 0 ? totalPaidHours * (weekendMs / totalMs) : 0;
  const holidayHours = totalMs > 0 ? totalPaidHours * (holidayMs / totalMs) : 0;

  const nightMs = nightOverlapMs(effectiveStart, actualEnd, date, input.nightWindow, timeZone);
  const nightHours = totalMs > 0 ? totalPaidHours * (nightMs / totalMs) : 0;

  return {
    workedHours,
    overtimeHours,
    weekendHours,
    holidayHours,
    nightHours,
    isLate: lateMinutes > 0,
    lateMinutes,
    status,
    effectiveBreakMinutes,
  };
}

/**
 * Sadzba PLATNÁ V DANÝ DEŇ (vždy cez `getRateAt`, nikdy
 * `employee.hourly_rate`). `valid_to IS NULL` = stále platná.
 */
export async function getRateAt(tx: Db, employeeId: string, date: string): Promise<number | null> {
  const [row] = await tx
    .select({ hourlyRate: employeeRateHistory.hourlyRate })
    .from(employeeRateHistory)
    .where(
      and(
        eq(employeeRateHistory.employeeId, employeeId),
        lte(employeeRateHistory.validFrom, date),
        or(isNull(employeeRateHistory.validTo), gte(employeeRateHistory.validTo, date)),
      ),
    )
    .orderBy(desc(employeeRateHistory.validFrom))
    .limit(1);

  return row ? Number(row.hourlyRate) : null;
}

export type SalaryAt = { fixAmount: number; variableAmount: number };

/**
 * Fixný plat (fix + variabilná) PLATNÝ K DANÉMU DÁTUMU — rovnaký vzor ako
 * `getRateAt` vyššie (`employee_salary_history`, nie `employee.*`).
 *
 * Na rozdiel od `getRateAt` (volané PER DEŇ, lebo hodinová sadzba sa počíta
 * deň po dni) sa toto volá LEN RAZ za mesiac, s dátumom KONCA vykazovaného
 * mesiaca — fix je mesačný paušál, nie deň-po-dni súčet. Volajúci
 * (`lib/reports/monthly-summary.ts`) rozhoduje o tomto dátume, táto funkcia
 * je len "platné k X" lookup, rovnako ako `getRateAt`.
 */
export async function getSalaryAt(tx: Db, employeeId: string, date: string): Promise<SalaryAt | null> {
  const [row] = await tx
    .select({ fixAmount: employeeSalaryHistory.fixAmount, variableAmount: employeeSalaryHistory.variableAmount })
    .from(employeeSalaryHistory)
    .where(
      and(
        eq(employeeSalaryHistory.employeeId, employeeId),
        lte(employeeSalaryHistory.validFrom, date),
        or(isNull(employeeSalaryHistory.validTo), gte(employeeSalaryHistory.validTo, date)),
      ),
    )
    .orderBy(desc(employeeSalaryHistory.validFrom))
    .limit(1);

  return row ? { fixAmount: Number(row.fixAmount), variableAmount: Number(row.variableAmount) } : null;
}
