import type { availabilityRuleTypeEnum } from "@/lib/db/schema";
import { addDays, daysInMonth, isoWeekday, isoWeekNumber, toDateStr } from "@/lib/shared/dates";
import { zonedTimeToUtc } from "@/lib/shared/time";
import type { WorkTimeMode } from "./work-time-mode";

/**
 * Blok 9a (🔍) — vyhodnocovanie pravidiel pre JEDNÉHO kandidáta na JEDEN deň.
 * Čistá funkcia (žiadne DB) — všetky pravidlá (`context.rules`/`context.legalRules`)
 * aj existujúce zmeny (`context.existingShifts`) jej odovzdá volajúci
 * (Blok 9c, `lib/scheduler/generate.ts`), ktorý ich načíta z DB — pravidlá
 * sú DÁTA, nie zadrátovaná logika; `evaluateRules` samo osebe nepozná ŽIADNE konkrétne
 * číslo (12 h odpočinku, 5-dňový blok, ...), len VŠEOBECNÝ mechanizmus, ako
 * také číslo vyhodnotiť.
 */

export type AvailabilityRuleType = (typeof availabilityRuleTypeEnum.enumValues)[number];

export type RuleViolation = {
  /** `rule_type` (availability_rule_type) alebo `legal_rules.code` — čím sa dá spätne dohľadať, ktoré pravidlo. */
  code: string;
  isHard: boolean;
  message: string;
  /**
   * Pre Blok 9b (`scoreCandidate`, "Soft porušenie 200×priorita"). Pri
   * `employee_availability_rules` je to ich vlastný stĺpec `priority`.
   * `legal_rules` stĺpec `priority` VÔBEC NEMÁ (schema.sql) — soft §ZP
   * porušenie preto dostáva pevnú default hodnotu.
   */
  priority: number;
  /**
   * Q21 — O KOĽKO (v `shortfallUnit`) kandidát nespĺňal,
   * VŽDY kladné číslo = "o toľko by sa muselo niečo zmeniť, aby to vyšlo".
   * `null` pre pravidlá, kde "o koľko" nedáva zmysel ako jednorozmerná
   * vzdialenosť (binárne áno/nie — `allowed_weekdays`, `week_parity`,
   * `date_range_*`, ...). Používa `lib/scheduler/gap-suggestions.ts` na
   * nájdenie "najbližšieho" kandidáta pri diere — NIKDY sa nescrapuje z
   * `message` (krehké, text je pre ľudí).
   */
  shortfall: number | null;
  shortfallUnit: "hours" | "days" | "minutes" | null;
};

function quantified(base: Omit<RuleViolation, "shortfall" | "shortfallUnit">, shortfall: number, unit: "hours" | "days" | "minutes"): RuleViolation {
  return { ...base, shortfall, shortfallUnit: unit };
}

function unquantified(base: Omit<RuleViolation, "shortfall" | "shortfallUnit">): RuleViolation {
  return { ...base, shortfall: null, shortfallUnit: null };
}

/** legal_rules nemá stĺpec priority, soft §ZP porušenie dostane túto pevnú hodnotu. */
export const DEFAULT_LEGAL_RULE_SOFT_PRIORITY = 1;

/** Zmena, ktorú vyhodnocujeme pre kandidáta na `date` — tvar `shift_templates`. */
export type CandidateShift = {
  startTime: string; // "HH:MM:SS"
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
};

/** Zmena, ktorú má zamestnanec UŽ priradenú (v tomto behu generátora alebo skôr) — pre kontrolu blokov/odpočinku/hodín. */
export type AssignedShift = {
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
};

export type AvailabilityRuleInput = {
  ruleType: AvailabilityRuleType;
  params: Record<string, unknown>;
  isHard: boolean;
  /** `employee_availability_rules.priority` — "pri soft pravidlách: čo prv" (schema.sql). */
  priority: number;
};

export type LegalRuleInput = {
  code: string;
  params: Record<string, unknown>;
  isHard: boolean;
};

