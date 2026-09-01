import { describe, expect, it } from "vitest";
import { evaluateRules, type AssignedShift, type AvailabilityRuleInput } from "./rules";
import { breakScoreTie, generateSchedule, type CoverageNeed, type EmployeeRunState, type GenerateEmployee, type GenerateInput, type LockedShift } from "./generate";
import { longestRestHoursInWeek, weeksInMonth } from "./weekly-rest";

/**
 * Blok 9c — Piece 1 testuje LEN kostru slučky (dni × pozície, zatvorené
 * dni, zamknuté zmeny, neprítomnosť); Piece 2 (nižšie) testuje SKUTOČNÝ
 * výber cez `evaluateRules` (9a, hard/soft) + `scoreCandidate` (9b, skóre).
 */

const RECEPCIA = "pos-recepcia";

function emp(
  id: string,
  name: string,
  positionId: string | null = RECEPCIA,
  overrides: Partial<Omit<GenerateEmployee, "id" | "name" | "positionId">> = {},
): GenerateEmployee {
  return {
    id,
    name,
    positionId,
    rules: [],
    contractedMonthlyHours: null,
    preferredShiftTemplateId: null,
    workTimeMode: "rovnomerny",
    priorMonthTailShifts: [],
    ...overrides,
  };
}

function lockedShift(employeeId: string, date: string, positionId: string | null = RECEPCIA, startTime = "09:00:00", endTime = "17:00:00"): LockedShift {
  return { employeeId, date, positionId, startTime, endTime, crossesMidnight: false, breakMinutes: 0 };
}

const RANNA: CoverageNeed = {
  positionId: RECEPCIA,
  minPeople: 1,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  appliesHolidays: true,
  isHard: true,
  shiftTemplateId: "shift-ranna",
  startTime: "07:00:00",
  endTime: "15:00:00",
  crossesMidnight: false,
  breakMinutes: 30,
};

function baseInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    workplaceId: "wp-1",
    year: 2026,
    month: 2, // február 2026, 28 dní
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

describe("generateSchedule — Piece 1: kostra slučky", () => {
  it("obsadí jednoduchú potrebu (1 pozícia, 1 človek, každý deň) na celý mesiac", () => {
    const result = generateSchedule(baseInput({ employees: [emp("e1", "Jana")], coverageNeeds: [RANNA] }));
    expect(result.gaps).toHaveLength(0);
    expect(result.assignments).toHaveLength(28); // február 2026 = 28 dní
    expect(result.assignments.every((a) => a.employeeId === "e1")).toBe(true);
  });

  it("zatvorený deň prevádzky → žiadna pozícia sa ten deň VÔBEC neobsadzuje (ani gap, ani assignment)", () => {
    const result = generateSchedule(
      baseInput({ employees: [emp("e1", "Jana")], coverageNeeds: [RANNA], closedDates: ["2026-02-15"] }),
    );
    expect(result.assignments.some((a) => a.date === "2026-02-15")).toBe(false);
    expect(result.gaps.some((g) => g.date === "2026-02-15")).toBe(false);
    expect(result.assignments).toHaveLength(27); // 28 - 1 zatvorený deň
  });

  it("REGRESIA (Skupina B): sviatok + appliesHolidays:false → deň sa VÔBEC neskúša (ani gap, ani assignment); appliesHolidays:true → normálne obsadený", () => {
    const officeNeed: CoverageNeed = { ...RANNA, positionId: "office", appliesHolidays: false };
    const hotelNeed: CoverageNeed = { ...RANNA, positionId: "hotel", appliesHolidays: true };
    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana", "office"), emp("e2", "Peter", "hotel")],
        coverageNeeds: [officeNeed, hotelNeed],
        holidayDates: ["2026-02-15"],
      }),
    );
    expect(result.assignments.some((a) => a.date === "2026-02-15" && a.employeeId === "e1")).toBe(false);
    expect(result.gaps.some((g) => g.date === "2026-02-15" && g.positionId === "office")).toBe(false);
    expect(result.assignments.some((a) => a.date === "2026-02-15" && a.employeeId === "e2")).toBe(true);
  });

  it("zamknutá zmena UŽ pokrýva potrebu → generátor NEVYTVORÍ druhú zmenu (a zamknutú sa ani nesnaží nahradiť)", () => {
    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana"), emp("e2", "Peter")],
        coverageNeeds: [RANNA],
        lockedShifts: [lockedShift("e2", "2026-02-01")],
      }),
    );
    const feb1Assignments = result.assignments.filter((a) => a.date === "2026-02-01");
    expect(feb1Assignments).toHaveLength(0); // potreba (1) je už pokrytá zamknutou zmenou, netreba nič nové
    expect(result.gaps.some((g) => g.date === "2026-02-01")).toBe(false);
  });

  it("zamknutá zmena zaráta zamestnanca ako UŽ priradeného — nedostane v ten deň ĎALŠIU (inú) zmenu", () => {
    const inaPozicia: CoverageNeed = { ...RANNA, positionId: null, shiftTemplateId: "shift-ina" };
    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana")],
        coverageNeeds: [inaPozicia],
        lockedShifts: [lockedShift("e1", "2026-02-01", "iná-pozícia")],
      }),
    );
    // Jana je jediná zamestnankyňa, ale 1.2. už má zamknutú zmenu — nesmie dostať druhú.
    const feb1 = result.assignments.filter((a) => a.date === "2026-02-01");
    expect(feb1).toHaveLength(0);
    const gapFeb1 = result.gaps.find((g) => g.date === "2026-02-01");
    expect(gapFeb1).toBeDefined();
    expect(gapFeb1?.candidatesRejected).toContainEqual(
      expect.objectContaining({ employeeId: "e1", blockedBy: "ALREADY_ASSIGNED" }),
    );
  });

  it("neprítomný zamestnanec (dovolenka/PN) sa NIKDY nevyberie, aj keby bol jediný kandidát → gap", () => {
    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana")],
        coverageNeeds: [RANNA],
        absences: [{ employeeId: "e1", date: "2026-02-10" }],
      }),
    );
    expect(result.assignments.some((a) => a.date === "2026-02-10")).toBe(false);
    const gap = result.gaps.find((g) => g.date === "2026-02-10");
    expect(gap).toBeDefined();
    expect(gap?.candidatesRejected).toContainEqual(expect.objectContaining({ employeeId: "e1", blockedBy: "ABSENCE" }));
  });

  it("viac pozícií v ten istý deň sa riešia NEZÁVISLE od seba", () => {
    const kuchyna: CoverageNeed = { ...RANNA, positionId: "pos-kuchyna", shiftTemplateId: "shift-kuchyna" };
    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana", RECEPCIA), emp("e2", "Eva", "pos-kuchyna")],
        coverageNeeds: [RANNA, kuchyna],
      }),
    );
    const feb1 = result.assignments.filter((a) => a.date === "2026-02-01");
    expect(feb1).toHaveLength(2);
    expect(feb1.map((a) => a.employeeId).sort()).toEqual(["e1", "e2"]);
  });

  it("nikto s danou pozíciou neexistuje → gap na KAŽDÝ platný deň, s dôvodom POSITION", () => {
    const result = generateSchedule(baseInput({ employees: [emp("e1", "Jana", "iná-pozícia")], coverageNeeds: [RANNA] }));
    expect(result.assignments).toHaveLength(0);
    expect(result.gaps).toHaveLength(28);
    expect(result.gaps[0].candidatesRejected).toEqual([
      { employeeId: "e1", name: "Jana", blockedBy: "POSITION", detail: "Nemá požadovanú pozíciu.", shortfall: null, shortfallUnit: null },
    ]);
  });

  it("weekdays obmedzenie potreby (napr. len Po-Pi) sa rešpektuje — cez víkend sa pozícia vôbec neposudzuje", () => {
    const poPiOnly: CoverageNeed = { ...RANNA, weekdays: [1, 2, 3, 4, 5] };
    const result = generateSchedule(baseInput({ employees: [emp("e1", "Jana")], coverageNeeds: [poPiOnly] }));
    // Február 2026: 28 dní, 8 víkendových dní (4 soboty + 4 nedele) → 20 pracovných dní.
    expect(result.assignments).toHaveLength(20);
    expect(result.gaps).toHaveLength(0);
  });

  it("minPeople > 1 vyžaduje viac priradení na ten istý deň/pozíciu", () => {
    const dvaja: CoverageNeed = { ...RANNA, minPeople: 2 };
    const result = generateSchedule(baseInput({ employees: [emp("e1", "Jana"), emp("e2", "Peter")], coverageNeeds: [dvaja] }));
    const feb1 = result.assignments.filter((a) => a.date === "2026-02-01");
    expect(feb1).toHaveLength(2);
    expect(result.gaps).toHaveLength(0);
  });

  it("minPeople > 1 a nedostatok kandidátov → čiastočné pokrytie + gap s presným 'assigned'/'needed'", () => {
    const dvaja: CoverageNeed = { ...RANNA, minPeople: 2 };
    const result = generateSchedule(baseInput({ employees: [emp("e1", "Jana")], coverageNeeds: [dvaja] }));
    const feb1 = result.assignments.filter((a) => a.date === "2026-02-01");
    expect(feb1).toHaveLength(1); // Jana pokryje jedno miesto
    const gap = result.gaps.find((g) => g.date === "2026-02-01");
    expect(gap).toMatchObject({ needed: 2, assigned: 1 });
  });
});

