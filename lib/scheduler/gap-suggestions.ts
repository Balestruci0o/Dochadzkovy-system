import { daysInMonth, isoWeekday, toDateStr } from "@/lib/shared/dates";
import type { CoverageNeed, GenerateEmployee, RejectedCandidate } from "./generate";

/**
 * Q21 — "návrhy pri dierach". Generátor SÁM od seba stále
 * necháva dieru a nikdy nevyberá "najmenšie zlo" —
 * toto NIČ nemení a NIČ automaticky nezasahuje do rozvrhu. Len k dieram,
 * ktoré `generateSchedule` už vytvoril, dopočíta TRI veci pre manažéra:
 *
 *   1. Najbližší kandidát — kto bol NAJBLIŽŠIE k tomu, aby mohol, a o koľko
 *      presne (hodiny/dni) mu chýbalo. Používa `RuleViolation.shortfall`
 *      (rules.ts), NIE parsovanie textu správy (krehké).
 *   2. Kto má v ten deň absenciu — koho by šlo osobne osloviť ručne.
 *   3. Štrukturálny odhad — ak je príčina "málo ľudí na pozíciu", povie to
 *      s konkrétnym číslom (koľko osobodní za mesiac táto potreba
 *      vyžaduje vs. koľko súčasná zostava reálne zvládne).
 *
 * Manažér sa rozhoduje SÁM (prípadne cez "Priradiť AJ TAK") — toto je
 * čisto informačná vrstva nad hotovým výsledkom.
 */

export type GapSuggestion = {
  closestCandidate: { employeeId: string; name: string; detail: string } | null;
  absentCandidates: { employeeId: string; name: string; detail: string }[];
  structural: {
    requiredPersonDaysPerMonth: number;
    estimatedCapacityPerMonth: number;
    estimatedMissingHeadcount: number;
  } | null;
};

/** Prevod na spoločnú škálu (hodiny) len na POROVNANIE "kto bol bližšie" — zobrazenie vždy používa PÔVODNÚ jednotku pravidla. */
const UNIT_TO_HOURS: Record<"hours" | "days" | "minutes", number> = { hours: 1, days: 24, minutes: 1 / 60 };

/**
 * Najbližší kandidát = najmenšia normalizovaná vzdialenosť medzi tými, čo
 * mali KVANTIFIKOVATEĽNÉ hard porušenie (shortfall !== null) — POSITION/
 * ALREADY_ASSIGNED/ABSENCE/SCORE/binárne pravidlá sa sem nepočítajú (buď to
 * nie je "skoro prešiel", alebo je to riešené v inej časti návrhu).
 */
export function pickClosestCandidate(rejected: RejectedCandidate[]): GapSuggestion["closestCandidate"] {
  const quantified = rejected.filter((r): r is RejectedCandidate & { shortfall: number; shortfallUnit: "hours" | "days" | "minutes" } => r.shortfall !== null && r.shortfallUnit !== null);
  if (quantified.length === 0) return null;

  const closest = [...quantified].sort((a, b) => a.shortfall * UNIT_TO_HOURS[a.shortfallUnit] - b.shortfall * UNIT_TO_HOURS[b.shortfallUnit])[0];
  return { employeeId: closest.employeeId, name: closest.name, detail: closest.detail };
}

/** Kto by inak bol spôsobilý, ale má v tento deň absenciu — manažér ich vie osobne osloviť (generátor sám nič nemení). */
export function pickAbsentCandidates(rejected: RejectedCandidate[]): GapSuggestion["absentCandidates"] {
  return rejected.filter((r) => r.blockedBy === "ABSENCE").map((r) => ({ employeeId: r.employeeId, name: r.name, detail: r.detail }));
}

function countApplicableDaysInMonth(year: number, month: number, need: Pick<CoverageNeed, "weekdays" | "appliesHolidays">, holidayDates: string[]): number {
  let count = 0;
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const date = toDateStr(year, month, day);
    if (!need.weekdays.includes(isoWeekday(date))) continue;
    if (holidayDates.includes(date) && !need.appliesHolidays) continue;
    count++;
  }
  return count;
}