export type RuleEvaluationContext = {
  /** Zamestnancove `employee_availability_rules` — už vyfiltrované volajúcim na aktívne a platné k `date` (valid_from/valid_to). */
  rules: AvailabilityRuleInput[];
  /** Organizácia `legal_rules` — aktívne. */
  legalRules: LegalRuleInput[];
  /** Zamestnancove UŽ priradené zmeny (mimo dňa, ktorý práve vyhodnocujeme) — z akéhokoľvek zdroja (predošlý mesiac, doteraz v tomto behu). */
  existingShifts: AssignedShift[];
  /**
   * Blok A (§87 ZP, zjednodušené, po skúsenosti s A2/A3):
   * ovplyvňuje LEN `MAX_WEEKLY_HOURS` (viď `evaluateLegalRule`) — pri
   * `nerovnomerny_turnus` tento strop VÔBEC NEPLATÍ (žiadne priemerovanie
   * cez mesiace — cross-month súčet spôsoboval nespravodlivosť).
   * Odpočinok (MIN_REST_DAILY/MIN_REST_WEEKLY) je od
   * tohto poľa úplne nezávislý. Nepovinné — keď chýba, správanie je
   * PRESNE také, ako pred Blokom A (tvrdý strop na každý ISO týždeň).
   */
  workTimeMode?: WorkTimeMode;
};

type Employee = { id: string; name?: string };

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * HRUBÉ rozpätie naplánovanej zmeny v hodinách (od–do, "na hodinkách"
 * aritmetika — ide o šablónu, nie o reálny odpip s DST). ZÁMERNE nepočíta
 * s prestávkou — používa sa všade tam, kde ide o ČASOVÝ RÁMEC zmeny
 * (koniec zmeny pre odpočinok/MIN_REST_*, dĺžka zmeny pre MAX_SHIFT_HOURS,
 * BREAK_AFTER_HOURS): počas prestávky je zamestnanec stále "v práci" v tom
 * zmysle, že mu ešte nezačal odpočinok medzi zmenami — prestávka nesmie
 * ovplyvniť odpočinok. Pre SKUTOČNE ODPRACOVANÉ hodiny
 * (týždenné/mesačné stropy, férovosť voči fondu) použi `netWorkedHours`.
 */
export function shiftDurationHours(shift: { startTime: string; endTime: string; crossesMidnight: boolean }): number {
  const start = timeToMinutes(shift.startTime);
  let end = timeToMinutes(shift.endTime);
  if (shift.crossesMidnight || end <= start) end += 24 * 60;
  return (end - start) / 60;
}

/** ČISTÉ odpracované hodiny — hrubé rozpätie zmeny MÍNUS prestávka. Pozri `shiftDurationHours`. */
export function netWorkedHours(shift: { startTime: string; endTime: string; crossesMidnight: boolean; breakMinutes: number }): number {
  return Math.max(0, shiftDurationHours(shift) - shift.breakMinutes / 60);
}

/**
 * Absolútna minúta (od epochy, REÁLNY UTC okamih) začiatku zmeny —
 * exportované aj pre MIN_REST_WEEKLY (Blok 9c Piece 4, `weekly-rest.ts`).
 *
 * ZÁMERNE cez `zonedTimeToUtc` (Europe/Bratislava, DST-korektné), NIE
 * naivná "dni od epochy × 1440 + minúty" aritmetika — tá by pri prechode
 * na letný/zimný čas dala o hodinu vedľa. Toto je iný prípad než
 * `shiftDurationHours` (ktorá ZÁMERNE zostáva nominálna, "časový rámec"
 * zmeny) — odpočinok MEDZI zmenami (`MIN_REST_DAILY`/`MIN_REST_WEEKLY`) je
 * o SKUTOČNE uplynutom čase, nie o pláne, a musí byť DST-korektný (nájdené
 * na scenári Skupina B — jarný prechod skryl 1 chýbajúcu hodinu odpočinku).
 */
export function shiftStartMinutes(dateStr: string, startTime: string): number {
  return zonedTimeToUtc(dateStr, startTime).getTime() / 60_000;
}

/** Absolútna minúta (od epochy, REÁLNY UTC okamih) konca zmeny — správne aj cez polnoc AJ cez DST. */
export function shiftEndMinutes(shift: { date: string; startTime: string; endTime: string; crossesMidnight: boolean }): number {
  const start = timeToMinutes(shift.startTime);
  const end = timeToMinutes(shift.endTime);
  const endDate = shift.crossesMidnight || end <= start ? addDays(shift.date, 1) : shift.date;
  return zonedTimeToUtc(endDate, shift.endTime).getTime() / 60_000;
}

/**
 * Koľko dní PO SEBE (bez medzery) zamestnanec pracoval bezprostredne PRED
 * `date`. Exportované aj pre Blok 9c (`generate.ts`) — stratégia "dokonči
 * začatý blok" potrebuje presne TÚTO istú hodnotu, nielen áno/nie z
 * `evaluateRules`.
 */
export function consecutiveWorkDaysBefore(shiftDates: Set<string>, date: string): number {
  let count = 0;
  let d = addDays(date, -1);
  while (shiftDates.has(d)) {
    count++;
    d = addDays(d, -1);
  }
  return count;
}

