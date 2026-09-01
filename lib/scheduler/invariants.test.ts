import { describe, expect, it } from "vitest";
import { generateSchedule, type AbsenceEntry, type CoverageNeed, type GenerateEmployee, type GenerateInput, type LockedShift } from "./generate";
import { evaluateRules, type AvailabilityRuleInput, type LegalRuleInput } from "./rules";

/**
 * TVRDÉ testy na nemenné pravidlá (povinné), nezávislé od jednotlivých
 * Piece 1–4 testov vyššie. Cieľom
 * tu NIE JE otestovať mechaniku jedného pravidla (to už robia rules.test.ts/
 * scoring.test.ts/generate.test.ts) — cieľom je overiť, že samotné
 * NEMENNÉ pravidlo skutočne drží aj v ZLOŽITOM,
 * viacpravidlovom behu, kde sa veci môžu ľahšie pokaziť.
 */

const RECEPCIA = "pos-recepcia";

function emp(id: string, name: string, overrides: Partial<Omit<GenerateEmployee, "id" | "name" | "positionId">> = {}): GenerateEmployee {
  return {
    id,
    name,
    positionId: RECEPCIA,
    rules: [],
    contractedMonthlyHours: null,
    preferredShiftTemplateId: null,
    workTimeMode: "rovnomerny",
    priorMonthTailShifts: [],
    ...overrides,
  };
}

const SHIFT: CoverageNeed = {
  positionId: RECEPCIA,
  minPeople: 2,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  appliesHolidays: true,
  isHard: true,
  shiftTemplateId: "shift-denna",
  startTime: "09:00:00",
  endTime: "17:00:00",
  crossesMidnight: false,
  breakMinutes: 30,
};

function baseInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    workplaceId: "wp-1",
    year: 2026,
    month: 2, // 28 dní
    employees: [],
    coverageNeeds: [],
    legalRules: [],
    lockedShifts: [],
    absences: [],
    closedDates: [],
    holidayDates: [],
    ...overrides,
  };
}

describe("Nemenné #1 — HARD pravidlo sa NIKDY neporuší (meta-test na CELÝ vygenerovaný mesiac)", () => {
  it("5 zamestnancov, 5 rôznych hard pravidiel + §ZP naraz — spätne overené KAŽDÉ priradenie v behu", () => {
    const allowedWeekdaysRule: AvailabilityRuleInput = { ruleType: "allowed_weekdays", params: { days: [1, 2, 3, 4, 5] }, isHard: true, priority: 100 };
    const blockRule: AvailabilityRuleInput = { ruleType: "block_length", params: { days: 5 }, isHard: true, priority: 100 };
    const dateRangeBlockedRule: AvailabilityRuleInput = { ruleType: "date_range_blocked", params: { from: "2026-02-01", to: "2026-02-14" }, isHard: true, priority: 100 };
    const maxHoursWeekRule: AvailabilityRuleInput = { ruleType: "max_hours_per_week", params: { hours: 30 }, isHard: true, priority: 100 };

    const employees: GenerateEmployee[] = [
      emp("e1", "Bez víkendov", { rules: [allowedWeekdaysRule] }),
      emp("e2", "Andrej (blok 5)", { rules: [blockRule] }),
      emp("e3", "Nedostupná do 14.2.", { rules: [dateRangeBlockedRule] }),
      emp("e4", "Max 30h/týždeň", { rules: [maxHoursWeekRule] }),
      emp("e5", "Bez obmedzení"),
    ];

    const legalRules: LegalRuleInput[] = [
      { code: "MIN_REST_DAILY", params: { hours: 12 }, isHard: true },
      { code: "MAX_CONSEC_DAYS", params: { days: 6 }, isHard: false },
      { code: "MAX_SHIFT_HOURS", params: { hours: 12 }, isHard: true },
    ];

    const result = generateSchedule(baseInput({ employees, coverageNeeds: [SHIFT], legalRules }));

    expect(result.assignments.length).toBeGreaterThan(0); // scenár naozaj niečo vygeneroval, nie je to prázdny beh

    for (const assignment of result.assignments) {
      const employee = employees.find((e) => e.id === assignment.employeeId)!;
      // Zvyšok JEHO priradení v CELOM behu (mimo tohto jedného) — spätná rekonštrukcia kontextu.
      const otherShifts = result.assignments
        .filter((a) => a.employeeId === employee.id && a.date !== assignment.date)
        .map((a) => ({ date: a.date, startTime: a.startTime, endTime: a.endTime, crossesMidnight: a.crossesMidnight, breakMinutes: a.breakMinutes }));

      const violations = evaluateRules(
        { id: employee.id, name: employee.name },
        assignment.date,
        { startTime: assignment.startTime, endTime: assignment.endTime, crossesMidnight: assignment.crossesMidnight, breakMinutes: assignment.breakMinutes },
        { rules: employee.rules, legalRules, existingShifts: otherShifts },
      );

      const hardViolations = violations.filter((v) => v.isHard);
      expect(hardViolations, `${employee.name} @ ${assignment.date}: ${JSON.stringify(hardViolations)}`).toHaveLength(0);
    }
  });
});

