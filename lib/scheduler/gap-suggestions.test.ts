import { describe, expect, it } from "vitest";
import type { CoverageNeed, GenerateEmployee, RejectedCandidate } from "./generate";
import { computeGapSuggestion, estimateStructuralCapacity, formatGapSuggestion, pickAbsentCandidates, pickClosestCandidate } from "./gap-suggestions";

/**
 * Q21 — "návrhy pri dierach". Táto vrstva NIČ nemení na
 * priradení (generátor sám naďalej necháva dieru) —
 * len k hotovej diere dopočíta informácie pre manažéra. Každá z troch
 * častí (najbližší kandidát / kto má absenciu / štrukturálny odhad) má tu
 * vlastný test, izolovane.
 */

function rejected(overrides: Partial<RejectedCandidate>): RejectedCandidate {
  return { employeeId: "e", name: "Test", blockedBy: "X", detail: "detail", shortfall: null, shortfallUnit: null, ...overrides };
}

describe("pickClosestCandidate", () => {
  it("vyberie kandidáta s NAJMENŠOU (normalizovanou) vzdialenosťou", () => {
    const candidates = [
      rejected({ employeeId: "e1", name: "Ďaleko", blockedBy: "MAX_WEEKLY_HOURS", detail: "o 10h nad", shortfall: 10, shortfallUnit: "hours" }),
      rejected({ employeeId: "e2", name: "Blízko", blockedBy: "MIN_REST_DAILY", detail: "chýbajú 2h odpočinku", shortfall: 2, shortfallUnit: "hours" }),
    ];
    expect(pickClosestCandidate(candidates)).toEqual({ employeeId: "e2", name: "Blízko", detail: "chýbajú 2h odpočinku" });
  });

  it("prepočíta dni/minúty na hodiny len na POROVNANIE — 1 deň (24h) je 'ďalej' než 3h", () => {
    const candidates = [
      rejected({ employeeId: "e1", name: "Deň nad blokom", blockedBy: "BLOCK_LENGTH", detail: "1 deň nad blokom", shortfall: 1, shortfallUnit: "days" }),
      rejected({ employeeId: "e2", name: "3h pod stropom", blockedBy: "MAX_WEEKLY_HOURS", detail: "3h nad stropom", shortfall: 3, shortfallUnit: "hours" }),
    ];
    expect(pickClosestCandidate(candidates)?.employeeId).toBe("e2");
  });

  it("POSITION/ALREADY_ASSIGNED/ABSENCE/SCORE (shortfall=null) sa NIKDY nevyberú ako 'najbližší'", () => {
    const candidates = [rejected({ blockedBy: "POSITION", shortfall: null, shortfallUnit: null }), rejected({ blockedBy: "SCORE", shortfall: null, shortfallUnit: null })];
    expect(pickClosestCandidate(candidates)).toBeNull();
  });

  it("žiadny kvantifikovateľný kandidát → null (nie chyba)", () => {
    expect(pickClosestCandidate([])).toBeNull();
  });
});

describe("pickAbsentCandidates", () => {
  it("vráti LEN kandidátov blokovaných ABSENCE, ostatných vynechá", () => {
    const candidates = [
      rejected({ employeeId: "e1", name: "Peter", blockedBy: "ABSENCE", detail: "dovolenka" }),
      rejected({ employeeId: "e2", name: "Jana", blockedBy: "MIN_REST_DAILY", detail: "odpočinok" }),
      rejected({ employeeId: "e3", name: "Zuzana", blockedBy: "ABSENCE", detail: "PN" }),
    ];
    expect(pickAbsentCandidates(candidates)).toEqual([
      { employeeId: "e1", name: "Peter", detail: "dovolenka" },
      { employeeId: "e3", name: "Zuzana", detail: "PN" },
    ]);
  });

  it("nikto s absenciou → prázdny zoznam", () => {
    expect(pickAbsentCandidates([rejected({ blockedBy: "POSITION" })])).toEqual([]);
  });
});

const NEED: CoverageNeed = {
  positionId: "recepcia",
  minPeople: 1,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  appliesHolidays: true,
  isHard: true,
  shiftTemplateId: "t",
  startTime: "08:00:00",
  endTime: "16:00:00",
  crossesMidnight: false,
  breakMinutes: 30,
};