describe("generateSchedule — Piece 2: evaluateRules (hard/soft) + scoreCandidate (skóre)", () => {
  it("HARD porušenie úplne vyradí kandidáta — aj keby bol štrukturálne v poriadku (nie je to len penalizácia)", () => {
    const zakazanyPiatok: AvailabilityRuleInput = { ruleType: "blocked_weekdays", params: { days: [5] }, isHard: true, priority: 100 };
    const iba_piatky: CoverageNeed = { ...RANNA, weekdays: [5] };
    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana", RECEPCIA, { rules: [zakazanyPiatok] }), emp("e2", "Peter")],
        coverageNeeds: [iba_piatky],
      }),
    );
    // Jana má piatky zakázané (hard) — na KAŽDÝ piatok musí vyhrať Peter, nikdy nie ona.
    const fridayAssignments = result.assignments;
    expect(fridayAssignments.length).toBeGreaterThan(0);
    expect(fridayAssignments.every((a) => a.employeeId === "e2")).toBe(true);
  });

  it("VIAC KANDIDÁTOV — víťaz sa vyberá podľa NAJNIŽŠIEHO SKÓRE (menej doterajších hodín vyhráva), nie 'prvý vhodný'", () => {
    const ibaPiatky: CoverageNeed = { ...RANNA, weekdays: [5] };
    const jana = emp("e1", "Jana", RECEPCIA, { contractedMonthlyHours: 160 });
    const peter = emp("e2", "Peter", RECEPCIA, { contractedMonthlyHours: 160 });

    const result = generateSchedule(
      baseInput({
        employees: [jana, peter],
        coverageNeeds: [ibaPiatky],
        // Jana má odrobených len 16h (2×8h, mimo piatkov), Peter 40h (5×8h, mimo piatkov) —
        // rozdielna história PRED testovaným dňom.
        lockedShifts: [
          lockedShift("e1", "2026-02-02"),
          lockedShift("e1", "2026-02-03"),
          lockedShift("e2", "2026-02-09"),
          lockedShift("e2", "2026-02-10"),
          lockedShift("e2", "2026-02-11"),
          lockedShift("e2", "2026-02-12"),
          lockedShift("e2", "2026-02-16"),
        ],
        // Izolácia na JEDEN konkrétny piatok (20.2.) — na ostatných troch piatkoch
        // (6., 13., 27.2.) sú OBAJA neprítomní, aby do výsledku nezasahovala
        // priebežná zmena skóre z predošlých piatkov.
        absences: [
          { employeeId: "e1", date: "2026-02-06" }, { employeeId: "e2", date: "2026-02-06" },
          { employeeId: "e1", date: "2026-02-13" }, { employeeId: "e2", date: "2026-02-13" },
          { employeeId: "e1", date: "2026-02-27" }, { employeeId: "e2", date: "2026-02-27" },
        ],
      }),
    );

    const feb20 = result.assignments.filter((a) => a.date === "2026-02-20");
    expect(feb20).toHaveLength(1);
    expect(feb20[0].employeeId).toBe("e1"); // Jana — má menej odrobených hodín, vyhráva
  });

  it("SOFT porušenie NEVYRADÍ kandidáta, len ho penalizuje v skóre — bez porušenia vyhráva, ak je rovnocenný", () => {
    // Jana odrobila 6 dní v rade (Po-So), soft pravidlo max_consecutive_days:6 —
    // 7. deň (Ne) by bol jej 7. v rade → soft porušenie, ale NEVYRADÍ ju.
    const maxSestDni: AvailabilityRuleInput = { ruleType: "max_consecutive_days", params: { days: 6 }, isHard: false, priority: 2 };
    const jana = emp("e1", "Jana", RECEPCIA, { rules: [maxSestDni] });
    const peter = emp("e2", "Peter", RECEPCIA); // bez histórie, bez pravidiel — úplne "čistý" kandidát

    const nedelaOnly: CoverageNeed = { ...RANNA, weekdays: [7] };
    const result = generateSchedule(
      baseInput({
        employees: [jana, peter],
        coverageNeeds: [nedelaOnly],
        lockedShifts: ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07"].map((d) => lockedShift("e1", d)),
        // Izolácia na 8.2. (jediná nedeľa, ktorú Jana sekvenciou pokrýva) — ostatné nedele (1.,15.,22.) nech obaja preskočia.
        absences: [
          { employeeId: "e1", date: "2026-02-01" }, { employeeId: "e2", date: "2026-02-01" },
          { employeeId: "e1", date: "2026-02-15" }, { employeeId: "e2", date: "2026-02-15" },
          { employeeId: "e1", date: "2026-02-22" }, { employeeId: "e2", date: "2026-02-22" },
        ],
      }),
    );

    const feb8 = result.assignments.filter((a) => a.date === "2026-02-08");
    expect(feb8).toHaveLength(1);
    expect(feb8[0].employeeId).toBe("e2"); // Peter — bez penalizácie, vyhráva nad Janou (soft porušenie)

    // Jana pritom NEBOLA vyradená ako kandidátka (bola len penalizovaná) — v zozname
    // zvažovaných kandidátov PRI ÚSPEŠNOM priradení je s dôvodom SCORE, NIE s kódom
    // porušeného pravidla (MAX_CONSECUTIVE_DAYS by znamenalo, že vôbec nemohla; SCORE
    // znamená, že mohla, len prehrala na férovosti).
    expect(feb8[0].candidatesConsidered).toContainEqual({
      employeeId: "e1",
      name: "Jana",
      blockedBy: "SCORE",
      detail: "Iný kandidát mal nižšie (výhodnejšie) skóre férovosti.",
      shortfall: null,
      shortfallUnit: null,
    });

    const gap = result.gaps.find((g) => g.date === "2026-02-08");
    expect(gap).toBeUndefined(); // veď bola obsadená — Peter vyhral
  });

  it("NIKTO neprežije HARD filter → DIERA s presným zoznamom kandidátov a KTORÉ pravidlo koho vyhodilo", () => {
    const zakazanyPiatok: AvailabilityRuleInput = { ruleType: "blocked_weekdays", params: { days: [5] }, isHard: true, priority: 100 };
    const celyMesiacNedostupny: AvailabilityRuleInput = {
      ruleType: "date_range_blocked",
      params: { from: "2026-02-01", to: "2026-02-28" },
      isHard: true,
      priority: 100,
    };
    const ibaPiatky: CoverageNeed = { ...RANNA, weekdays: [5] };

    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana", RECEPCIA, { rules: [zakazanyPiatok] }), emp("e2", "Peter", RECEPCIA, { rules: [celyMesiacNedostupny] })],
        coverageNeeds: [ibaPiatky],
      }),
    );

    expect(result.assignments).toHaveLength(0); // ani jeden piatok sa neobsadil
    expect(result.gaps.length).toBeGreaterThan(0);

    const gap = result.gaps[0];
    expect(gap.assigned).toBe(0);
    expect(gap.candidatesRejected).toContainEqual({
      employeeId: "e1",
      name: "Jana",
      blockedBy: "BLOCKED_WEEKDAYS",
      detail: "Nesmie pracovať v deň 5 (zakázané dni: 5).",
      shortfall: null,
      shortfallUnit: null,
    });
    expect(gap.candidatesRejected).toContainEqual({
      employeeId: "e2",
      name: "Peter",
      blockedBy: "DATE_RANGE_BLOCKED",
      detail: "Nedostupný v období 2026-02-01–2026-02-28.",
      shortfall: null,
      shortfallUnit: null,
    });
  });

  it("priebežná aktualizácia férovosti: po priradení sa hodiny/víkendy hneď premietnu — dvaja rovnakí kandidáti sa STRIEDAJÚ, jeden nezoberie všetko", () => {
    const jana = emp("e1", "Jana", RECEPCIA);
    const peter = emp("e2", "Peter", RECEPCIA);
    // Len 2 piatky v hre (6. a 13.2.), oba dostupné obom — bez rozdielu na štarte.
    const ibaPiatky: CoverageNeed = { ...RANNA, weekdays: [5] };

    const result = generateSchedule(
      baseInput({
        employees: [jana, peter],
        coverageNeeds: [ibaPiatky],
        absences: [
          { employeeId: "e1", date: "2026-02-20" }, { employeeId: "e2", date: "2026-02-20" },
          { employeeId: "e1", date: "2026-02-27" }, { employeeId: "e2", date: "2026-02-27" },
        ],
      }),
    );

    const feb6 = result.assignments.find((a) => a.date === "2026-02-06")?.employeeId;
    const feb13 = result.assignments.find((a) => a.date === "2026-02-13")?.employeeId;
    expect(feb6).toBeDefined();
    expect(feb13).toBeDefined();
    // Po prvom priradení sa priebežne aktualizuje férovosť — druhý piatok preto
    // vyhrá TEN DRUHÝ (nie ten istý človek oba dva razy).
    expect(feb13).not.toBe(feb6);
  });
});

describe("generateSchedule — Piece 3: súvislé bloky (block_length sa MUSÍ dokončiť, nie len nikdy neprekročiť)", () => {
  it("Andrej (block_length: 5) dostane SÚVISLÝCH 5 dní v rade, potom pauzu — nie fragmenty (2+3)", () => {
    const blockRule: AvailabilityRuleInput = { ruleType: "block_length", params: { days: 5 }, isHard: true, priority: 100 };
    const andrej = emp("e1", "Andrej", RECEPCIA, { rules: [blockRule] });
    const beata = emp("e2", "Beata", RECEPCIA); // bez pravidla — "voľná" zamestnankyňa, ktorá by inak konkurovala každý deň

    const kazdyDen: CoverageNeed = { ...RANNA, weekdays: [1, 2, 3, 4, 5, 6, 7] };
    const result = generateSchedule(baseInput({ employees: [andrej, beata], coverageNeeds: [kazdyDen] }));

    const prvychSestDni = ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06"].map(
      (d) => result.assignments.find((a) => a.date === d)?.employeeId,
    );

    // Presne 5 dní v rade Andrejovi (SÚVISLE, nie roztrhané) — potom PAUZA (niekto iný / on prestáva).
    expect(prvychSestDni.slice(0, 5)).toEqual(["e1", "e1", "e1", "e1", "e1"]);
    expect(prvychSestDni[5]).not.toBe("e1"); // 6. deň by prekročil block_length — jeho hard strop to zachytí

    // Žiadne priradenie Andrejovi nie je izolovaný "ostrovček" obklopený niekým iným v rámci jeho bloku.
    const andrejovDni = result.assignments.filter((a) => a.employeeId === "e1").map((a) => a.date).sort();
    expect(andrejovDni.slice(0, 5)).toEqual(["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"]);
  });

  it("schválená absencia uprostred bloku (3. deň) preruší blok legitímne — NIE je to zaznamenané ako porušenie súvislosti", () => {
    const blockRule: AvailabilityRuleInput = { ruleType: "block_length", params: { days: 5 }, isHard: true, priority: 100 };
    const andrej = emp("e1", "Andrej", RECEPCIA, { rules: [blockRule] });
    const beata = emp("e2", "Beata", RECEPCIA);

    const kazdyDen: CoverageNeed = { ...RANNA, weekdays: [1, 2, 3, 4, 5, 6, 7] };
    const result = generateSchedule(
      baseInput({
        employees: [andrej, beata],
        coverageNeeds: [kazdyDen],
        absences: [{ employeeId: "e1", date: "2026-02-03" }], // schválená dovolenka na 3. deň bloku
      }),
    );

    // Dni 1-2 (pred absenciou) sú súvislé, patria Andrejovi — absencia nespôsobila spätné zrušenie.
    expect(result.assignments.find((a) => a.date === "2026-02-01")?.employeeId).toBe("e1");
    expect(result.assignments.find((a) => a.date === "2026-02-02")?.employeeId).toBe("e1");

    // 3. deň: Andrej NEDOSTANE zmenu (je preč), ale niekto iný pokrytie zoberie — ŽIADNA diera.
    const gapDen3 = result.gaps.find((g) => g.date === "2026-02-03");
    expect(gapDen3).toBeUndefined();
    const den3 = result.assignments.find((a) => a.date === "2026-02-03");
    expect(den3?.employeeId).toBe("e2");

    // KĽÚČOVÉ: dôvod, prečo Andrej nedostal 3. deň, je VÝHRADNE "ABSENCE" —
    // nie kód porušenia súvislosti (BLOCK_LENGTH/MAX_CONSECUTIVE_DAYS by
    // znamenalo, že si "sám pokazil" blok, čo nie je pravda — dôvod je legitímny).
    expect(den3?.candidatesConsidered).toContainEqual(
      expect.objectContaining({ employeeId: "e1", blockedBy: "ABSENCE" }),
    );
    expect(den3?.candidatesConsidered.some((c) => c.employeeId === "e1" && c.blockedBy.includes("BLOCK"))).toBe(false);
  });
});