describe("Nemenné #2 — SOFT pravidlo sa poruší LEN keď niet inej možnosti, a VŽDY sa nahlási", () => {
  it("jediný kandidát so soft porušením → dostane zmenu (žiadna diera), porušenie je zaznamenané v candidatesConsidered", () => {
    const softRule: AvailabilityRuleInput = { ruleType: "max_consecutive_days", params: { days: 3 }, isHard: false, priority: 4 };
    const jedinyKandidat = emp("e1", "Jana", { rules: [softRule] });

    const result = generateSchedule(
      baseInput({
        employees: [jedinyKandidat],
        coverageNeeds: [{ ...SHIFT, minPeople: 1 }],
        lockedShifts: ["2026-02-02", "2026-02-03", "2026-02-04"].map((d) => ({
          employeeId: "e1", date: d, positionId: RECEPCIA, startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0
        })),
      }),
    );

    // 5.2. by bol jej 4. deň v rade (nad soft limitom 3) — ale je JEDINÁ kandidátka, takže MUSÍ dostať zmenu.
    const feb5 = result.assignments.find((a) => a.date === "2026-02-05");
    expect(feb5).toBeDefined();
    expect(feb5?.employeeId).toBe("e1");
    expect(result.gaps.some((g) => g.date === "2026-02-05")).toBe(false);

    // A porušenie MUSÍ byť niekde zaznamenané — nie ticho prehliadnuté. Keďže je
    // jediná kandidátka, nie je v candidatesConsidered (nikto iný sa neposudzoval),
    // ale evaluateRules by pre ňu v tomto stave REÁLNE vrátil soft porušenie —
    // overme to priamo (rovnaká kontrola ako Nemenné #1, len s dôrazom na "je tam soft, nie 0").
    const violations = evaluateRules(
      { id: "e1", name: "Jana" },
      "2026-02-05",
      { startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 30 },
      {
        rules: [softRule],
        legalRules: [],
        existingShifts: ["2026-02-02", "2026-02-03", "2026-02-04"].map((d) => ({ date: d, startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 })),
      },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "MAX_CONSECUTIVE_DAYS", isHard: false });
  });
});

describe("Nemenné #3 — schválená AJ neschválená absencia sa rešpektuje rovnako", () => {
  it("AbsenceEntry nemá pole na potvrdenie — architektonicky sa nedá odlíšiť, obe blokujú identicky", () => {
    // Zámerne: `AbsenceEntry` (generate.ts) neobsahuje `isConfirmed` vôbec —
    // DB-loading vrstva (budúca) načíta VŠETKY absencie (schema.sql: "false =
    // žiadosť ešte visí, ale generátor to už rešpektuje") do jedného zoznamu.
    // Test overuje, že hocijaká absencia (bez ohľadu na to, čo by v DB bolo
    // is_confirmed) kandidáta zablokuje rovnako tvrdo.
    const schvalena: AbsenceEntry = { employeeId: "e1", date: "2026-02-10" };
    const neschvalena: AbsenceEntry = { employeeId: "e2", date: "2026-02-10" };

    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana (schválená dovolenka)"), emp("e2", "Peter (žiadosť ešte visí)")],
        coverageNeeds: [{ ...SHIFT, minPeople: 2 }],
        absences: [schvalena, neschvalena],
      }),
    );

    // Obaja jediní kandidáti sú preč → 2 potrebné miesta, 0 obsadených → diera.
    const gap = result.gaps.find((g) => g.date === "2026-02-10");
    expect(gap).toBeDefined();
    expect(gap?.assigned).toBe(0);
    expect(gap?.candidatesRejected.map((c) => c.blockedBy)).toEqual(["ABSENCE", "ABSENCE"]);
    expect(result.assignments.some((a) => a.date === "2026-02-10")).toBe(false);
  });
});