/**
 * Koľko dní VOĽNA PO SEBE je bezprostredne PRED `date` — a či pred týmto
 * voľnom vôbec existoval nejaký odpracovaný deň (inak niet z čoho
 * "odpočívať", nie je čo porušiť). `null` = žiadna predchádzajúca práca
 * v dohľadnom okne (60 dní) — min_rest_days sa nedá porušiť. Exportované aj
 * pre Blok 9c (`generate.ts`) — deterministický rozstrel remízy v skóre
 * potrebuje presne TÚTO istú hodnotu.
 */
export function consecutiveRestDaysBefore(shiftDates: Set<string>, date: string): number | null {
  let count = 0;
  let d = addDays(date, -1);
  const LOOKBACK_LIMIT = 60;
  while (!shiftDates.has(d)) {
    count++;
    if (count > LOOKBACK_LIMIT) return null;
    d = addDays(d, -1);
  }
  return count;
}

/** Súčet ČISTÝCH odpracovaných hodín (po odrátaní prestávok) v [fromDate, toDate] — pre týždenné/mesačné stropy a férovosť. */
function sumNetHoursInRange(shifts: AssignedShift[], fromDate: string, toDate: string): number {
  return shifts
    .filter((s) => s.date >= fromDate && s.date <= toDate)
    .reduce((sum, s) => sum + netWorkedHours(s), 0);
}

function isoWeekRange(date: string): { from: string; to: string } {
  const from = addDays(date, -(isoWeekday(date) - 1));
  return { from, to: addDays(from, 6) };
}

function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  return { from: `${date.slice(0, 7)}-01`, to: toDateStr(y, m, daysInMonth(y, m)) };
}