describe("generateSchedule — Piece 4: MIN_REST_WEEKLY (celotýždňová kontrola)", () => {
  const MIN_REST_WEEKLY_35H = { code: "MIN_REST_WEEKLY", params: { hours: 35 }, isHard: true };

  it("jediná kandidátka pracuje KAŽDÝ deň mesiaca → generátor DODATOČNE zruší dni, aby v každom týždni bolo 35h+ odpočinku", () => {
    const jana = emp("e1", "Jana", "pos");
    const kazdyDen: CoverageNeed = { ...RANNA, positionId: "pos", weekdays: [1, 2, 3, 4, 5, 6, 7] };

    const result = generateSchedule(
      baseInput({ employees: [jana], coverageNeeds: [kazdyDen], legalRules: [MIN_REST_WEEKLY_35H] }),
    );

    // Aspoň jeden deň MUSEL ustúpiť — 7 dní v rade s 8h zmenami dáva len 16h medzery, nikdy 35h.
    expect(result.assignments.length).toBeLessThan(28);
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps.every((g) => g.candidatesRejected[0]?.blockedBy === "MIN_REST_WEEKLY")).toBe(true);

    // NAJDÔLEŽITEJŠIE: po oprave musí byť v KAŽDOM týždni mesiaca skutočne
    // aspoň 35h nepretržitého odpočinku — nielen "menej dní", ale invariant naozaj splnený.
    const finalShifts: AssignedShift[] = result.assignments
      .filter((a) => a.employeeId === "e1")
      .map((a) => ({ date: a.date, startTime: a.startTime, endTime: a.endTime, crossesMidnight: a.crossesMidnight, breakMinutes: a.breakMinutes }));
    for (const { weekStart, weekEnd } of weeksInMonth(2026, 2, 28)) {
      expect(longestRestHoursInWeek(finalShifts, weekStart, weekEnd)).toBeGreaterThanOrEqual(35);
    }
  });

  it("bežný Po-Pi rozvrh s víkendom voľno NIKDY nepotrebuje zásah (žiadne falošné poplachy)", () => {
    const jana = emp("e1", "Jana", "pos");
    const poPiOnly: CoverageNeed = { ...RANNA, positionId: "pos", weekdays: [1, 2, 3, 4, 5] };

    const result = generateSchedule(
      baseInput({ employees: [jana], coverageNeeds: [poPiOnly], legalRules: [MIN_REST_WEEKLY_35H] }),
    );

    expect(result.gaps).toHaveLength(0);
    expect(result.assignments).toHaveLength(20); // 28 dní - 8 víkendových = 20 pracovných dní, nič zrušené naviac
  });

  it("SOFT MIN_REST_WEEKLY (isHard: false) sa NEVYNUCUJE touto opravou — mimo rozsahu (len hard sa takto rieši)", () => {
    const jana = emp("e1", "Jana", "pos");
    const kazdyDen: CoverageNeed = { ...RANNA, positionId: "pos", weekdays: [1, 2, 3, 4, 5, 6, 7] };
    const softRule = { code: "MIN_REST_WEEKLY", params: { hours: 35 }, isHard: false };

    const result = generateSchedule(
      baseInput({ employees: [jana], coverageNeeds: [kazdyDen], legalRules: [softRule] }),
    );

    // Soft verzia sa touto (len-hard) opravou nedotkne — pokrytie zostáva celé.
    expect(result.assignments).toHaveLength(28);
    expect(result.gaps).toHaveLength(0);
  });
});

describe("generateSchedule — REGRESIA: MIN_REST_WEEKLY zrušenie nesmie vytvoriť NOVÉ hard porušenie", () => {
  it("scenár, ktorý PÔVODNE spôsoboval kaskádové min_rest_days porušenie, teraz beží úplne čisto (0 dier, dokonalá rovnováha)", () => {
    // Presne reálny nález (Skupina A, scenár A1): dvaja ľudia, block_length 5
    // + min_rest_days 2 (obe hard), 8h zmena, MIN_REST_WEEKLY hard. PÔVODNE:
    // retroaktívne zrušenie zmeny (kvôli falošnému MIN_REST_WEEKLY porušeniu
    // z edge-case v `longestRestHoursInWeek`) vytvorilo umelú
    // medzeru uprostred bloku, ktorá spustila min_rest_days pre nasledujúci
    // deň — Jana skončila s 15 dňami/112,5h, Marek len 11/82,5h (30h rozdiel).
    //
    // Po oprave #53 (okrajové medzery v `longestRestHoursInWeek` sa počítajú
    // správne namiesto ich úplného ignorovania) toto konkrétne MIN_REST_WEEKLY
    // porušenie bolo VŽDY falošné — takže teraz už vôbec nenastane a scenár
    // vyjde presne symetricky: 15/15, 0 dier. Toto JE regresný test — ak sa
    // niekedy v budúcnosti znova objaví nerovnováha alebo diera v tomto
    // presnom scenári, znamená to, že sa buď #53, alebo bezpečnostná poistka
    // `enforceNoResidualHardViolations` znova pokazila.
    const rules: AvailabilityRuleInput[] = [
      { ruleType: "block_length", params: { days: 5 }, isHard: true, priority: 100 },
      { ruleType: "min_rest_days", params: { days: 2 }, isHard: true, priority: 100 },
    ];
    const jana = emp("jana", "Jana", "pos", { rules, contractedMonthlyHours: 160 });
    const marek = emp("marek", "Marek", "pos", { rules, contractedMonthlyHours: 160 });
    const kazdyDen: CoverageNeed = { ...RANNA, positionId: "pos", weekdays: [1, 2, 3, 4, 5, 6, 7] };
    const legalRules = [
      { code: "MIN_REST_WEEKLY", params: { hours: 35 }, isHard: true },
      { code: "MAX_WEEKLY_HOURS", params: { hours: 40 }, isHard: true },
    ];

    const result = generateSchedule(
      baseInput({ employees: [jana, marek], coverageNeeds: [kazdyDen], legalRules, month: 9 /* rovnaký mesiac ako reálny nález */ }),
    );

    expect(result.gaps).toHaveLength(0);
    const janaDays = result.assignments.filter((a) => a.employeeId === "jana").length;
    const marekDays = result.assignments.filter((a) => a.employeeId === "marek").length;
    expect(janaDays).toBe(15);
    expect(marekDays).toBe(15);

    // NAJDÔLEŽITEJŠIE: žiadne finálne priradenie nesmie, po rekonštrukcii kontextu
    // z OSTATNÝCH priradení toho istého zamestnanca, porušovať ŽIADNE hard pravidlo.
    const employees = [jana, marek];
    for (const assignment of result.assignments) {
      const employee = employees.find((e) => e.id === assignment.employeeId)!;
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

    // A napokon: bloky musia byť súvislé (5 dní v rade), nie roztrhané.
    const consecutiveRuns = (dates: string[]) => {
      const sorted = [...dates].sort();
      const runs: number[] = [];
      let run = 1;
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(`${sorted[i - 1]}T00:00:00`);
        const cur = new Date(`${sorted[i]}T00:00:00`);
        if ((cur.getTime() - prev.getTime()) / 86_400_000 === 1) run++;
        else { runs.push(run); run = 1; }
      }
      runs.push(run);
      return runs;
    };
    expect(consecutiveRuns(result.assignments.filter((a) => a.employeeId === "jana").map((a) => a.date))).toEqual([5, 5, 5]);
    expect(consecutiveRuns(result.assignments.filter((a) => a.employeeId === "marek").map((a) => a.date))).toEqual([5, 5, 5]);
  });
});

