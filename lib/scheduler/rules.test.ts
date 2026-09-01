import { describe, expect, it } from "vitest";
import { evaluateRules, shiftDurationHours, type AssignedShift, type AvailabilityRuleInput, type CandidateShift, type LegalRuleInput, type RuleEvaluationContext } from "./rules";

/**
 * `evaluateRules` je čistá funkcia, žiadne DB. Každý typ
 * pravidla (`availability_rule_type`) aj relevantné §ZP (`legal_rules`) majú
 * tu svoj vlastný test, ručne overený na papieri — "test pre každý typ
 * pravidla zvlášť".
 *
 * MIN_REST_WEEKLY (nepretržitý 35h odpočinok v týždni) tu ZÁMERNE chýba —
 * nedá sa vyhodnotiť z jedného kandidátneho dňa, len z celého zloženého
 * týždňa (viď komentár v rules.ts). Rieši sa v `weekly-rest.ts`.
 */

const EMPLOYEE = { id: "emp-1", name: "Testovacia" };

const NORMAL_SHIFT: CandidateShift = { startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 30 };

function ctx(overrides: Partial<RuleEvaluationContext> = {}): RuleEvaluationContext {
  return { rules: [], legalRules: [], existingShifts: [], ...overrides };
}

function rule(ruleType: AvailabilityRuleInput["ruleType"], params: Record<string, unknown>, isHard = true, priority = 100): AvailabilityRuleInput {
  return { ruleType, params, isHard, priority };
}

function legal(code: string, params: Record<string, unknown>, isHard = true): LegalRuleInput {
  return { code, params, isHard };
}