/**
 * HRUBÝ odhad — nie exaktný dôkaz uskutočniteľnosti rozvrhu. Pre
 * zamestnancov s nastaveným `block_length`+`min_rest_days` počíta reálnu
 * maximálnu kapacitu z ICH VLASTNÝCH pravidiel (blok/(blok+odpočinok) ×
 * dni v mesiaci). Bez takých pravidiel padá na konzervatívny predpoklad
 * "max. 6 zo 7 dní" (typický 1 deň voľna týždenne) — toto ZÁMERNE nie je
 * odvodené z konkrétnej hodnoty MIN_REST_WEEKLY (tá závisí aj od dĺžky
 * zmeny, presný výpočet by vyžadoval simuláciu), len viditeľne označené
 * ako odhad.
 */
export function estimateStructuralCapacity(params: {
  need: CoverageNeed;
  employees: GenerateEmployee[];
  year: number;
  month: number;
  holidayDates: string[];
}): GapSuggestion["structural"] {
  const { need, employees, year, month, holidayDates } = params;
  const positionEmployees = employees.filter((e) => need.positionId === null || e.positionId === need.positionId);

  const totalDays = daysInMonth(year, month);
  const applicableDays = countApplicableDaysInMonth(year, month, need, holidayDates);
  const requiredPersonDays = need.minPeople * applicableDays;

  const CONSERVATIVE_FRACTION_NO_BLOCK_RULE = 6 / 7;

  let totalCapacity = 0;
  for (const e of positionEmployees) {
    const blockRule = e.rules.find((r) => r.ruleType === "block_length");
    const restRule = e.rules.find((r) => r.ruleType === "min_rest_days");
    if (blockRule && restRule) {
      const blockDays = blockRule.params.days as number;
      const restDays = restRule.params.days as number;
      totalCapacity += totalDays * (blockDays / (blockDays + restDays));
    } else {
      totalCapacity += totalDays * CONSERVATIVE_FRACTION_NO_BLOCK_RULE;
    }
  }

  if (totalCapacity >= requiredPersonDays) return null; // kapacita stačí, nie je to štrukturálny problém

  const avgCapacityPerPerson = positionEmployees.length > 0 ? totalCapacity / positionEmployees.length : totalDays * CONSERVATIVE_FRACTION_NO_BLOCK_RULE;
  const estimatedMissingHeadcount = Math.max(1, Math.ceil((requiredPersonDays - totalCapacity) / avgCapacityPerPerson));

  return {
    requiredPersonDaysPerMonth: Math.round(requiredPersonDays),
    estimatedCapacityPerMonth: Math.round(totalCapacity),
    estimatedMissingHeadcount,
  };
}

export function computeGapSuggestion(params: {
  rejected: RejectedCandidate[];
  need: CoverageNeed;
  employees: GenerateEmployee[];
  year: number;
  month: number;
  holidayDates: string[];
}): GapSuggestion {
  return {
    closestCandidate: pickClosestCandidate(params.rejected),
    absentCandidates: pickAbsentCandidates(params.rejected),
    structural: estimateStructuralCapacity(params),
  };
}

/** Slovenský, viacriadkový text — pripojí sa k `Gap.message` (žiadna nová UI plocha, reuse existujúceho banneru upozornení). */
export function formatGapSuggestion(s: GapSuggestion): string {
  const lines: string[] = [];

  if (s.closestCandidate) {
    lines.push(`Najbližšie k obsadeniu: ${s.closestCandidate.name} — ${s.closestCandidate.detail}`);
  }

  if (s.absentCandidates.length > 0) {
    const names = s.absentCandidates.map((c) => c.name).join(", ");
    lines.push(`Inak by boli spôsobilí, ale majú v ten deň neprítomnosť (dalo by sa ich osobne opýtať): ${names}.`);
  }

  if (s.structural) {
    lines.push(
      `Možná štrukturálna príčina: táto potreba vyžaduje ~${s.structural.requiredPersonDaysPerMonth} osobodní/mesiac, súčasná zostava zvládne odhadom len ~${s.structural.estimatedCapacityPerMonth} — chýba približne ${s.structural.estimatedMissingHeadcount} ${s.structural.estimatedMissingHeadcount === 1 ? "ďalší človek" : "ďalší ľudia"}.`,
    );
  }

  return lines.length > 0 ? lines.join(" ") : "";
}