describe("generateSchedule — REGRESIA: remíza v skóre je deterministická, NEZÁVISLÁ od poradia poľa employees", () => {
  it("dvaja symetrickí block_length kolegovia (rovnaké pravidlá, rovnaký fond) — výsledok sa NESMIE zmeniť pri obrátenom poradí vstupu", () => {
    // Presne nájdené vizuálnou kontrolou Skupiny A: pri presnej remíze v skóre
    // (deň 1, obaja na 0 hodinách) predtým vyhrával, kto bol prvý v poli
    // `employees` — Jana 112,5h vs Marek 82,5h za mesiac len kvôli poradiu.
    const rules: AvailabilityRuleInput[] = [
      { ruleType: "block_length", params: { days: 5 }, isHard: true, priority: 100 },
      { ruleType: "min_rest_days", params: { days: 2 }, isHard: true, priority: 100 },
    ];
    const jana = emp("jana", "Jana", "pos", { rules, contractedMonthlyHours: 160 });
    const marek = emp("marek", "Marek", "pos", { rules, contractedMonthlyHours: 160 });
    const kazdyDen: CoverageNeed = { ...RANNA, positionId: "pos", weekdays: [1, 2, 3, 4, 5, 6, 7] };
    const legalRules = [
      { code: "MIN_REST_WEEKLY", params: { hours: 35 }, isHard: true },
      { code: "MAX_WEEKLY_HOURS", params: { hours: 40 }, isHard: true },
    ];

    const resultJanaFirst = generateSchedule(
      baseInput({ employees: [jana, marek], coverageNeeds: [kazdyDen], legalRules, month: 9 }),
    );
    const resultMarekFirst = generateSchedule(
      baseInput({ employees: [marek, jana], coverageNeeds: [kazdyDen], legalRules, month: 9 }),
    );

    const countDays = (result: typeof resultJanaFirst, employeeId: string) =>
      result.assignments.filter((a) => a.employeeId === employeeId).length;

    expect(countDays(resultJanaFirst, "jana")).toBe(countDays(resultMarekFirst, "jana"));
    expect(countDays(resultJanaFirst, "marek")).toBe(countDays(resultMarekFirst, "marek"));
    expect(resultJanaFirst.assignments.find((a) => a.date === "2026-09-01")?.employeeId).toBe(
      resultMarekFirst.assignments.find((a) => a.date === "2026-09-01")?.employeeId,
    );
  });

  // Priame testy `breakScoreTie` — v CELOM behu je takmer nemožné vyrobiť
  // skutočnú remízu v SKÓRE, kde sa hodiny LÍŠIA (rozdiel v hodinách sa takmer
  // vždy prejaví aj v skóre samotnom, takže sa k rozstrelu vôbec nedostane).
  // Kritériá 1–4 sa preto testujú priamo na funkcii, s ručne pripravenými
  // stavmi — presne to, čo od remízy vyžaduje zadanie.
  describe("breakScoreTie — priamo, kritérium po kritériu", () => {
    const DATE = "2026-02-10";
    const state = (
      overrides: Partial<EmployeeRunState["fairness"]> = {},
      existingShifts: EmployeeRunState["existingShifts"] = [],
      tieBreakWinsThisMonth = 0,
    ): EmployeeRunState => ({
      existingShifts,
      fairness: { assignedHoursThisMonth: 0, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0, ...overrides },
      tieBreakWinsThisMonth,
    });

    it("kritérium 1: menej odpracovaných hodín tento mesiac vyhráva", () => {
      const jana = emp("jana", "Jana");
      const marek = emp("marek", "Marek");
      const tied = [
        { employee: marek, state: state({ assignedHoursThisMonth: 50 }) }, // Marek ZÁMERNE prvý — poradie sa nesmie prejaviť
        { employee: jana, state: state({ assignedHoursThisMonth: 30 }) },
      ];
      expect(breakScoreTie(tied, DATE).id).toBe("jana");
    });

    it("kritérium 2: rovnaké hodiny → menej víkendových zmien vyhráva", () => {
      const jana = emp("jana", "Jana");
      const marek = emp("marek", "Marek");
      const tied = [
        { employee: marek, state: state({ assignedHoursThisMonth: 40, assignedWeekendShiftsThisMonth: 3 }) },
        { employee: jana, state: state({ assignedHoursThisMonth: 40, assignedWeekendShiftsThisMonth: 1 }) },
      ];
      expect(breakScoreTie(tied, DATE).id).toBe("jana");
    });

    it("kritérium 3: rovnaké hodiny aj víkendy → MENEJ doterajších výhier v remíze vyhráva", () => {
      // Presne scenár z reálneho nálezu: Marek by na kritériu 4 (odpočinok)
      // vyhral aj tak (0 dní práce pred dneškom = "voľnejší"), ale Jana už
      // MÁ za sebou 1 predošlú výhru remízy a Marek 0 — kritérium 3 ho preto
      // zastaví SKÔR, než sa vôbec dostane k odpočinku.
      const jana = emp("jana", "Jana");
      const marek = emp("marek", "Marek");
      const tied = [
        { employee: jana, state: state({ assignedHoursThisMonth: 40 }, [], 1) },
        { employee: marek, state: state({ assignedHoursThisMonth: 40 }, [], 0) },
      ];
      expect(breakScoreTie(tied, DATE).id).toBe("marek");
    });

    it("kritérium 4: rovnaké hodiny, víkendy AJ výhry v remíze → DLHŠÍ odpočinok pred dneškom vyhráva", () => {
      const jana = emp("jana", "Jana");
      const marek = emp("marek", "Marek");
      // Marek pracoval včera (08.02.) — len 1 deň odpočinku pred 10.2.
      // Jana naposledy pracovala 05.02. — 4 dni odpočinku pred 10.2.
      const tied = [
        { employee: marek, state: state({ assignedHoursThisMonth: 40 }, [{ date: "2026-02-08", startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 }]) },
        { employee: jana, state: state({ assignedHoursThisMonth: 40 }, [{ date: "2026-02-05", startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 0 }]) },
      ];
      expect(breakScoreTie(tied, DATE).id).toBe("jana");
    });

    it("kritérium 5: úplne všetko rovnaké → rozhodne employee.id (nie poradie v poli)", () => {
      const alfa = emp("alfa", "Alfa");
      const beta = emp("beta", "Beta");
      const tiedBetaFirst = [{ employee: beta, state: state() }, { employee: alfa, state: state() }];
      const tiedAlfaFirst = [{ employee: alfa, state: state() }, { employee: beta, state: state() }];
      expect(breakScoreTie(tiedBetaFirst, DATE).id).toBe("alfa");
      expect(breakScoreTie(tiedAlfaFirst, DATE).id).toBe("alfa");
    });
  });

  it("REGRESIA: počítadlo výhier v remíze sa naozaj plní počas generovania — druhá remíza sa NEVRACIA vždy tomu istému", () => {
    // Integračný test presne na pôvodnom náleze: dvaja block_length kolegovia,
    // deň 1 je remíza (id rozhodne), deň 11 by BEZ opravy bola remíza znova
    // rozhodnutá kritériom odpočinku v prospech toho istého víťaza z dňa 1.
    const rules: AvailabilityRuleInput[] = [
      { ruleType: "block_length", params: { days: 5 }, isHard: true, priority: 100 },
      { ruleType: "min_rest_days", params: { days: 2 }, isHard: true, priority: 100 },
    ];
    const jana = emp("jana", "Jana", "pos", { rules, contractedMonthlyHours: 160 });
    const marek = emp("marek", "Marek", "pos", { rules, contractedMonthlyHours: 160 });
    const kazdyDen: CoverageNeed = { ...RANNA, positionId: "pos", weekdays: [1, 2, 3, 4, 5, 6, 7] };
    const legalRules = [
      { code: "MIN_REST_WEEKLY", params: { hours: 35 }, isHard: true },
      { code: "MAX_WEEKLY_HOURS", params: { hours: 40 }, isHard: true },
    ];

    const result = generateSchedule(baseInput({ employees: [jana, marek], coverageNeeds: [kazdyDen], legalRules, month: 9 }));

    const janaDays = result.assignments.filter((a) => a.employeeId === "jana").length;
    const marekDays = result.assignments.filter((a) => a.employeeId === "marek").length;

    // Deň 1 víťaz (id rozhodne) dostane svoj blok, ale deň 11 sa musí PREKLOPIŤ
    // k druhému — spread musí byť oveľa menší než pôvodných 15 vs. 11 (4 dni).
    expect(Math.abs(janaDays - marekDays)).toBeLessThanOrEqual(2);
  });
});

describe("generateSchedule — Piece 4: ľudsky čitateľné hlásenia o dierach", () => {
  it("hlásenie diery obsahuje meno KAŽDÉHO kandidáta a PRESNE prečo — nie 'Nepodarilo sa vygenerovať rozvrh'", () => {
    const zakazanyPiatok: AvailabilityRuleInput = { ruleType: "blocked_weekdays", params: { days: [5] }, isHard: true, priority: 100 };
    const celyMesiacNedostupny: AvailabilityRuleInput = { ruleType: "date_range_blocked", params: { from: "2026-02-01", to: "2026-02-28" }, isHard: true, priority: 100 };
    const ibaPiatky: CoverageNeed = { ...RANNA, weekdays: [5] };

    const result = generateSchedule(
      baseInput({
        employees: [emp("e1", "Jana", RECEPCIA, { rules: [zakazanyPiatok] }), emp("e2", "Peter", RECEPCIA, { rules: [celyMesiacNedostupny] })],
        coverageNeeds: [ibaPiatky],
      }),
    );

    const gap = result.gaps[0];
    expect(gap.message).not.toBe("Nepodarilo sa vygenerovať rozvrh.");
    expect(gap.message).toContain("chýba obsadenie pozície");
    expect(gap.message).toContain("Jana: Nesmie pracovať v deň 5");
    expect(gap.message).toContain("Peter: Nedostupný v období 2026-02-01–2026-02-28.");
  });
});

/**
 * Q21 — "návrhy pri dierach" musia byť súčasťou REÁLNEHO
 * behu `generateSchedule` (nielen izolovaných funkcií v gap-suggestions.ts) —
 * generátor nič nemení na priradení, len pripojí návrh k správe diery.
 */
describe("generateSchedule — Q21: návrhy pri dierach sú súčasťou Gap.message", () => {
  it("diera z hard porušenia (MIN_REST_DAILY) obsahuje 'najbližší kandidát' návrh s presným kvantifikovaným dôvodom", () => {
    // Marek pracoval do 23:00 v POSLEDNÝ deň predchádzajúceho mesiaca (31.1., mimo tohto behu) —
    // 1. februárová ranná (07:00) by mala len 8h odpočinku (< 11h).
    const marek = emp("e1", "Marek", RECEPCIA, {
      priorMonthTailShifts: [{ date: "2026-01-31", startTime: "15:00:00", endTime: "23:00:00", crossesMidnight: false, breakMinutes: 30 }],
    });
    const legalRules = [{ code: "MIN_REST_DAILY", params: { hours: 11 }, isHard: true }];

    const result = generateSchedule(baseInput({ employees: [marek], coverageNeeds: [RANNA], legalRules, year: 2026, month: 2 }));

    const gap = result.gaps.find((g) => g.date === "2026-02-01");
    expect(gap).toBeDefined();
    expect(gap!.message).toContain("Najbližšie k obsadeniu: Marek");
    expect(gap!.message).toContain("Odpočinok by bol");
  });

  it("diera, kde je jediný kandidát na dovolenke, obsahuje presne JEHO meno vo vetve 'majú neprítomnosť'", () => {
    const jana = emp("e1", "Jana", RECEPCIA);
    const result = generateSchedule(
      baseInput({ employees: [jana], coverageNeeds: [RANNA], absences: [{ employeeId: "e1", date: "2026-02-06" }] }),
    );

    const gap = result.gaps.find((g) => g.date === "2026-02-06");
    expect(gap).toBeDefined();
    expect(gap!.message).toContain("Jana");
    expect(gap!.message).toContain("neprítomnosť");
  });

  it("štrukturálny nedostatok (0 ľudí na pozícii) obsahuje konkrétny odhad chýbajúceho počtu ľudí", () => {
    const result = generateSchedule(baseInput({ employees: [], coverageNeeds: [RANNA] }));
    const gap = result.gaps[0];
    expect(gap.message).toContain("štrukturálna príčina");
    expect(gap.message).toMatch(/chýba približne \d+/);
  });
});