function emp(id: string, overrides: Partial<GenerateEmployee> = {}): GenerateEmployee {
  return { id, name: id, positionId: "recepcia", rules: [], contractedMonthlyHours: null, preferredShiftTemplateId: null, workTimeMode: "rovnomerny", priorMonthTailShifts: [], ...overrides };
}

describe("estimateStructuralCapacity", () => {
  it("1 človek na 7-dňovú dennú potrebu (bez block_length) → NEDOSTATOČNÁ kapacita, konkrétne číslo chýbajúcich ľudí", () => {
    // Február 2026 = 28 dní, potreba 7/7 = 28 osobodní. 1 človek bez block_length ~ 28*(6/7) ≈ 24.
    const result = estimateStructuralCapacity({ need: NEED, employees: [emp("e1")], year: 2026, month: 2, holidayDates: [] });
    expect(result).not.toBeNull();
    expect(result?.requiredPersonDaysPerMonth).toBe(28);
    expect(result?.estimatedCapacityPerMonth).toBeLessThan(28);
    expect(result?.estimatedMissingHeadcount).toBeGreaterThanOrEqual(1);
  });

  it("2 turnusoví ľudia (block_length:5 + min_rest_days:2, 5/7 kapacita každý) na 7-dňovú potrebu → kapacita STAČÍ, žiadny štrukturálny problém", () => {
    const turnusRules = [
      { ruleType: "block_length" as const, params: { days: 5 }, isHard: true, priority: 100 },
      { ruleType: "min_rest_days" as const, params: { days: 2 }, isHard: true, priority: 100 },
    ];
    const result = estimateStructuralCapacity({
      need: NEED,
      employees: [emp("e1", { rules: turnusRules }), emp("e2", { rules: turnusRules })],
      year: 2026,
      month: 2,
      holidayDates: [],
    });
    // 2 × 28×(5/7) = 40 > 28 potrebných → dostatočné, malo by vrátiť null.
    expect(result).toBeNull();
  });

  it("0 ľudí na pozícii → aj tak vráti odhad (nedelí sa 0-timi)", () => {
    const result = estimateStructuralCapacity({ need: NEED, employees: [], year: 2026, month: 2, holidayDates: [] });
    expect(result).not.toBeNull();
    expect(result?.estimatedMissingHeadcount).toBeGreaterThanOrEqual(1);
  });
});

describe("computeGapSuggestion / formatGapSuggestion", () => {
  it("skombinuje všetky tri časti do jedného čitateľného slovenského textu", () => {
    const rejectedCandidates = [
      rejected({ employeeId: "e1", name: "Jana", blockedBy: "MIN_REST_DAILY", detail: "odpočinok by bol 9 h (min. 11 h)", shortfall: 2, shortfallUnit: "hours" }),
      rejected({ employeeId: "e2", name: "Peter", blockedBy: "ABSENCE", detail: "dovolenka" }),
    ];
    const suggestion = computeGapSuggestion({ rejected: rejectedCandidates, need: NEED, employees: [emp("e1"), emp("e2")], year: 2026, month: 2, holidayDates: [] });
    const text = formatGapSuggestion(suggestion);

    expect(text).toContain("Najbližšie k obsadeniu: Jana");
    expect(text).toContain("odpočinok by bol 9 h");
    expect(text).toContain("Peter");
    // 2 ľudia bez block_length na dennú potrebu majú DOSTATOČNÚ kapacitu (viď estimateStructuralCapacity testy) — žiadna štrukturálna zložka tu.
    expect(text).not.toContain("štrukturálna príčina");
  });

  it("žiadna z troch častí sa nenašla → prázdny text (nie 'undefined'/'null' v správe)", () => {
    const turnusRules = [
      { ruleType: "block_length" as const, params: { days: 5 }, isHard: true, priority: 100 },
      { ruleType: "min_rest_days" as const, params: { days: 2 }, isHard: true, priority: 100 },
    ];
    const suggestion = computeGapSuggestion({
      rejected: [rejected({ blockedBy: "POSITION" })],
      need: NEED,
      employees: [emp("e1", { rules: turnusRules }), emp("e2", { rules: turnusRules })],
      year: 2026,
      month: 2,
      holidayDates: [],
    });
    expect(formatGapSuggestion(suggestion)).toBe("");
  });
});