function evaluateAvailabilityRule(
  rule: AvailabilityRuleInput,
  date: string,
  shift: CandidateShift,
  shiftDates: Set<string>,
  existingShifts: AssignedShift[],
): RuleViolation | null {
  const p = rule.params;
  const isHard = rule.isHard;
  const priority = rule.priority;

  switch (rule.ruleType) {
    case "allowed_weekdays": {
      const days = p.days as number[];
      const weekday = isoWeekday(date);
      if (!days.includes(weekday)) {
        return unquantified({ code: "ALLOWED_WEEKDAYS", isHard, priority, message: `Smie pracovať len v dňoch ${days.join(",")} (dnes deň ${weekday}).` });
      }
      return null;
    }
    case "blocked_weekdays": {
      const days = p.days as number[];
      const weekday = isoWeekday(date);
      if (days.includes(weekday)) {
        return unquantified({ code: "BLOCKED_WEEKDAYS", isHard, priority, message: `Nesmie pracovať v deň ${weekday} (zakázané dni: ${days.join(",")}).` });
      }
      return null;
    }
    case "block_length": {
      const maxDays = p.days as number;
      const streak = consecutiveWorkDaysBefore(shiftDates, date);
      if (streak + 1 > maxDays) {
        return quantified({ code: "BLOCK_LENGTH", isHard, priority, message: `Pracuje v ${maxDays}-dňových blokoch — tento deň by bol ${streak + 1}. v rade.` }, streak + 1 - maxDays, "days");
      }
      return null;
    }
    case "max_consecutive_days": {
      const maxDays = p.days as number;
      const streak = consecutiveWorkDaysBefore(shiftDates, date);
      if (streak + 1 > maxDays) {
        return quantified({ code: "MAX_CONSECUTIVE_DAYS", isHard, priority, message: `Max. ${maxDays} dní v kuse — tento deň by bol ${streak + 1}. v rade.` }, streak + 1 - maxDays, "days");
      }
      return null;
    }
    case "min_rest_days": {
      // Platí LEN pri ZAČATÍ nového bloku (včera sa nepracovalo) — nie
      // uprostred ešte prebiehajúceho bloku. Bez tejto podmienky by "0 dní
      // voľna" (lebo včera bol pracovný deň, čiže sa ešte len POKRAČUJE,
      // nezačína sa nanovo) vyzeralo ako porušenie, hoci sa nič neporušilo —
      // reálne nájdené pri behu na seed dátach.
      if (shiftDates.has(addDays(date, -1))) return null;

      const required = p.days as number;
      const gap = consecutiveRestDaysBefore(shiftDates, date);
      if (gap !== null && gap < required) {
        return quantified({ code: "MIN_REST_DAYS", isHard, priority, message: `Len ${gap} dní voľna od posledného bloku (potrebné min. ${required}).` }, required - gap, "days");
      }
      return null;
    }
    case "week_parity": {
      const week = isoWeekNumber(date);
      const isEven = week % 2 === 0;
      const wantsEven = p.parity === "even";
      if (isEven !== wantsEven) {
        return unquantified({ code: "WEEK_PARITY", isHard, priority, message: `Pracuje len v ${wantsEven ? "párnych" : "nepárnych"} týždňoch (tento je ${isEven ? "párny" : "nepárny"}, č. ${week}).` });
      }
      return null;
    }
    case "date_range_available": {
      const from = p.from as string;
      const to = p.to as string;
      if (date < from || date > to) {
        return unquantified({ code: "DATE_RANGE_AVAILABLE", isHard, priority, message: `Dostupný len ${from}–${to}.` });
      }
      return null;
    }
    case "date_range_blocked": {
      const from = p.from as string;
      const to = p.to as string;
      if (date >= from && date <= to) {
        return unquantified({ code: "DATE_RANGE_BLOCKED", isHard, priority, message: `Nedostupný v období ${from}–${to}.` });
      }
      return null;
    }
    case "max_hours_per_week": {
      // ČISTÉ odpracované hodiny (po prestávke) — ide o skutočný pracovný
      // fond, nie o časový rámec zmeny (viď `netWorkedHours`).
      const max = p.hours as number;
      const { from, to } = isoWeekRange(date);
      const already = sumNetHoursInRange(existingShifts, from, to);
      const total = already + netWorkedHours(shift);
      if (total > max) {
        return quantified({ code: "MAX_HOURS_PER_WEEK", isHard, priority, message: `Max. ${max} h/týždeň — s touto smenou by mal ${total.toFixed(1)} h.` }, total - max, "hours");
      }
      return null;
    }
    case "max_hours_per_month": {
      const max = p.hours as number;
      const { from, to } = monthRange(date);
      const already = sumNetHoursInRange(existingShifts, from, to);
      const total = already + netWorkedHours(shift);
      if (total > max) {
        return quantified({ code: "MAX_HOURS_PER_MONTH", isHard, priority, message: `Max. ${max} h/mesiac — s touto smenou by mal ${total.toFixed(1)} h.` }, total - max, "hours");
      }
      return null;
    }
    case "min_hours_per_month":
      // NEPOUŽÍVANÉ (Q10) — pôvodne zamýšľané ako zdroj
      // zmluvného fondu pre skórovanie (Blok 9b, váha 1000), ale
      // `db-loader.ts` tento typ pravidla nikdy nečítal — aktívny zdroj
      // fondu je výhradne `employees.contract_hours_per_month`
      // (`GenerateEmployee.contractedMonthlyHours`). Zámerne no-op, nikdy sa
      // "neporuší" — vynechané aj z výberu pri zakladaní pravidla
      // (`components/employees/availability-rule-types.ts`), nech si ho
      // nikto nezvolí namiesto skutočného poľa "Úväzok".
      return null;
    case "preferred_shift":
      // Kozmetika (Blok 9b: "Odchýlka od preferovanej zmeny", váha 50) —
      // nikdy nie je dôvod kandidáta vyradiť.
      return null;
    default:
      return null;
  }
}