describe("generateSchedule — Blok A2/A4 (§87 ZP): PRESNE ten reálny nález — 10,5h zmena + block_length:5", () => {
  // Presne reálne rozmery (Hotel/Recepcia, dev DB): 07:30–18:30, 30 min
  // prestávka = 10,5h čistého. 4 dni v RADE v tom istom ISO týždni = 42h,
  // čo je > 40h MAX_WEEKLY_HOURS — toto bola PRÍČINA "3-dňové bloky namiesto
  // 5-dňových", nájdená s klientom priamo na reálnom behu cez UI.
  const RECEPCIA_SHIFT: CoverageNeed = { ...RANNA, positionId: RECEPCIA, startTime: "07:30:00", endTime: "18:30:00", breakMinutes: 30 };
  const rules: AvailabilityRuleInput[] = [
    { ruleType: "block_length", params: { days: 5 }, isHard: true, priority: 100 },
    { ruleType: "min_rest_days", params: { days: 2 }, isHard: true, priority: 100 },
  ];
  const legalRules = [
    { code: "MIN_REST_DAILY", params: { hours: 11 }, isHard: true },
    { code: "MAX_WEEKLY_HOURS", params: { hours: 40 }, isHard: true },
  ];

  it("ROVNOMERNY (dnešný default): blok sa REŽE na 3-4 dni — MAX_WEEKLY_HOURS zasiahne uprostred bloku (dokazuje, že nález bol reálny, nie domnienka)", () => {
    const jana = emp("jana", "Jana", RECEPCIA, { rules, workTimeMode: "rovnomerny" });
    const marek = emp("marek", "Marek", RECEPCIA, { rules, workTimeMode: "rovnomerny" });

    const result = generateSchedule(baseInput({ employees: [jana, marek], coverageNeeds: [RECEPCIA_SHIFT], legalRules }));

    const janaDates = result.assignments.filter((a) => a.employeeId === "jana").map((a) => a.date).sort();
    const firstRunLength = janaDates.length > 0 ? consecutiveRunLengths(janaDates)[0] : 0;
    expect(firstRunLength).toBeLessThan(5); // presne ten nahlásený bug
  });

  it("NEROVNOMERNY_TURNUS: MAX_WEEKLY_HOURS vôbec neplatí, blok DOSIAHNE plných 5 dní v rade", () => {
    const jana = emp("jana", "Jana", RECEPCIA, { rules, workTimeMode: "nerovnomerny_turnus" });
    const marek = emp("marek", "Marek", RECEPCIA, { rules, workTimeMode: "nerovnomerny_turnus" });

    const result = generateSchedule(baseInput({ employees: [jana, marek], coverageNeeds: [RECEPCIA_SHIFT], legalRules }));

    expect(result.gaps).toHaveLength(0);
    const janaRuns = consecutiveRunLengths(result.assignments.filter((a) => a.employeeId === "jana").map((a) => a.date));
    const marekRuns = consecutiveRunLengths(result.assignments.filter((a) => a.employeeId === "marek").map((a) => a.date));
    // Bloky musia dosiahnuť plných 5 dní — JEDINÁ prípustná výnimka je POSLEDNÝ
    // blok v mesiaci, ktorý môže byť kratší, lebo mesiac jednoducho SKONČÍ
    // (28. február), nie preto, že by ho niečo (MAX_WEEKLY_HOURS) orezalo.
    expect(janaRuns.slice(0, -1).every((len) => len === 5)).toBe(true);
    expect(marekRuns.slice(0, -1).every((len) => len === 5)).toBe(true);
    expect(janaRuns.at(-1)).toBeLessThanOrEqual(5);
    expect(marekRuns.at(-1)).toBeLessThanOrEqual(5);

    // MIN_REST_DAILY (nezávislé od work_time_mode) musí naďalej platiť pre KAŽDÉ priradenie.
    const employees = [jana, marek];
    for (const assignment of result.assignments) {
      const employee = employees.find((e) => e.id === assignment.employeeId)!;
      const otherShifts = result.assignments
        .filter((a) => a.employeeId === employee.id && a.date !== assignment.date)
        .map((a) => ({ date: a.date, startTime: a.startTime, endTime: a.endTime, crossesMidnight: a.crossesMidnight, breakMinutes: a.breakMinutes }));
      const violations = evaluateRules(
        { id: employee.id, name: employee.name },
        assignment.date,
        { startTime: assignment.startTime, endTime: assignment.endTime, crossesMidnight: assignment.crossesMidnight, breakMinutes: assignment.breakMinutes },
        { rules: employee.rules, legalRules, existingShifts: otherShifts, workTimeMode: employee.workTimeMode },
      );
      expect(violations.filter((v) => v.isHard), `${employee.name} @ ${assignment.date}`).toHaveLength(0);
    }
  });

  function consecutiveRunLengths(sortedOrUnsortedDates: string[]): number[] {
    const dates = [...sortedOrUnsortedDates].sort();
    const runs: number[] = [];
    let run = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(`${dates[i - 1]}T00:00:00`);
      const cur = new Date(`${dates[i]}T00:00:00`);
      if ((cur.getTime() - prev.getTime()) / 86_400_000 === 1) run++;
      else {
        runs.push(run);
        run = 1;
      }
    }
    if (dates.length > 0) runs.push(run);
    return runs;
  }
});

describe("generateSchedule — Blok A (carryOverBlock): rozbehnutý blok sa DOKONČÍ na začiatku nového mesiaca", () => {
  const RECEPCIA_SHIFT: CoverageNeed = { ...RANNA, positionId: RECEPCIA, startTime: "07:30:00", endTime: "18:30:00", breakMinutes: 30 };
  const rules: AvailabilityRuleInput[] = [
    { ruleType: "block_length", params: { days: 5 }, isHard: true, priority: 100 },
    { ruleType: "min_rest_days", params: { days: 2 }, isHard: true, priority: 100 },
  ];
  const legalRules = [{ code: "MIN_REST_DAILY", params: { hours: 11 }, isHard: true }];

  it("Jana mala vo februári 2 posledné dni bloku (27., 28.) → marec jej PRIORITNE dokončí zvyšné 3 (1.-3.), až potom rieši ostatných", () => {
    // Marek NEMÁ žiadny chvost — čerstvý kandidát, konkuruje len o dni OD toho, čo Janin dokončovaný blok nezaberie.
    const jana = emp("jana", "Jana", RECEPCIA, {
      rules,
      priorMonthTailShifts: [
        { date: "2026-02-27", startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 30 },
        { date: "2026-02-28", startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 30 },
      ],
    });
    const marek = emp("marek", "Marek", RECEPCIA, { rules, priorMonthTailShifts: [] });

    const result = generateSchedule(baseInput({ employees: [jana, marek], coverageNeeds: [RECEPCIA_SHIFT], legalRules, year: 2026, month: 3 }));

    expect(result.gaps).toHaveLength(0);
    // 1.-3. marec MUSIA byť Janine (dokončenie bloku, ktorý začal 27.2.) — nie voľná súťaž o skóre.
    const march1to3 = ["2026-03-01", "2026-03-02", "2026-03-03"].map((date) => result.assignments.find((a) => a.date === date)?.employeeId);
    expect(march1to3).toEqual(["jana", "jana", "jana"]);
    // 4. marec je JEJ 6. deň v rade (27.,28.,1.,2.,3. = 5, presne block_length) — blok MUSÍ skončiť, 4.3. patrí niekomu inému.
    const march4 = result.assignments.find((a) => a.date === "2026-03-04")?.employeeId;
    expect(march4).not.toBe("jana");
  });

  it("fairness (hodiny TOHTO mesiaca) NEZAPOČÍTA chvostové dni z predchádzajúceho mesiaca — len skutočné marcové priradenia", () => {
    // Jana dokončuje blok (3 marcové dni), Marek začína čerstvo — bez chvosta by fairness Jane
    // pridala 2×10.5h navyše z februára a nespravodlivo ju znevýhodnila v marcovom skórovaní.
    const jana = emp("jana", "Jana", RECEPCIA, {
      rules,
      priorMonthTailShifts: [
        { date: "2026-02-27", startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 30 },
        { date: "2026-02-28", startTime: "07:30:00", endTime: "18:30:00", crossesMidnight: false, breakMinutes: 30 },
      ],
    });
    const marek = emp("marek", "Marek", RECEPCIA, { rules, priorMonthTailShifts: [] });

    const result = generateSchedule(baseInput({ employees: [jana, marek], coverageNeeds: [RECEPCIA_SHIFT], legalRules, year: 2026, month: 3 }));

    // Marec má 31 dní — po dokončení Janinho bloku (1.-3.) sa rozdelenie ZVYŠKU mesiaca
    // (28 dní, striedavo v 5-dňových blokoch) medzi oboch musí priblížiť rovnováhe,
    // nie systematicky uprednostniť Marka len preto, že Janine "hodiny" boli umelo vyššie.
    const janaDays = result.assignments.filter((a) => a.employeeId === "jana").length;
    const marekDays = result.assignments.filter((a) => a.employeeId === "marek").length;
    // Jana má 3-dňový "náskok" (dokončenie bloku) — spravodlivé rozdelenie preto znamená
    // Marek dostane O NIEČO viac z OSTATKU mesiaca, ale rozdiel ostáva v rozumných medziach.
    expect(Math.abs(janaDays - marekDays)).toBeLessThanOrEqual(5);
  });
});

/**
 * Q10 — férovosť podľa % VLASTNÉHO úväzku, nie surových
 * hodín. Reálny nález z pôvodného skórovania: plný a polovičný úväzok na
 * TEJ ISTEJ pozícii, jediná potreba (1 človek/deň) — polovičný úväzok
 * dostával SYSTEMATICKY viac než mu patrí (surový tímový priemer ho ťahal k
 * rovnakým hodinám ako plný úväzok, nie k rovnakému %).
 */
describe("generateSchedule — Q10: plný vs. polovičný úväzok na tej istej pozícii", () => {
  it("polovičný úväzok dostane ~polovicu hodín plného (rozdelenie podľa % fondu, nie surových hodín)", () => {
    const fullTime = emp("full", "Plný úväzok", RECEPCIA, { contractedMonthlyHours: 173.9 });
    const halfTime = emp("half", "Polovičný úväzok", RECEPCIA, { contractedMonthlyHours: 87.0 });

    const legalRules = [
      { code: "MAX_WEEKLY_HOURS", params: { hours: 40 }, isHard: true },
      { code: "MIN_REST_DAILY", params: { hours: 11 }, isHard: true },
      { code: "MIN_REST_WEEKLY", params: { hours: 35 }, isHard: true },
    ];

    const result = generateSchedule(baseInput({ employees: [fullTime, halfTime], coverageNeeds: [RANNA], legalRules, year: 2026, month: 9 })); // september 2026, 30 dní

    expect(result.gaps).toHaveLength(0);

    const fullDays = result.assignments.filter((a) => a.employeeId === "full").length;
    const halfDays = result.assignments.filter((a) => a.employeeId === "half").length;

    // 2:1 pomer fondov → 2:1 pomer dní (RANNA je 7,5 h čistých/deň pre oboch).
    expect(fullDays).toBeCloseTo(halfDays * 2, 0);

    const fullPct = (fullDays * 7.5) / 173.9;
    const halfPct = (halfDays * 7.5) / 87.0;
    // Oba majú vyjsť na PRIBLIŽNE rovnaké % svojho VLASTNÉHO fondu — to je
    // "fér" per Q10, nie rovnaké surové hodiny.
    expect(Math.abs(fullPct - halfPct)).toBeLessThan(0.02);
  });
});

/**
 * Blok 15 (párovanie zamestnancov, Stage 2b) — "pracuje preferovane s X",
 * NAPRIEČ pozíciami (a — cez `externalPartnerShifts`, Stage 2a — aj
 * prevádzkami). Mäkký pár nikdy neblokuje (žiadny hard rule), len ovplyvní
 * VÝBER medzi inak rovnocennými kandidátmi cez skóre (scoring.ts, váha 100).
 */