describe("evaluateRules — allowed_weekdays", () => {
  it("deň MIMO povolených → violation", () => {
    // 2026-02-02 je pondelok (deň 1). Povolené len Po-Št (1-4) — v poriadku.
    // Skús v piatok (deň 5), ktorý nie je povolený.
    const violations = evaluateRules(EMPLOYEE, "2026-02-06", NORMAL_SHIFT, ctx({ rules: [rule("allowed_weekdays", { days: [1, 2, 3, 4] })] }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "ALLOWED_WEEKDAYS", isHard: true });
  });

  it("deň V rámci povolených → žiadna violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [rule("allowed_weekdays", { days: [1, 2, 3, 4] })] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — blocked_weekdays", () => {
  it("deň MEDZI zakázanými → violation", () => {
    // Piatok (2026-02-06) je zakázaný deň (5).
    const violations = evaluateRules(EMPLOYEE, "2026-02-06", NORMAL_SHIFT, ctx({ rules: [rule("blocked_weekdays", { days: [5] })] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("BLOCKED_WEEKDAYS");
  });

  it("iný deň → žiadna violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [rule("blocked_weekdays", { days: [5] })] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — block_length ('Andrej môže len 5-dňové bloky')", () => {
  const fiveDayBlock = rule("block_length", { days: 5 });

  it("6. deň v rade (nad rámec 5-dňového bloku) → violation", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-07", NORMAL_SHIFT, ctx({ rules: [fiveDayBlock], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "BLOCK_LENGTH", isHard: true });
  });

  it("5. deň v rade (ešte v rámci bloku) → žiadna violation", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-06", NORMAL_SHIFT, ctx({ rules: [fiveDayBlock], existingShifts }));
    expect(violations).toHaveLength(0);
  });

  it("nová (prázdna) séria → žiadna violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [fiveDayBlock] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — max_consecutive_days", () => {
  it("presiahnutie max. dní v kuse → violation", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07"].map(
      (date) => ({ date, startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 }),
    );
    const violations = evaluateRules(EMPLOYEE, "2026-02-08", NORMAL_SHIFT, ctx({ rules: [rule("max_consecutive_days", { days: 6 })], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("MAX_CONSECUTIVE_DAYS");
  });

  it("presne na hranici (nie nad) → žiadna violation", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-07", NORMAL_SHIFT, ctx({ rules: [rule("max_consecutive_days", { days: 6 })], existingShifts }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — min_rest_days", () => {
  const needsThreeDaysOff = rule("min_rest_days", { days: 3 });

  it("len 1 deň voľna po bloku (potreba 3) → violation", () => {
    // Pracoval 2026-02-02..06, voľno 07, teraz skúša 08 (len 1 deň voľna).
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-08", NORMAL_SHIFT, ctx({ rules: [needsThreeDaysOff], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("MIN_REST_DAYS");
  });

  it("presne 3 dni voľna → žiadna violation", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    // Voľno 04, 05, 06 (presne 3 dni) — skúša 07.
    const violations = evaluateRules(EMPLOYEE, "2026-02-07", NORMAL_SHIFT, ctx({ rules: [needsThreeDaysOff], existingShifts }));
    expect(violations).toHaveLength(0);
  });

  it("uprostred EŠTE PREBIEHAJÚCEHO bloku (včera sa pracovalo) → NIKDY violation, aj keby 'dní voľna' vyšlo 0 (nájdené na seed dátach)", () => {
    // Pracoval 2026-02-02, 03 (2 dni v rade, žiadna medzera) — skúša 04 (pokračovanie, nie nový začiatok).
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-04", NORMAL_SHIFT, ctx({ rules: [needsThreeDaysOff], existingShifts }));
    expect(violations).toHaveLength(0);
  });

  it("žiadna predchádzajúca práca (nový zamestnanec) → žiadna violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [needsThreeDaysOff] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — week_parity", () => {
  it("chce nepárne týždne, ale dátum padá do párneho → violation", () => {
    // 2026-02-02 je ISO týždeň 6 (párny).
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [rule("week_parity", { parity: "odd" })] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("WEEK_PARITY");
  });

  it("chce párne týždne a dátum padá do párneho → žiadna violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [rule("week_parity", { parity: "even" })] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — date_range_available", () => {
  const onlyJuly = rule("date_range_available", { from: "2026-07-01", to: "2026-07-31" });

  it("mimo obdobia dostupnosti → violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-08-01", NORMAL_SHIFT, ctx({ rules: [onlyJuly] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("DATE_RANGE_AVAILABLE");
  });

  it("v rámci obdobia dostupnosti → žiadna violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-07-15", NORMAL_SHIFT, ctx({ rules: [onlyJuly] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — date_range_blocked", () => {
  const blockedAugust = rule("date_range_blocked", { from: "2026-08-01", to: "2026-08-14" });

  it("v rámci blokovaného obdobia → violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-08-05", NORMAL_SHIFT, ctx({ rules: [blockedAugust] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("DATE_RANGE_BLOCKED");
  });

  it("mimo blokovaného obdobia → žiadna violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-08-20", NORMAL_SHIFT, ctx({ rules: [blockedAugust] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — max_hours_per_week", () => {
  it("nová zmena by prekročila týždenný limit → violation", () => {
    // Pondelok-štvrtok už 32h (8h/deň), limit 40h. Nová 8h zmena v piatok → 40h presne (OK).
    // Skús limit 35h — 32 + 8 = 40 > 35 → violation.
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-06", NORMAL_SHIFT, ctx({ rules: [rule("max_hours_per_week", { hours: 35 })], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("MAX_HOURS_PER_WEEK");
  });

  it("presne na hranici (40h) → žiadna violation", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-06", NORMAL_SHIFT, ctx({ rules: [rule("max_hours_per_week", { hours: 40 })], existingShifts }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — max_hours_per_month", () => {
  it("nová zmena by prekročila mesačný limit → violation", () => {
    const existingShifts: AssignedShift[] = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, "0")}`,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    })); // 10 * 8h = 80h
    const violations = evaluateRules(EMPLOYEE, "2026-02-11", NORMAL_SHIFT, ctx({ rules: [rule("max_hours_per_month", { hours: 85 })], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("MAX_HOURS_PER_MONTH");
  });
});

describe("evaluateRules — min_hours_per_month (zmluvný fond — nikdy sa 'neporuší' pridaním zmeny)", () => {
  it("aj hlboko pod fondom → NIKDY violation (je to len skórovací signál pre Blok 9b)", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [rule("min_hours_per_month", { hours: 160 })] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — preferred_shift (kozmetika — nikdy dôvod na vyradenie)", () => {
  it("nikdy nevráti violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [rule("preferred_shift", { shift_template_id: "abc" })] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — §ZP MIN_REST_DAILY", () => {
  it("predošlá zmena končí príliš neskoro → odpočinok pod 12h → violation", () => {
    // Predošlá zmena 2026-02-01 14:00-22:00, nová zmena 2026-02-02 07:00 → len 9h odpočinku.
    const existingShifts: AssignedShift[] = [{ date: "2026-02-01", startTime: "14:00:00", endTime: "22:00:00", crossesMidnight: false, breakMinutes: 0 }];
    const morningShift: CandidateShift = { startTime: "07:00:00", endTime: "15:00:00", crossesMidnight: false, breakMinutes: 30 };
    const violations = evaluateRules(
      EMPLOYEE,
      "2026-02-02",
      morningShift,
      ctx({ legalRules: [legal("MIN_REST_DAILY", { hours: 12 })], existingShifts }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "MIN_REST_DAILY", isHard: true });
  });

  it("dostatočný odpočinok → žiadna violation", () => {
    const existingShifts: AssignedShift[] = [{ date: "2026-02-01", startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 }];
    const violations = evaluateRules(
      EMPLOYEE,
      "2026-02-02",
      NORMAL_SHIFT, // 09:00, t.j. 16h po 17:00 včera
      ctx({ legalRules: [legal("MIN_REST_DAILY", { hours: 12 })], existingShifts }),
    );
    expect(violations).toHaveLength(0);
  });

  it("nočná zmena cez polnoc → odpočinok sa počíta od SKUTOČNÉHO konca (ďalší deň)", () => {
    // Nočná zmena 22:00-06:00 (crossesMidnight) — reálne končí až ráno.
    const existingShifts: AssignedShift[] = [{ date: "2026-02-01", startTime: "22:00:00", endTime: "06:00:00", crossesMidnight: true, breakMinutes: 0 }];
    // Ďalšia zmena 2026-02-02 o 08:00 — len 2h po reálnom konci (06:00) → violation.
    const nextMorning: CandidateShift = { startTime: "08:00:00", endTime: "16:00:00", crossesMidnight: false, breakMinutes: 30 };
    const violations = evaluateRules(
      EMPLOYEE,
      "2026-02-02",
      nextMorning,
      ctx({ legalRules: [legal("MIN_REST_DAILY", { hours: 12 })], existingShifts }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("2.0 h");
  });

  it("žiadna predchádzajúca zmena (prvý deň) → žiadna violation", () => {
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ legalRules: [legal("MIN_REST_DAILY", { hours: 12 })] }));
    expect(violations).toHaveLength(0);
  });

  it("REGRESIA (Skupina B): prechod na LETNÝ čas (29.3.2026, 1h sa STRATÍ) — nominálne 12h medzery sú v REALITE len 11h, MUSÍ nahlásiť porušenie", () => {
    // Predošlá zmena končí 28.3. 18:00 (sobota), ďalšia začína 29.3. 06:00
    // (nedeľa prechodu) — hodinovkovo presne 12h, ale hodiny 02:00-03:00tú
    // noc vôbec neexistujú, takže SKUTOČNE uplynulo len 11h. Predtým to
    // `shiftStartMinutes`/`shiftEndMinutes` počítali naivnou "dni × 1440 +
    // minúty" aritmetikou (bez DST) a tichoTO prehliadli — zamestnanec by
    // dostal zmenu, ktorá reálne porušuje 12h minimum.
    const existingShifts: AssignedShift[] = [{ date: "2026-03-28", startTime: "10:00:00", endTime: "18:00:00", crossesMidnight: false, breakMinutes: 0 }];
    const nextShift: CandidateShift = { startTime: "06:00:00", endTime: "14:00:00", crossesMidnight: false, breakMinutes: 30 };
    const violations = evaluateRules(EMPLOYEE, "2026-03-29", nextShift, ctx({ legalRules: [legal("MIN_REST_DAILY", { hours: 12 })], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("11.0 h");
  });

  it("REGRESIA (Skupina B): prechod na ZIMNÝ čas (25.10.2026, 1h sa ZOPAKUJE) — nominálne krátka medzera je v REALITE o hodinu dlhšia", () => {
    // Predošlá zmena končí 24.10. 17:00-19:00, ďalšia 25.10. 06:00 — hodina
    // 02:00-03:00 sa tú noc odohrá DVAKRÁT, takže skutočný odpočinok je o
    // 1h VIAC než naivná aritmetika napočíta (13h skutočných, nie 12h).
    const existingShifts: AssignedShift[] = [{ date: "2026-10-24", startTime: "17:00:00", endTime: "19:00:00", crossesMidnight: false, breakMinutes: 0 }];
    const nextShift: CandidateShift = { startTime: "06:00:00", endTime: "14:00:00", crossesMidnight: false, breakMinutes: 30 };
    const violations = evaluateRules(EMPLOYEE, "2026-10-25", nextShift, ctx({ legalRules: [legal("MIN_REST_DAILY", { hours: 12 })], existingShifts }));
    expect(violations).toHaveLength(0);
  });
});

describe("shiftDurationHours — NEOVPLYVNENÁ prechodom letný/zimný čas (zámerne nominálna, časový rámec zmeny)", () => {
  it("nočná zmena cez polnoc DST prechodu má stále presne nominálnu dĺžku, nie skutočnú DST-posunutú", () => {
    // Na rozdiel od shiftStartMinutes/shiftEndMinutes (odpočinok, DST-korektné)
    // shiftDurationHours zostáva ZÁMERNE nominálna — je to "časový rámec"
    // zmeny, nie skutočne uplynutý čas.
    expect(shiftDurationHours({ startTime: "22:00:00", endTime: "06:00:00", crossesMidnight: true })).toBe(8);
  });
});

describe("evaluateRules — §ZP MAX_CONSEC_DAYS", () => {
  it("presiahnutie → violation (rovnaký mechanizmus ako max_consecutive_days)", () => {
    const existingShifts: AssignedShift[] = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-02-0${i + 2}`,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-08", NORMAL_SHIFT, ctx({ legalRules: [legal("MAX_CONSEC_DAYS", { days: 6 }, false)], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "MAX_CONSEC_DAYS", isHard: false }); // v seede je toto SOFT pravidlo
  });
});

describe("evaluateRules — §ZP MAX_WEEKLY_HOURS", () => {
  it("presiahnutie týždenného §ZP limitu → violation", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06"].map((date) => ({
      date,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    })); // 5 * 8h = 40h, presne na limite
    const violations = evaluateRules(EMPLOYEE, "2026-02-07", NORMAL_SHIFT, ctx({ legalRules: [legal("MAX_WEEKLY_HOURS", { hours: 40 })], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("MAX_WEEKLY_HOURS");
  });
});

describe("evaluateRules — prestávka: MAX_WEEKLY_HOURS ráta ČISTÉ hodiny (nie hrubé rozpätie)", () => {
  // 07:30–18:30 s 60 min prestávkou = 11h HRUBÉ rozpätie, ale len 10h ČISTÉHO odpracovaného času.
  const shiftWithBreak: CandidateShift = { startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 60 };

  it("hrubý súčet (3×11h + 11h = 44h) by porušil 40h strop, ale ČISTÝ (3×10h + 10h = 40h) je presne na hranici → žiadna violation", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04"].map((date) => ({
      date,
      startTime: shiftWithBreak.startTime,
      endTime: shiftWithBreak.endTime,
      crossesMidnight: false,
      breakMinutes: 60,
    }));
    const violations = evaluateRules(
      EMPLOYEE,
      "2026-02-05",
      shiftWithBreak,
      ctx({ legalRules: [legal("MAX_WEEKLY_HOURS", { hours: 40 })], existingShifts }),
    );
    expect(violations).toHaveLength(0);
  });

  it("keď aj ČISTÝ súčet presiahne strop (5×10h = 50h) → violation s NETTO hodinami v hláške, nie brutto", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"].map((date) => ({
      date,
      startTime: shiftWithBreak.startTime,
      endTime: shiftWithBreak.endTime,
      crossesMidnight: false,
      breakMinutes: 60,
    }));
    const violations = evaluateRules(
      EMPLOYEE,
      "2026-02-06",
      shiftWithBreak,
      ctx({ legalRules: [legal("MAX_WEEKLY_HOURS", { hours: 40 })], existingShifts }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("50.0 h"); // 5 × 10h čistého, NIE 55h hrubého
  });
});

describe("evaluateRules — prestávka NEOVPLYVŇUJE MAX_SHIFT_HOURS (zámerne HRUBÉ rozpätie zmeny)", () => {
  it("07:30–18:30 (11h hrubé, 10h čisté pri 60 min prestávke) voči stropu 10.5h → violation, lebo sa ráta HRUBÝ čas", () => {
    // Keby sa omylom počítalo čisté (10h), 10h > 10.5h by bolo false a violation by chýbala.
    const shift: CandidateShift = { startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 60 };
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", shift, ctx({ legalRules: [legal("MAX_SHIFT_HOURS", { hours: 10.5 })] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("MAX_SHIFT_HOURS");
    expect(violations[0].message).toContain("11.0 h");
  });
});

describe("evaluateRules — prestávka NEOVPLYVŇUJE odpočinok (MIN_REST_DAILY sa počíta od SKUTOČNÉHO konca zmeny, nie od konca čistej práce)", () => {
  it("predošlá zmena 07:30–18:30 s 0 min prestávkou vs. s 60 min prestávkou → identický odpočinok do ďalšej zmeny", () => {
    const nextShift: CandidateShift = { startTime: "07:00:00", endTime: "15:00:00", crossesMidnight: false, breakMinutes: 30 };
    const legalRules = [legal("MIN_REST_DAILY", { hours: 13 })]; // odpočinok bude 12.5h → pod 13h, violation



    const withoutBreak: AssignedShift[] = [{ date: "2026-02-01", startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 0 }];
    const withBreak: AssignedShift[] = [{ date: "2026-02-01", startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 60 }];

    const violationsWithoutBreak = evaluateRules(EMPLOYEE, "2026-02-02", nextShift, ctx({ legalRules, existingShifts: withoutBreak }));
    const violationsWithBreak = evaluateRules(EMPLOYEE, "2026-02-02", nextShift, ctx({ legalRules, existingShifts: withBreak }));

    // Odpočinok sa počíta od 18:30 (koniec ZMENY, od–do) v OBOCH prípadoch — prestávka
    // človeka z práce nevynímala, je stále "v práci" celý čas.
    expect(violationsWithoutBreak).toEqual(violationsWithBreak);
    expect(violationsWithoutBreak).toHaveLength(1);
    expect(violationsWithoutBreak[0].message).toContain("12.5 h"); // 18:30 -> 07:00 = 12.5h
  });
});

describe("evaluateRules — §ZP MAX_SHIFT_HOURS", () => {
  it("zmena dlhšia než povolené maximum → violation", () => {
    const longShift: CandidateShift = { startTime: "06:00:00", endTime: "19:00:00", crossesMidnight: false, breakMinutes: 30 }; // 13h
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", longShift, ctx({ legalRules: [legal("MAX_SHIFT_HOURS", { hours: 12 })] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("MAX_SHIFT_HOURS");
  });

  it("presne na hranici → žiadna violation", () => {
    const twelveHourShift: CandidateShift = { startTime: "06:00:00", endTime: "18:00:00", crossesMidnight: false, breakMinutes: 30 };
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", twelveHourShift, ctx({ legalRules: [legal("MAX_SHIFT_HOURS", { hours: 12 })] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — §ZP BREAK_AFTER_HOURS", () => {
  it("dlhá zmena s príliš krátkou prestávkou → violation", () => {
    const longShiftShortBreak: CandidateShift = { startTime: "07:00:00", endTime: "19:00:00", crossesMidnight: false, breakMinutes: 15 }; // 12h, len 15 min prestávka
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", longShiftShortBreak, ctx({ legalRules: [legal("BREAK_AFTER_HOURS", { after_hours: 6, break_minutes: 30 })] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("BREAK_AFTER_HOURS");
  });

  it("dlhá zmena s dostatočnou prestávkou → žiadna violation", () => {
    const longShiftOkBreak: CandidateShift = { startTime: "07:00:00", endTime: "19:00:00", crossesMidnight: false, breakMinutes: 30 };
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", longShiftOkBreak, ctx({ legalRules: [legal("BREAK_AFTER_HOURS", { after_hours: 6, break_minutes: 30 })] }));
    expect(violations).toHaveLength(0);
  });

  it("krátka zmena (pod hranicou) nepotrebuje prestávku vôbec", () => {
    const shortShift: CandidateShift = { startTime: "09:00:00", endTime: "13:00:00", crossesMidnight: false, breakMinutes: 0 }; // 4h
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", shortShift, ctx({ legalRules: [legal("BREAK_AFTER_HOURS", { after_hours: 6, break_minutes: 30 })] }));
    expect(violations).toHaveLength(0);
  });
});

describe("evaluateRules — kombinácia viacerých pravidiel naraz", () => {
  it("vráti VŠETKY porušené pravidlá naraz, nie len prvé", () => {
    const violations = evaluateRules(
      EMPLOYEE,
      "2026-02-06", // piatok
      NORMAL_SHIFT,
      ctx({
        rules: [rule("blocked_weekdays", { days: [5] }), rule("date_range_blocked", { from: "2026-02-01", to: "2026-02-28" })],
      }),
    );
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.code).sort()).toEqual(["BLOCKED_WEEKDAYS", "DATE_RANGE_BLOCKED"]);
  });

  it("bez pravidiel a bez existujúcich zmien → žiadna violation (prázdny kontext je vždy v poriadku)", () => {
    expect(evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx())).toHaveLength(0);
  });
});

describe("evaluateRules — priority pre Blok 9b", () => {
  it("porušenie employee_availability_rules nesie JEHO VLASTNÚ priority", () => {
    // Piatok (2026-02-06) je zakázaný deň — vlastná priority pravidla je 7.
    const violations = evaluateRules(EMPLOYEE, "2026-02-06", NORMAL_SHIFT, ctx({ rules: [rule("blocked_weekdays", { days: [5] }, false, 7)] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].priority).toBe(7);
  });

  it("porušenie legal_rules (žiadny stĺpec priority v DB) dostane DEFAULT prioritu 1", () => {
    const existingShifts: AssignedShift[] = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-02-0${i + 2}`,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false, breakMinutes: 0
    }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-08", NORMAL_SHIFT, ctx({ legalRules: [legal("MAX_CONSEC_DAYS", { days: 6 }, false)], existingShifts }));
    expect(violations).toHaveLength(1);
    expect(violations[0].priority).toBe(1);
  });
});

/**
 * Blok A (§87 ZP, zjednodušené): `nerovnomerny_turnus`
 * NEMÁ MAX_WEEKLY_HOURS strop VÔBEC — skúšali sme priemerovanie cez
 * vyrovnávacie obdobie (Blok A2/A3), ale cross-month súčet spôsoboval
 * nespravodlivosť (jeden človek dostal drasticky menej, len preto, že
 * predtým veľa robil) — zahodené. Bez `workTimeMode` v kontexte (predošlé
 * testy vyššie) je správanie PRESNE také ako pred Blokom A.
 */
describe("evaluateRules — §ZP MAX_WEEKLY_HOURS, nerovnomerny_turnus (Blok A, zjednodušené)", () => {
  const RECEPCIA_SHIFT: CandidateShift = { startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 30 }; // 10.5h čistého — presne reálny scenár

  it("5. deň v kuse (52.5h v jednom ISO týždni) — ROVNOMERNY zamietne (>40h/týždeň), TURNUS povolí VŽDY (strop preň neexistuje)", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"].map((date) => ({
      date,
      startTime: RECEPCIA_SHIFT.startTime,
      endTime: RECEPCIA_SHIFT.endTime,
      crossesMidnight: false,
      breakMinutes: 30,
    })); // 4 dni × 10.5h = 42h už teraz

    const legalRules = [legal("MAX_WEEKLY_HOURS", { hours: 40 })];

    const rovnomerny = evaluateRules(EMPLOYEE, "2026-02-06", RECEPCIA_SHIFT, ctx({ legalRules, existingShifts }));
    expect(rovnomerny).toHaveLength(1);
    expect(rovnomerny[0].code).toBe("MAX_WEEKLY_HOURS");

    const turnus = evaluateRules(EMPLOYEE, "2026-02-06", RECEPCIA_SHIFT, ctx({ legalRules, existingShifts, workTimeMode: "nerovnomerny_turnus" }));
    expect(turnus).toHaveLength(0);
  });

  it("TURNUS nezamietne ANI PRI EXTRÉMNOM súčte (žiadny strop, žiadna výnimka) — MAX_WEEKLY_HOURS sa preň jednoducho nevyhodnocuje", () => {
    const existingShifts: AssignedShift[] = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, "0")}`,
      startTime: RECEPCIA_SHIFT.startTime,
      endTime: RECEPCIA_SHIFT.endTime,
      crossesMidnight: false,
      breakMinutes: 30,
    })); // 20 dní v rade × 10.5h = 210h — absurdne veľa, zámerne

    const violations = evaluateRules(EMPLOYEE, "2026-02-21", RECEPCIA_SHIFT, ctx({ legalRules: [legal("MAX_WEEKLY_HOURS", { hours: 40 })], existingShifts, workTimeMode: "nerovnomerny_turnus" }));
    expect(violations.filter((v) => v.code === "MAX_WEEKLY_HOURS")).toHaveLength(0);
  });

  it("MIN_REST_DAILY platí ROVNAKO v turnuse ako v rovnomernom režime — mode neovplyvňuje odpočinok", () => {
    const previous: AssignedShift = { date: "2026-02-02", startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 30 };
    const legalRules = [legal("MIN_REST_DAILY", { hours: 12 })];

    // Ďalšia zmena už o 10h neskôr (17:00 + 10h = 03:00) — menej než 12h odpočinku, MUSÍ zlyhať v OBOCH režimoch.
    const nextDayEarlyShift: CandidateShift = { startTime: "03:00:00", endTime: "11:00:00", crossesMidnight: false, breakMinutes: 30 };

    const rovnomerny = evaluateRules(EMPLOYEE, "2026-02-03", nextDayEarlyShift, ctx({ legalRules, existingShifts: [previous] }));
    const turnus = evaluateRules(EMPLOYEE, "2026-02-03", nextDayEarlyShift, ctx({ legalRules, existingShifts: [previous], workTimeMode: "nerovnomerny_turnus" }));

    expect(rovnomerny).toHaveLength(1);
    expect(rovnomerny[0].code).toBe("MIN_REST_DAILY");
    expect(turnus).toHaveLength(1);
    expect(turnus[0].code).toBe("MIN_REST_DAILY");
  });
});

/**
 * Q21 — `shortfall`/`shortfallUnit` musí byť VŽDY kladné
 * číslo v prirodzenej jednotke pravidla ("o koľko by sa muselo niečo
 * zmeniť"), aby `gap-suggestions.ts` vedel nájsť "najbližšieho" kandidáta
 * bez scrapovania textu správy. Binárne (áno/nie) pravidlá musia dať `null`.
 */
describe("evaluateRules — shortfall/shortfallUnit (Q21, gap-suggestions)", () => {
  it("block_length: shortfall = o koľko dní by bol blok dlhší, jednotka 'days'", () => {
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06"].map((date) => ({ date, ...NORMAL_SHIFT }));
    const violations = evaluateRules(EMPLOYEE, "2026-02-07", NORMAL_SHIFT, ctx({ rules: [rule("block_length", { days: 5 })], existingShifts }));
    expect(violations[0]).toMatchObject({ code: "BLOCK_LENGTH", shortfall: 1, shortfallUnit: "days" });
  });

  it("min_rest_days: shortfall = o koľko dní odpočinku chýba, jednotka 'days'", () => {
    // 1 deň voľna (1.2.), potrebné min. 3 — chýbajú 2 dni.
    const existingShifts: AssignedShift[] = [{ date: "2026-01-31", ...NORMAL_SHIFT }];
    const violations = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [rule("min_rest_days", { days: 3 })], existingShifts }));
    expect(violations[0]).toMatchObject({ code: "MIN_REST_DAYS", shortfall: 2, shortfallUnit: "days" });
  });

  it("MIN_REST_DAILY: shortfall = o koľko hodín odpočinku chýba, jednotka 'hours'", () => {
    const previous: AssignedShift = { date: "2026-02-02", startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 30 };
    const nextDayShift: CandidateShift = { startTime: "01:00:00", endTime: "09:00:00", crossesMidnight: false, breakMinutes: 30 };
    const violations = evaluateRules(EMPLOYEE, "2026-02-03", nextDayShift, ctx({ legalRules: [legal("MIN_REST_DAILY", { hours: 11 })], existingShifts: [previous] }));
    // Odpočinok 17:00→01:00 = 8h, treba 11h → chýba 3h.
    expect(violations[0]).toMatchObject({ code: "MIN_REST_DAILY", shortfall: 3, shortfallUnit: "hours" });
  });

  it("MAX_WEEKLY_HOURS: shortfall = o koľko hodín by bolo NAD stropom, jednotka 'hours'", () => {
    // Po-Št (2.-5.2.2026), 10h/deň bez prestávky = 40h už v tomto ISO týždni (Mon 2.2. - Sun 8.2.).
    const existingShifts: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"].map((date) => ({ date, startTime: "07:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 }));
    const shift: CandidateShift = { startTime: "07:00:00", endTime: "12:00:00", crossesMidnight: false, breakMinutes: 0 }; // +5h = 45h, strop 40h → o 5h nad
    const violations = evaluateRules(EMPLOYEE, "2026-02-06", shift, ctx({ legalRules: [legal("MAX_WEEKLY_HOURS", { hours: 40 })], existingShifts }));
    expect(violations[0]).toMatchObject({ code: "MAX_WEEKLY_HOURS", shortfall: 5, shortfallUnit: "hours" });
  });

  it("binárne pravidlá (allowed_weekdays, week_parity, date_range_*) → shortfall vždy null", () => {
    const v1 = evaluateRules(EMPLOYEE, "2026-02-06", NORMAL_SHIFT, ctx({ rules: [rule("allowed_weekdays", { days: [1] })] }));
    const v2 = evaluateRules(EMPLOYEE, "2026-02-02", NORMAL_SHIFT, ctx({ rules: [rule("week_parity", { parity: "odd" })] }));
    expect(v1[0]).toMatchObject({ shortfall: null, shortfallUnit: null });
    expect(v2[0]).toMatchObject({ shortfall: null, shortfallUnit: null });
  });
});