function evaluateLegalRule(
  rule: LegalRuleInput,
  date: string,
  shift: CandidateShift,
  existingShifts: AssignedShift[],
  workTimeMode: WorkTimeMode | undefined,
): RuleViolation | null {
  const p = rule.params;
  const isHard = rule.isHard;
  // legal_rules nemá stĺpec priority (schema.sql) — soft §ZP porušenie preto
  // dostáva pevnú default hodnotu, nech nie je "mŕtvy člen"
  // v scoreCandidate (Blok 9b, "Soft porušenie 200×priorita").
  const priority = DEFAULT_LEGAL_RULE_SOFT_PRIORITY;

  switch (rule.code) {
    case "MIN_REST_DAILY": {
      const requiredHours = p.hours as number;
      const previous = [...existingShifts].filter((s) => s.date < date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (!previous) return null;
      const restMinutes = shiftStartMinutes(date, shift.startTime) - shiftEndMinutes(previous);
      const restHours = restMinutes / 60;
      if (restHours < requiredHours) {
        return quantified({ code: "MIN_REST_DAILY", isHard, priority, message: `Odpočinok by bol ${restHours.toFixed(1)} h (min. ${requiredHours} h).` }, requiredHours - restHours, "hours");
      }
      return null;
    }
    case "MAX_CONSEC_DAYS": {
      const maxDays = p.days as number;
      const shiftDates = new Set(existingShifts.map((s) => s.date));
      const streak = consecutiveWorkDaysBefore(shiftDates, date);
      if (streak + 1 > maxDays) {
        return quantified({ code: "MAX_CONSEC_DAYS", isHard, priority, message: `§ZP: max. ${maxDays} dní v kuse — tento deň by bol ${streak + 1}. v rade.` }, streak + 1 - maxDays, "days");
      }
      return null;
    }
    case "MAX_WEEKLY_HOURS": {
      // ČISTÉ odpracované hodiny (po prestávke) — § 85 ZP hovorí o
      // pracovnom čase, nie o časovom rámci zmeny (viď `netWorkedHours`).
      const max = p.hours as number;

      // Blok A (§87 ZP, zjednodušené): `nerovnomerny_turnus`
      // NEMÁ tento strop VÔBEC — jednotlivý týždeň smie ísť nad 40h,
      // generátor to nezablokuje ani nenechá kvôli tomu dieru. Skúšali sme
      // priemerovanie cez vyrovnávacie obdobie (Blok A2/A3), ale cross-month
      // súčet spôsoboval nespravodlivosť medzi ľuďmi na tej istej pozícii —
      // zahodené. `MIN_REST_DAILY`/`MIN_REST_WEEKLY`
      // sú od tejto vetvy úplne nezávislé (MIN_REST_DAILY nižšie v tomto
      // switchi, MIN_REST_WEEKLY mimo evaluateRules, viď weekly-rest.ts) a
      // platia v OBOCH režimoch rovnako.
      if (workTimeMode === "nerovnomerny_turnus") return null;

      const { from, to } = isoWeekRange(date);
      const already = sumNetHoursInRange(existingShifts, from, to);
      const total = already + netWorkedHours(shift);
      if (total > max) {
        return quantified({ code: "MAX_WEEKLY_HOURS", isHard, priority, message: `§ZP: max. ${max} h/týždeň — s touto smenou by mal ${total.toFixed(1)} h.` }, total - max, "hours");
      }
      return null;
    }
    case "MAX_SHIFT_HOURS": {
      // ZÁMERNE hrubé rozpätie (od–do), nie čisté odpracované hodiny —
      // "dĺžka zmeny" je časový rámec, počas ktorého je zamestnanec viazaný
      // na pracovisko (prestávka z neho ho nevyníma).
      const max = p.hours as number;
      const duration = shiftDurationHours(shift);
      if (duration > max) {
        return quantified({ code: "MAX_SHIFT_HOURS", isHard, priority, message: `§ZP: max. dĺžka smeny ${max} h — táto má ${duration.toFixed(1)} h.` }, duration - max, "hours");
      }
      return null;
    }
    case "BREAK_AFTER_HOURS": {
      const afterHours = p.after_hours as number;
      const requiredBreak = p.break_minutes as number;
      const duration = shiftDurationHours(shift);
      if (duration > afterHours && shift.breakMinutes < requiredBreak) {
        return quantified(
          {
            code: "BREAK_AFTER_HOURS",
            isHard,
            priority,
            message: `§ZP: po ${afterHours} h práce potrebná prestávka min. ${requiredBreak} min (smena má len ${shift.breakMinutes} min).`,
          },
          requiredBreak - shift.breakMinutes,
          "minutes",
        );
      }
      return null;
    }
    // MIN_REST_WEEKLY (nepretržitý 35h odpočinok v týždni) je zámerne mimo
    // evaluateRules — nedá sa vyhodnotiť z jedného kandidátneho dňa, len z
    // CELÉHO zloženého týždňa. Rieši sa až po zostavení týždňa, viď
    // weekly-rest.ts.
    default:
      return null;
  }
}

/**
 * Pre daného zamestnanca, deň a kandidátnu zmenu vráti
 * ZOZNAM porušených pravidiel (hard aj soft). Prázdny zoznam = žiadna
 * prekážka. Volajúci (Blok 9c) rozhodne: čo i len JEDNO `isHard: true` →
 * kandidát vypadáva; inak zostáva so súčtom soft penalizácií (Blok 9b).
 */
export function evaluateRules(
  _employee: Employee,
  date: string,
  shift: CandidateShift,
  context: RuleEvaluationContext,
): RuleViolation[] {
  const shiftDates = new Set(context.existingShifts.map((s) => s.date));
  const violations: RuleViolation[] = [];

  for (const rule of context.rules) {
    const v = evaluateAvailabilityRule(rule, date, shift, shiftDates, context.existingShifts);
    if (v) violations.push(v);
  }

  for (const rule of context.legalRules) {
    const v = evaluateLegalRule(rule, date, shift, context.existingShifts, context.workTimeMode);
    if (v) violations.push(v);
  }

  return violations;
}