describe("generateSchedule — Blok 15 (Stage 2b): mäkké párovanie ovplyvňuje výber, nikdy neblokuje", () => {
  const POS_A = "pos-a";
  const POS_B = "pos-b";
  const needA: CoverageNeed = { ...RANNA, positionId: POS_A };
  const needB: CoverageNeed = { ...RANNA, positionId: POS_B };

  it("naprieč POZÍCIAMI: keď je partner v ten deň už priradený (INÁ pozícia), spárovaný kandidát vyhráva nad inak identickým rovesníkom", () => {
    // A je JEDINÝ kandidát na POS_A → dostane ju vždy, KAŽDÝ deň (procesuje sa
    // v poradí coverageNeeds PRED POS_B, takže runState už "vie" o A, keď sa
    // vyhodnocuje POS_B v TEN ISTÝ deň).
    const a = emp("a", "A (recepcia)", POS_A);
    // C aj D sú KANDIDÁTI na POS_B, úplne identickí (rovnaký fond, žiadne
    // pravidlá, rovnaká história) — JEDINÝ rozdiel je pár C↔A.
    const c = emp("c", "C (wellness, spárovaná s A)", POS_B);
    const d = emp("d", "D (wellness, nespárovaná)", POS_B);

    const result = generateSchedule(
      baseInput({
        employees: [a, c, d],
        coverageNeeds: [needA, needB],
        pairings: [{ employeeAId: "a", employeeBId: "c", isHard: false }],
        year: 2026,
        month: 2, // krátky mesiac (28 dní) — stačí na jasný signál, netreba celý rok
      }),
    );

    expect(result.gaps).toHaveLength(0);

    const posBWinnerByDate = new Map(
      result.assignments.filter((x) => x.employeeId === "c" || x.employeeId === "d").map((x) => [x.date, x.employeeId]),
    );

    // 1. deň — C aj D sú DOKONALE identickí (0 h odpracovaných, žiadna história) —
    // JEDINÝ rozdiel je pár C↔A. C musí vyhrať VÝHRADNE vďaka pairing bonusu.
    expect(posBWinnerByDate.get("2026-02-01")).toBe("c");

    // A pracuje KAŽDÝ deň (jediný kandidát na POS_A) — pairing bonus pre C je
    // teda AKTÍVNY každý deň. Napriek tomu C nezíska trvalú prevahu: hneď po
    // 1. dni (C=7,5h, D=0h) preváži hodinová férovosť (váha 300 ≫ 100) a D
    // vyhrá 2. deň; potom sú opäť vyrovnaní (obaja 7,5h) a pairing bonus
    // rozhodne 3. deň znova v prospech C — tak ĎALEJ, presné striedanie C/D
    // celý mesiac. Toto je SPRÁVANIE, nie bug: dokazuje presne to, čo malo
    // (bonus ovplyvňuje VÝBER na konkrétny deň), bez trvalého narušenia
    // celkovej férovosti (rovnaký počet dní na konci mesiaca).
    expect(posBWinnerByDate.get("2026-02-02")).toBe("d");
    expect(posBWinnerByDate.get("2026-02-03")).toBe("c");
    expect(posBWinnerByDate.get("2026-02-04")).toBe("d");

    const cDays = result.assignments.filter((x) => x.employeeId === "c").length;
    const dDays = result.assignments.filter((x) => x.employeeId === "d").length;
    expect(cDays).toBe(dDays); // presné striedanie za celý (párny, 28-dňový) mesiac → dokonale vyrovnané
  });

  it("mäkký pár NEBLOKUJE: keď A (partner) chýba (absencia), C aj D majú rovnaké šance — žiadna diera kvôli nenaplnenému páru", () => {
    const a = emp("a", "A (recepcia)", POS_A);
    const c = emp("c", "C (wellness, spárovaná s A)", POS_B);
    const d = emp("d", "D (wellness, nespárovaná)", POS_B);

    const result = generateSchedule(
      baseInput({
        employees: [a, c, d],
        coverageNeeds: [needA, needB],
        pairings: [{ employeeAId: "a", employeeBId: "c", isHard: false }],
        // A je CELÝ mesiac na dovolenke → nikdy nemá zmenu → C nikdy nedostane bonus.
        absences: Array.from({ length: 28 }, (_, i) => ({ employeeId: "a", date: `2026-02-${String(i + 1).padStart(2, "0")}` })),
        year: 2026,
        month: 2,
      }),
    );

    // KĽÚČOVÉ: žiadna diera na POS_B kvôli nenaplnenému páru — mäkké
    // párovanie NIKDY neblokuje, len by (keby vyšlo) zvýhodnilo výber.
    expect(result.gaps.filter((g) => g.positionId === POS_B)).toHaveLength(0);
    expect(result.assignments.filter((x) => x.employeeId === "c" || x.employeeId === "d")).toHaveLength(28);

    // Bez partnerovho priradenia (nikdy nepracuje) sú C a D fakticky
    // rovnocenní — rozdiel v priradených dňoch má byť MALÝ (striedanie kvôli
    // bežnej hodinovej férovosti), nie systematický v prospech C.
    const cDays = result.assignments.filter((x) => x.employeeId === "c").length;
    const dDays = result.assignments.filter((x) => x.employeeId === "d").length;
    expect(Math.abs(cDays - dDays)).toBeLessThanOrEqual(2);
  });

  it("naprieč PREVÁDZKAMI: partner MIMO input.employees (iná prevádzka, cez externalPartnerShifts) dáva bonus rovnako ako partner v tejto prevádzke", () => {
    // "Zuzana" (partner) je zamestnankyňa INEJ prevádzky — nie je v `employees`
    // vôbec, len jej UŽ ULOŽENÁ zmena príde cez externalPartnerShifts
    // (presne to, čo db-loader.ts pre tento prípad naplní, Stage 2a).
    const c = emp("c", "C (spárovaná so Zuzanou z inej prevádzky)", POS_B);
    const d = emp("d", "D (nespárovaná)", POS_B);

    const result = generateSchedule(
      baseInput({
        employees: [c, d], // Zuzana TU ZÁMERNE NIE JE
        coverageNeeds: [needB],
        pairings: [{ employeeAId: "c", employeeBId: "zuzana", isHard: false }],
        externalPartnerShifts: [{ employeeId: "zuzana", date: "2026-02-01" }],
        year: 2026,
        month: 2,
      }),
    );

    const day1Winner = result.assignments.find((x) => x.date === "2026-02-01");
    expect(day1Winner?.employeeId).toBe("c");
  });

  it("DÔLEŽITÉ ZISTENIE (testom overené, nie bug): tvrdé párovanie s KONKURENČNÝM kandidátom robí AJ inak nespochybniteľnú pozíciu podmienenou", () => {
    // A je jediný kandidát na POS_A — BEZ páru by pracovala VŠETKÝCH 28 dní
    // bez výnimky. C a D súperia o POS_B (identickí, žiadny bonus/pravidlo).
    // A je TVRDO spárovaná s C. Keďže C NEVYHRÁVA každý deň (prehráva s D
    // presne polovicu mesiaca, rovnaká alternácia ako pri mäkkých pároch v
    // Stage 2b), tvrdý pár A↔C znamená, že AJ A odteraz nepracuje presne tie
    // dni, čo C prehrala — hoci A samotná NEMÁ žiadnu vlastnú absenciu ani
    // inú prekážku. Toto NIE JE bug — je to doslovne to, čo zadanie žiada
    // ("ak jedna nemôže, druhá tiež nedostane zmenu") — pár nerozlišuje MEDZI
    // "partner má absenciu" a "partner prehral súťaž o inú zmenu", oboje
    // rovnako znamená "partner v ten deň nepracuje". Praktický dôsledok pre
    // ownera: tvrdé párovanie niekoho STABILNÉHO (jediný kandidát) s niekým
    // KONKURENČNÝM prenesie nestabilitu aj na predtým stabilnú pozíciu.
    const a = emp("a", "A (recepcia)", POS_A);
    const c = emp("c", "C (wellness, TVRDO spárovaná s A)", POS_B);
    const d = emp("d", "D (wellness, nespárovaná)", POS_B);

    const result = generateSchedule(
      baseInput({
        employees: [a, c, d],
        coverageNeeds: [needA, needB],
        pairings: [{ employeeAId: "a", employeeBId: "c", isHard: true }], // HARD, nie soft
        year: 2026,
        month: 2,
      }),
    );

    // A pracuje PRESNE tie isté dni ako C — nikdy inak (dôkaz, že sa pár
    // reálne vynucuje aj bez priamej absencie, cez prehratú súťaž partnera).
    const aDates = result.assignments.filter((x) => x.employeeId === "a").map((x) => x.date).sort();
    const cDates = result.assignments.filter((x) => x.employeeId === "c").map((x) => x.date).sort();
    expect(aDates).toEqual(cDates);

    // Presne polovica mesiaca (D vyhráva zvyšok) — nie systematický bonus pre C,
    // len dôsledná zhoda s A na dňoch, čo C skutočne vyhrala.
    expect(aDates).toHaveLength(14);
    expect(result.assignments.filter((x) => x.employeeId === "d")).toHaveLength(14);

    // Diery na POS_A presne za dni, čo C prehrala — so správou pomenúvajúcou partnera C.
    const posAGaps = result.gaps.filter((g) => g.positionId === POS_A);
    expect(posAGaps).toHaveLength(14);
    expect(posAGaps.every((g) => g.message.includes("C"))).toBe(true);
  });
});

/**
 * Blok 15 (Stage 3): TVRDÉ párovanie — "obaja alebo nikto". Toto je
 * najrizikovejšia časť (zásah do jadra generátora) — testy sa preto
 * sústredia PRESNE na scenáre, ktoré si používateľ vyžiadal na overenie:
 * vzájomné blokovanie (dovolenka jedného z páru), viacnásobné tvrdé páry
 * (reťaz), a zrozumiteľné hlásenie diery. Každý test má explicitný časový
 * limit (vitest default) — SKUTOČNÁ nekonečná slučka by test spoľahlivo
 * zhodila timeoutom, nie len "nesprávnym" výsledkom.
 */