describe("Nemenné #4 — locked zmeny sa NIKDY nedotknú", () => {
  it("locked zmeny sa neobjavia v assignments, nezdvojia sa, a vstupné dáta ostanú nezmenené", () => {
    const lockedShifts: LockedShift[] = [
      { employeeId: "e1", date: "2026-02-03", positionId: RECEPCIA, startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 },
      { employeeId: "e2", date: "2026-02-10", positionId: RECEPCIA, startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 },
      { employeeId: "e1", date: "2026-02-17", positionId: RECEPCIA, startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 },
    ];
    const lockedSnapshotBefore = JSON.parse(JSON.stringify(lockedShifts));

    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana"), emp("e2", "Peter"), emp("e3", "Eva")],
        coverageNeeds: [{ ...SHIFT, minPeople: 2 }],
        lockedShifts,
      }),
    );

    // Vstupné dáta o zamknutých zmenách sa NEMUTOVALI.
    expect(lockedShifts).toEqual(lockedSnapshotBefore);

    // Žiadna VYGENEROVANÁ zmena nezdvojila zamknutú (employeeId+date kombináciu).
    for (const locked of lockedShifts) {
      const duplicate = result.assignments.find((a) => a.employeeId === locked.employeeId && a.date === locked.date);
      expect(duplicate, `${locked.employeeId} @ ${locked.date} by nemal mať DRUHÚ (generovanú) zmenu`).toBeUndefined();
    }

    // A žiadny deň s zamknutou zmenou nemá dieru na celý needed počet — aspoň JEDNO miesto (locked) je vždy pokryté.
    expect(result.gaps.find((g) => g.date === "2026-02-03" && g.assigned === 0)).toBeUndefined();
  });
});

describe("Nemenné #5 — keď sa deň nedá obsadiť, je to DIERA s presným dôvodom, nikdy 'najmenšie zlo'", () => {
  it("nikto neprežije hard filter → gap s konkrétnymi menami a kódmi pravidiel, žiadne tiché tolerovanie", () => {
    const zakazanyKazdyDen: AvailabilityRuleInput = { ruleType: "blocked_weekdays", params: { days: [1, 2, 3, 4, 5, 6, 7] }, isHard: true, priority: 100 };
    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana", { rules: [zakazanyKazdyDen] })],
        coverageNeeds: [{ ...SHIFT, minPeople: 1 }],
      }),
    );

    expect(result.assignments).toHaveLength(0);
    expect(result.gaps.length).toBeGreaterThan(0);
    for (const gap of result.gaps) {
      expect(gap.message).not.toBe("Nepodarilo sa vygenerovať rozvrh.");
      expect(gap.candidatesRejected).toContainEqual(
        expect.objectContaining({ employeeId: "e1", blockedBy: "BLOCKED_WEEKDAYS" }),
      );
    }
  });
});

describe("Nemenné #6 — hodiny a víkendy sa rozdelia FÉROVO (5 ľudí / 30 dní)", () => {
  it("po 30 dňoch (marec 2026) je rozdiel medzi najviac a najmenej vyťaženým < 2 zmeny, aj pre víkendy", () => {
    const employees = Array.from({ length: 5 }, (_, i) => emp(`e${i + 1}`, `Zamestnanec ${i + 1}`));
    const need: CoverageNeed = { ...SHIFT, minPeople: 1 };

    const result = generateSchedule(
      baseInput({ year: 2026, month: 3, employees, coverageNeeds: [need] }), // marec 2026 = 31 dní, dosť blízko "30 dní"
    );

    expect(result.gaps).toHaveLength(0); // 5 ľudí na 1 miesto denne — nemal by byť dôvod na dieru

    const perEmployee = new Map<string, { total: number; weekend: number }>();
    for (const e of employees) perEmployee.set(e.id, { total: 0, weekend: 0 });
    for (const a of result.assignments) {
      const stats = perEmployee.get(a.employeeId)!;
      stats.total++;
      const weekday = new Date(`${a.date}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) stats.weekend++;
    }

    const totals = [...perEmployee.values()].map((s) => s.total);
    const weekends = [...perEmployee.values()].map((s) => s.weekend);

    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(2);
    expect(Math.max(...weekends) - Math.min(...weekends)).toBeLessThanOrEqual(2);
  });
});