describe("generateSchedule — Blok 15 (Stage 3): tvrdé párovanie blokuje vzájomne, nikdy sa nezacyklí", () => {
  const POS_A = "pos-a";
  const POS_B = "pos-b";
  const needA: CoverageNeed = { ...RANNA, positionId: POS_A };
  const needB: CoverageNeed = { ...RANNA, positionId: POS_B };

  it("KRITICKÝ scenár: partner na dovolenke CELÝ TÝŽDEŇ → druhý z tvrdého páru nedostane zmeny PRESNE tie dni, ostatné dni normálne pracuje", () => {
    // A aj B sú JEDINÍ kandidáti na svoje pozície — bez páru by obaja
    // pracovali VŠETKY dni mesiaca bez výnimky.
    const a = emp("a", "A", POS_A);
    const b = emp("b", "B", POS_B);
    const vacationWeek = ["2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13", "2026-02-14", "2026-02-15"];

    const result = generateSchedule(
      baseInput({
        employees: [a, b],
        coverageNeeds: [needA, needB],
        pairings: [{ employeeAId: "a", employeeBId: "b", isHard: true }],
        absences: vacationWeek.map((date) => ({ employeeId: "b", date })),
        year: 2026,
        month: 2, // 28 dní
      }),
    );

    // A NESMIE mať zmenu ANI JEDEN deň z B-inej dovolenkovej týždňa.
    const aDatesInVacationWeek = result.assignments.filter((x) => x.employeeId === "a" && vacationWeek.includes(x.date));
    expect(aDatesInVacationWeek).toHaveLength(0);

    // Mimo toho týždňa A pracuje NORMÁLNE — NIE je to reťazová reakcia,
    // ktorá by vyprázdnila celý mesiac (kľúčová obava zo zadania).
    const aDatesOutsideVacationWeek = result.assignments.filter((x) => x.employeeId === "a" && !vacationWeek.includes(x.date));
    expect(aDatesOutsideVacationWeek).toHaveLength(28 - vacationWeek.length); // 21 dní

    // Diery na POS_A presne za dovolenkový týždeň (7), so ZROZUMITEĽNOU
    // správou obsahujúcou meno partnera B — nie ticho vynechané.
    const posAGaps = result.gaps.filter((g) => g.positionId === POS_A);
    expect(posAGaps).toHaveLength(7);
    for (const gap of posAGaps) {
      expect(gap.message).toContain("B");
      expect(gap.message.toLowerCase()).toMatch(/nepracuje|neprítomnosť/);
    }
    // Aspoň jedna diera musí explicitne pomenovať PARTNERA v candidatesRejected (nie len v texte).
    expect(posAGaps.every((g) => g.candidatesRejected.some((c) => c.blockedBy === "HARD_PAIR"))).toBe(true);
  });

  it("reťaz TVRDÝCH párov (A↔B↔C↔D↔E) sa SPRÁVNE prepadne celá, keď je A absentný — a nezacyklí sa (test doľahne, nie timeout)", () => {
    // 5 samostatných pozícií, 5 jediných kandidátov, reťaz párov: A-B, B-C, C-D, D-E.
    // A a C NIE SÚ priamo spárovaní — ich vzájomné blokovanie MUSÍ prejsť cez B.
    const positions = ["pa", "pb", "pc", "pd", "pe"];
    const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map((id, i) => emp(id, id.toUpperCase(), positions[i]));
    const needs: CoverageNeed[] = positions.map((p) => ({ ...RANNA, positionId: p }));

    const absentDate = "2026-02-10";

    const start = Date.now();
    const result = generateSchedule(
      baseInput({
        employees: [a, b, c, d, e],
        coverageNeeds: needs,
        pairings: [
          { employeeAId: "a", employeeBId: "b", isHard: true },
          { employeeAId: "b", employeeBId: "c", isHard: true },
          { employeeAId: "c", employeeBId: "d", isHard: true },
          { employeeAId: "d", employeeBId: "e", isHard: true },
        ],
        absences: [{ employeeId: "a", date: absentDate }],
        year: 2026,
        month: 2,
      }),
    );
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(5000); // žiadna nekonečná/kvadraticky explodujúca slučka

    // V DEŇ absencie A: NIKTO z reťaze (B, C, D, E) nesmie mať zmenu —
    // cez B→C→D→E sa to musí reťazovo prepadnúť, aj keď C/D/E nie sú s A priamo spárovaní.
    for (const id of ["a", "b", "c", "d", "e"]) {
      expect(result.assignments.some((x) => x.employeeId === id && x.date === absentDate)).toBe(false);
    }

    // INÝ deň (bez absencie) — CELÁ reťaz pracuje normálne, žiadna reťazová škoda mimo toho jedného dňa.
    const otherDate = "2026-02-11";
    for (const id of ["a", "b", "c", "d", "e"]) {
      expect(result.assignments.some((x) => x.employeeId === id && x.date === otherDate)).toBe(true);
    }
  });

  it("HVIEZDICOVÁ topológia (A tvrdo spárovaná S B AJ S C): strata JEDNÉHO partnera reťazovo zablokuje CELÚ hviezdicu, nie len A — dôležité pre ownera pri návrhu párov, nezacyklí sa", () => {
    // A je tvrdo spárovaná s B AJ s C (B a C spolu NIE SÚ priamo spárovaní).
    const a = emp("a", "A", POS_A);
    const b = emp("b", "B", "pos-b2");
    const c = emp("c", "C", "pos-c2");
    const needB2: CoverageNeed = { ...RANNA, positionId: "pos-b2" };
    const needC2: CoverageNeed = { ...RANNA, positionId: "pos-c2" };

    const start = Date.now();
    const result = generateSchedule(
      baseInput({
        employees: [a, b, c],
        coverageNeeds: [needA, needB2, needC2],
        pairings: [
          { employeeAId: "a", employeeBId: "b", isHard: true },
          { employeeAId: "a", employeeBId: "c", isHard: true },
        ],
        absences: [{ employeeId: "c", date: "2026-02-12" }],
        year: 2026,
        month: 2,
      }),
    );
    expect(Date.now() - start).toBeLessThan(5000);

    // C má 12.2. absenciu → A (priamo spárovaná s C) je 12.2. zablokovaná.
    expect(result.assignments.some((x) => x.employeeId === "a" && x.date === "2026-02-12")).toBe(false);

    // DÔLEŽITÉ ZISTENIE: B NEMÁ ŽIADNU vlastnú prekážku a s C nie je vôbec
    // spárovaná — napriek tomu je 12.2. TAKISTO zablokovaná, lebo JEJ vlastný
    // tvrdý partner (A) 12.2. nepracuje. Post-hoc vynútenie (`enforceHardPairings`)
    // toto zachytí v druhom kole (živá kontrola v selectCandidate by to sama
    // osebe nemusela vidieť, keďže B nemá "absenciu" v bežnom zmysle) — presne
    // to je dôvod, prečo Stage 3a beží AJ ako dodatočná kontrola po zložení
    // celého mesiaca, nie len ako živý filter. V HVIEZDICOVEJ topológii teda
    // strata JEDNÉHO človeka blokuje VŠETKÝCH — owner musí toto zvážiť pri
    // návrhu párov (nie bug, dôsledok "obaja alebo nikto" aplikovaného na
    // KAŽDÚ hranu nezávisle).
    expect(result.assignments.some((x) => x.employeeId === "b" && x.date === "2026-02-12")).toBe(false);
    const posB2Gap = result.gaps.find((g) => g.positionId === "pos-b2" && g.date === "2026-02-12");
    expect(posB2Gap?.message).toContain("A");

    // Iný deň, keď sú B aj C k dispozícii — CELÁ hviezdica pracuje normálne.
    expect(result.assignments.some((x) => x.employeeId === "a" && x.date === "2026-02-13")).toBe(true);
    expect(result.assignments.some((x) => x.employeeId === "b" && x.date === "2026-02-13")).toBe(true);
    expect(result.assignments.some((x) => x.employeeId === "c" && x.date === "2026-02-13")).toBe(true);
  });

  it("tvrdý pár NEBLOKUJE zbytočne: keď partner NIKDY nie je absentný, obaja pracujú KAŽDÝ deň bez jedinej diery", () => {
    const a = emp("a", "A", POS_A);
    const b = emp("b", "B", POS_B);

    const result = generateSchedule(
      baseInput({
        employees: [a, b],
        coverageNeeds: [needA, needB],
        pairings: [{ employeeAId: "a", employeeBId: "b", isHard: true }],
        year: 2026,
        month: 2,
      }),
    );

    expect(result.gaps).toHaveLength(0);
    expect(result.assignments.filter((x) => x.employeeId === "a")).toHaveLength(28);
    expect(result.assignments.filter((x) => x.employeeId === "b")).toHaveLength(28);
  });

  it("BEZPEČNOSTNÁ POISTKA (RLS): partner úplne NEOVERITEĽNÝ (chýba aj v employees, aj v externalPartnerNames) sa NIKDY nevyhodnotí ako 'nepracuje' — hard pár sa preň jednoducho nevynúti", () => {
    // Zodpovedá reálnemu scenáru: manažér obmedzený na jednu prevádzku spustí
    // generovanie, partner je z prevádzky, ktorú nespravuje → RLS mu jeho
    // employees/absences/scheduled_shifts riadky vôbec nevráti (db-loader.ts
    // by v tom prípade `externalPartnerNames` pre tohto partnera nenaplnil).
    // Bez tejto poistky by "neviditeľný" vyzeral ako "nikdy nepracuje" a
    // KAŽDÝ deň by sa krivo zrušil — presne to táto poistka zakazuje.
    const a = emp("a", "A", POS_A);

    const result = generateSchedule(
      baseInput({
        employees: [a],
        coverageNeeds: [needA],
        pairings: [{ employeeAId: "a", employeeBId: "neznamy-partner", isHard: true }],
        // ZÁMERNE chýba externalPartnerNames aj externalPartnerShifts pre "neznamy-partner".
        year: 2026,
        month: 2,
      }),
    );

    // A pracuje NORMÁLNE celý mesiac — neoveriteľný partner sa nikdy nevynúti.
    expect(result.gaps).toHaveLength(0);
    expect(result.assignments.filter((x) => x.employeeId === "a")).toHaveLength(28);
  });
});

/**
 * Blok 15 (Stage 3 redizajn) — `reconcileHardPairingsForDay` beží DENNE, nie
 * mesačne. Tieto testy overujú PRESNE to, čo si používateľ vyžiadal PRED
 * schválením redizajnu: ukončenie na hviezdicovej topológii aj reťazi V
 * RÁMCI JEDNÉHO DŇA (nie cez absenciu, ktorú by chytila už živá kontrola —
 * cez STRATU súťaže o zmenu, čo je presne prípad, ktorý živá kontrola
 * nevie zachytiť a ktorý pôvodne spôsoboval reálny bug).
 */
describe("generateSchedule — Blok 15 (Stage 3 redizajn): reconcileHardPairingsForDay — ukončenie a kaskády V JEDNOM DNI", () => {
  it("HVIEZDICA v jednom dni: X spárovaná s Y AJ so Z, Y prehrá súťaž (zamknutá zmena kolegyne) → X aj Z sa zrušia REŤAZOVO v ten istý deň, rýchlo", () => {
    const x = emp("x", "X", "pos-x");
    const y = emp("y", "Y", "pos-y");
    const yCompetitor = emp("y2", "Y2 (zamknutá, vyhráva)", "pos-y");
    const z = emp("z", "Z", "pos-z");

    const needX: CoverageNeed = { ...RANNA, positionId: "pos-x" };
    const needY: CoverageNeed = { ...RANNA, positionId: "pos-y" };
    const needZ: CoverageNeed = { ...RANNA, positionId: "pos-z" };

    const start = Date.now();
    const result = generateSchedule(
      baseInput({
        employees: [x, y, yCompetitor, z],
        coverageNeeds: [needX, needY, needZ],
        pairings: [
          { employeeAId: "x", employeeBId: "y", isHard: true },
          { employeeAId: "x", employeeBId: "z", isHard: true },
        ],
        // Y2 má na 2026-02-10 ZAMKNUTÚ zmenu na tej istej pozícii ako Y —
        // potreba (minPeople 1) je tak POKRYTÁ ešte pred greedy slučkou,
        // Y sa v ten deň o zmenu ani neuchádza (nie absencia, iný mechanizmus).
        lockedShifts: [lockedShift("y2", "2026-02-10", "pos-y")],
        year: 2026,
        month: 2,
      }),
    );
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(5000); // žiadna nekonečná/exponenciálne rastúca slučka

    // 10.2.: Y nepracuje (Y2 pokryla jej zamknutou zmenou — zamknuté zmeny sa
    // do result.assignments NEZAPISUJÚ, sú "source: generated" only, preto
    // sa neoverujú tu priamo), preto X sa MUSÍ zrušiť (X↔Y), a REŤAZOVO aj Z
    // (X↔Z) — hoci Z so súťažou o Y nemá NIČ spoločné.
    expect(result.assignments.some((a) => a.employeeId === "x" && a.date === "2026-02-10")).toBe(false);
    expect(result.assignments.some((a) => a.employeeId === "z" && a.date === "2026-02-10")).toBe(false);
    // Pozícia Y je aj tak POKRYTÁ (zamknutou zmenou Y2) — žiadna diera na pos-y.
    expect(result.gaps.some((g) => g.date === "2026-02-10" && g.positionId === "pos-y")).toBe(false);

    // Iný deň (žiadna zamknutá kolízia) — CELÁ hviezdica pracuje normálne.
    expect(result.assignments.some((a) => a.employeeId === "x" && a.date === "2026-02-11")).toBe(true);
    expect(result.assignments.some((a) => a.employeeId === "y" && a.date === "2026-02-11")).toBe(true);
    expect(result.assignments.some((a) => a.employeeId === "z" && a.date === "2026-02-11")).toBe(true);

    // Diera na 10.2. musí zrozumiteľne pomenovať partnera, nie len tiché zmiznutie.
    const day10XGap = result.gaps.find((g) => g.date === "2026-02-10" && g.positionId === "pos-x");
    expect(day10XGap?.message).toContain("Y");
  });

  it("REŤAZ v jednom dni (A↔B, B↔C, A a C NIE SÚ priamo spárovaní): strata A sa prepadne cez B až po C, v ten istý deň, rýchlo", () => {
    const a = emp("a", "A", "pos-a2");
    const aCompetitor = emp("a2", "A2 (zamknutá, vyhráva)", "pos-a2");
    const b = emp("b", "B", "pos-b2");
    const c = emp("c", "C", "pos-c2");

    const needA2: CoverageNeed = { ...RANNA, positionId: "pos-a2" };
    const needB2: CoverageNeed = { ...RANNA, positionId: "pos-b2" };
    const needC2: CoverageNeed = { ...RANNA, positionId: "pos-c2" };

    const start = Date.now();
    const result = generateSchedule(
      baseInput({
        employees: [a, aCompetitor, b, c],
        coverageNeeds: [needA2, needB2, needC2],
        pairings: [
          { employeeAId: "a", employeeBId: "b", isHard: true },
          { employeeAId: "b", employeeBId: "c", isHard: true },
        ],
        lockedShifts: [lockedShift("a2", "2026-02-10", "pos-a2")],
        year: 2026,
        month: 2,
      }),
    );
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(5000);

    // 10.2.: A nepracuje (A2 pokryla zamknutou zmenou) → B sa zruší (A↔B) →
    // REŤAZOVO aj C (B↔C), hoci C s A nemá ŽIADNU priamu väzbu.
    expect(result.assignments.some((x) => x.employeeId === "a" && x.date === "2026-02-10")).toBe(false);
    expect(result.assignments.some((x) => x.employeeId === "b" && x.date === "2026-02-10")).toBe(false);
    expect(result.assignments.some((x) => x.employeeId === "c" && x.date === "2026-02-10")).toBe(false);
    expect(result.gaps.some((g) => g.date === "2026-02-10" && g.positionId === "pos-a2")).toBe(false);

    // Iný deň — celá reťaz pracuje normálne.
    expect(result.assignments.some((x) => x.employeeId === "a" && x.date === "2026-02-11")).toBe(true);
    expect(result.assignments.some((x) => x.employeeId === "b" && x.date === "2026-02-11")).toBe(true);
    expect(result.assignments.some((x) => x.employeeId === "c" && x.date === "2026-02-11")).toBe(true);
  });
});

/**
 * Blok 15 (Stage 3 redizajn) — OKRAJOVÝ PRÍPAD, ktorý denná kontrola
 * (`reconcileHardPairingsForDay`) ŠTRUKTURÁLNE nemôže zachytiť: týždenný
 * odpočinok (`enforceMinRestWeekly`) sa dá vyhodnotiť AŽ PO zložení celého
 * týždňa — beží teda AŽ NA KONCI MESIACA, po tom, čo denná kontrola už
 * dávno doviedla celý mesiac do súladu. Keď `enforceMinRestWeekly`
 * DODATOČNE zruší deň jednému z páru (z dôvodu, čo s párovaním nemá nič
 * spoločné), musí to ZASTARANÝ `enforceHardPairings` (teraz už len
 * bezpečnostná poistka, beží hneď po `enforceMinRestWeekly`) odchytiť a
 * opraviť aj na strane partnera — inak by pár zostal nekonzistentný.
 *
 * Skutočný scenár nižšie (nájdený EMPIRICKY, nie navrhnutý naslepo): A má
 * dlhú neprerušenú históriu z predchádzajúceho mesiaca (chvost), B nemá
 * žiadnu — to spôsobí, že `enforceMinRestWeekly` zruší A jej 1. FEBRUÁRA
 * (týždeň 1 porušuje LEN pre A, vďaka chvostu), ale B jej 8. FEBRUÁRA
 * (týždeň 2 porušuje LEN pre B — cyklus sa zopakuje v OPAČNOM smere, keďže
 * zrušenie A 1.2. nečakane "vylepšilo" jej vlastný výpočet pre týždeň 2).
 * Výsledok: DVE nezávislé, opačne smerované poruchy páru v tom istom behu —
 * ideálny reálny test bezpečnostnej poistky v OBOCH smeroch naraz.
 */
describe("generateSchedule — Blok 15: OKRAJOVÝ PRÍPAD — enforceMinRestWeekly dodatočne pokazí OK pár, starý enforceHardPairings ho musí opraviť", () => {
  const POS_A = "pos-a-mrw";
  const POS_B = "pos-b-mrw";
  const needA: CoverageNeed = { ...RANNA, positionId: POS_A };
  const needB: CoverageNeed = { ...RANNA, positionId: POS_B };
  const MIN_REST_WEEKLY_35H = { code: "MIN_REST_WEEKLY", params: { hours: 35 }, isHard: true };

  function tailDay(date: string): AssignedShift {
    return { date, startTime: "07:00:00", endTime: "15:00:00", crossesMidnight: false, breakMinutes: 30 };
  }

  it("MIN_REST_WEEKLY zruší A 1.2. (týždeň 1) a B 8.2. (týždeň 2) nezávisle — obe strany sa musia zosúladiť naspäť, v OBOCH smeroch", () => {
    // A pracuje neprerušene od 20.1. (chvost) → žiadna "veľká medzera pred
    // prvou zmenou vôbec" ju v týždni 1 (26.1.-1.2.) neochráni — len krátke
    // ~16h denné medzery, čo porušuje 35h. B nemá chvost → jej prvá zmena
    // (1.2.) jej dá obrovskú ochrannú medzeru na CELÝ týždeň 1.
    const tailDates = ["2026-01-20", "2026-01-21", "2026-01-22", "2026-01-23", "2026-01-24", "2026-01-25", "2026-01-26", "2026-01-27", "2026-01-28", "2026-01-29", "2026-01-30", "2026-01-31"];
    const a = emp("a", "A", POS_A, { priorMonthTailShifts: tailDates.map(tailDay) });
    const b = emp("b", "B", POS_B);

    const result = generateSchedule(
      baseInput({
        employees: [a, b],
        coverageNeeds: [needA, needB],
        legalRules: [MIN_REST_WEEKLY_35H],
        pairings: [{ employeeAId: "a", employeeBId: "b", isHard: true }],
        year: 2026,
        month: 2,
      }),
    );

    // KĽÚČOVÉ: na 1.2. AJ na 8.2. musia byť OBAJA zosúladení — buď obaja
    // pracujú, alebo ani jeden. Žiadny "osamelý" deň pre jedného z páru.
    const aWorks01 = result.assignments.some((x) => x.employeeId === "a" && x.date === "2026-02-01");
    const bWorks01 = result.assignments.some((x) => x.employeeId === "b" && x.date === "2026-02-01");
    expect(aWorks01).toBe(bWorks01);
    expect(aWorks01).toBe(false); // MIN_REST_WEEKLY skutočne zasiahol 1.2. (overené empiricky)

    const aWorks08 = result.assignments.some((x) => x.employeeId === "a" && x.date === "2026-02-08");
    const bWorks08 = result.assignments.some((x) => x.employeeId === "b" && x.date === "2026-02-08");
    expect(aWorks08).toBe(bWorks08);
    expect(bWorks08).toBe(false); // MIN_REST_WEEKLY skutočne zasiahol 8.2. (overené empiricky)

    // Musí existovať ASPOŇ JEDNA diera, čo pochádza PRIAMO z pôvodného
    // (mesačného) enforceHardPairings, NIE z novej dennej kontroly — over
    // podľa textu správy (denná kontrola pridáva "(denná kontrola)").
    const pairGaps = result.gaps.filter((g) => g.candidatesRejected.some((c) => c.blockedBy === "HARD_PAIR"));
    expect(pairGaps.length).toBeGreaterThan(0);
    const monthEndPairGaps = pairGaps.filter((g) => !g.message.includes("denná kontrola"));
    expect(monthEndPairGaps.length).toBeGreaterThan(0); // dôkaz, že STARÝ mechanizmus skutočne zasiahol, nie nová denná kontrola

    // A aj B musia mať zrozumiteľné hlásenie, prečo prišli o deň partnera.
    const b01Gap = result.gaps.find((g) => g.date === "2026-02-01" && g.positionId === POS_B);
    expect(b01Gap?.message).toContain("A");
    const a08Gap = result.gaps.find((g) => g.date === "2026-02-08" && g.positionId === POS_A);
    expect(a08Gap?.message).toContain("B");
  });
});
