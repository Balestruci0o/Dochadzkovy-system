import { describe, expect, it } from "vitest";
import type { Assignment, GenerateEmployee, GenerateInput } from "./generate";
import { assignShiftLeaders } from "./shift-leader";

/**
 * Vedúci smeny, krok 2 — `assignShiftLeaders` je čistá funkcia (žiadne DB),
 * beží NAD hotovým výsledkom generátora. Kľúčové invarianty tohto kroku
 * (generátor nerobí násilie, plus explicitná požiadavka): vedúci je VŽDY jeden z
 * `assignments` (nikdy nový človek), a "nikto oprávnený" je SOFT diera
 * (gap), nie pád/výnimka.
 */

function employee(overrides: Partial<GenerateEmployee> & { id: string }): GenerateEmployee {
  return {
    name: overrides.id,
    positionId: null,
    rules: [],
    contractedMonthlyHours: null,
    preferredShiftTemplateId: null,
    workTimeMode: "rovnomerny",
    priorMonthTailShifts: [],
    canBeShiftLeader: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<GenerateInput>): GenerateInput {
  return {
    workplaceId: "wp-1",
    year: 2026,
    month: 8,
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

function assignment(overrides: Partial<Assignment> & { employeeId: string; date: string }): Assignment {
  return {
    shiftTemplateId: "tpl-1",
    startTime: "09:00:00",
    endTime: "17:00:00",
    crossesMidnight: false,
    breakMinutes: 30,
    source: "generated",
    candidatesConsidered: [],
    ...overrides,
  };
}

describe("assignShiftLeaders — žiadna pozícia nevyžaduje vedúceho", () => {
  it("bez positionsRequiringShiftLeader vráti prázdny výsledok, nič nespadne", () => {
    const input = baseInput({ employees: [employee({ id: "e1", positionId: "p1", canBeShiftLeader: true })] });
    const result = assignShiftLeaders(input, [assignment({ employeeId: "e1", date: "2026-08-01" })]);
    expect(result.decisions).toEqual([]);
    expect(result.gaps).toEqual([]);
  });
});

describe("assignShiftLeaders — vedúci je VŽDY jeden z už priradených (nikdy nový človek), nemení počet ľudí na smene", () => {
  it("jeden oprávnený priradený → stane sa vedúcim, žiadna zmena v assignments", () => {
    const input = baseInput({
      employees: [
        employee({ id: "e1", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "e2", positionId: "p1", canBeShiftLeader: false }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    const assignments = [
      assignment({ employeeId: "e1", date: "2026-08-01" }),
      assignment({ employeeId: "e2", date: "2026-08-01" }),
    ];
    const result = assignShiftLeaders(input, assignments);

    expect(result.gaps).toEqual([]);
    expect(result.decisions).toEqual([{ positionId: "p1", date: "2026-08-01", employeeId: "e1" }]);
    // Vedúci je e1 — JEDEN z tých dvoch priradených, nie tretí človek navyše.
    expect(assignments.map((a) => a.employeeId)).toEqual(["e1", "e2"]);
  });

  it("viacero oprávnených v jeden deň → krok 2 vyberie deterministicky (najnižšie employeeId)", () => {
    const input = baseInput({
      employees: [
        employee({ id: "e-zebra", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "e-alpha", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    const assignments = [
      assignment({ employeeId: "e-zebra", date: "2026-08-01" }),
      assignment({ employeeId: "e-alpha", date: "2026-08-01" }),
    ];
    const result = assignShiftLeaders(input, assignments);
    expect(result.decisions).toEqual([{ positionId: "p1", date: "2026-08-01", employeeId: "e-alpha" }]);
  });

  it("iná pozícia (nevyžaduje vedúceho) sa vôbec nerieši, aj keď má priradených ľudí", () => {
    const input = baseInput({
      employees: [employee({ id: "e1", positionId: "p-other", canBeShiftLeader: true })],
      positionsRequiringShiftLeader: ["p1"], // p-other nie je v zozname
    });
    const result = assignShiftLeaders(input, [assignment({ employeeId: "e1", date: "2026-08-01" })]);
    expect(result.decisions).toEqual([]);
    expect(result.gaps).toEqual([]);
  });
});

describe("assignShiftLeaders — nikto oprávnený nepracuje → SOFT diera, nie pád", () => {
  it("priradení ľudia existujú, ale ŽIADEN nemá can_be_shift_leader → gap, žiadne decisions, nespadne", () => {
    const input = baseInput({
      employees: [
        employee({ id: "e1", positionId: "p1", canBeShiftLeader: false }),
        employee({ id: "e2", positionId: "p1", canBeShiftLeader: false }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    const assignments = [
      assignment({ employeeId: "e1", date: "2026-08-01" }),
      assignment({ employeeId: "e2", date: "2026-08-01" }),
    ];

    expect(() => assignShiftLeaders(input, assignments)).not.toThrow();
    const result = assignShiftLeaders(input, assignments);

    expect(result.decisions).toEqual([]);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ positionId: "p1", date: "2026-08-01" });
    expect(result.gaps[0].message).toMatch(/nikto z priradených/i);
    // Zoznam priradených ľudí ostáva NEZMENENÝ — diera vedúceho neodstráni pokrytie.
    expect(assignments).toHaveLength(2);
  });

  it("na tú istú pozíciu v ten istý deň NIKTO vôbec nepracuje (žiadna diera pokrytia dotknutá vedúcim) → žiadny gap vedúceho (to rieši existujúci coverage gap, nie tento krok)", () => {
    const input = baseInput({
      employees: [employee({ id: "e1", positionId: "p1", canBeShiftLeader: true })],
      positionsRequiringShiftLeader: ["p1"],
    });
    // e1 pracuje na INEJ pozícii, nie p1 — p1 nemá žiadne assignments.
    const assignments = [assignment({ employeeId: "e1", date: "2026-08-01" })];
    const inputWithDifferentPosition = { ...input, employees: [employee({ id: "e1", positionId: "p-other", canBeShiftLeader: true })] };

    const result = assignShiftLeaders(inputWithDifferentPosition, assignments);
    expect(result.gaps).toEqual([]);
    expect(result.decisions).toEqual([]);
  });
});

describe("assignShiftLeaders — KROK 3: turnus/prekryv (kontinuita bloku, seniorita pri prekryve)", () => {
  it("kontinuita — jeden turnusový blok (1.-7.), ŽIADEN prekryv → vedúci je ROVNAKÝ celý blok, nemení sa deň po dni", () => {
    const input = baseInput({
      employees: [employee({ id: "jana", positionId: "p1", canBeShiftLeader: true })],
      positionsRequiringShiftLeader: ["p1"],
    });
    const assignments = Array.from({ length: 7 }, (_, i) => assignment({ employeeId: "jana", date: `2026-08-0${i + 1}` }));
    const result = assignShiftLeaders(input, assignments);

    expect(result.decisions).toHaveLength(7);
    expect(result.decisions.every((d) => d.employeeId === "jana")).toBe(true);
  });

  it("presne scenár zo zadania — Jana (1.-7.) a Eva (4.-10.), OBAJA oprávnení: Jana vedie CELÝ svoj blok vrátane prekryvu 4.-7. (začala skôr), Eva prevezme AŽ 8., keď Janin blok skončí", () => {
    const input = baseInput({
      employees: [
        employee({ id: "jana", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "eva", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    const janaDates = ["01", "02", "03", "04", "05", "06", "07"].map((d) => `2026-08-${d}`);
    const evaDates = ["04", "05", "06", "07", "08", "09", "10"].map((d) => `2026-08-${d}`);
    const assignments = [
      ...janaDates.map((date) => assignment({ employeeId: "jana", date })),
      ...evaDates.map((date) => assignment({ employeeId: "eva", date })),
    ];

    const result = assignShiftLeaders(input, assignments);
    const leaderByDate = new Map(result.decisions.map((d) => [d.date, d.employeeId]));

    // Jana vedie 1.-7. (vrátane prekryvu 4.-7., aj keď je tam prítomná aj Eva).
    for (const date of janaDates) expect(leaderByDate.get(date)).toBe("jana");
    // Eva vedie AŽ 8.-10. (po tom, čo Janin blok skončil).
    for (const date of ["2026-08-08", "2026-08-09", "2026-08-10"]) expect(leaderByDate.get(date)).toBe("eva");
    expect(result.gaps).toEqual([]);
  });

  it("blok rozbehnutý KONCOM PREDCHÁDZAJÚCEHO mesiaca (priorMonthTailShifts) má seniority prednosť pred blokom, čo v TOMTO mesiaci vyzerá, že začal 'ako prvý' (1. deň)", () => {
    const input = baseInput({
      employees: [
        // Jana v skutočnosti pracuje neprerušene od 30. júla (chvost minulého mesiaca) — v auguste to VYZERÁ ako "od 1.", ale jej skutočný blockStart je júlový.
        employee({ id: "jana", positionId: "p1", canBeShiftLeader: true, priorMonthTailShifts: [
          { date: "2026-07-30", startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 30 },
          { date: "2026-07-31", startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 30 },
        ] }),
        // Eva začína SKUTOČNE od 1. augusta (žiadny chvost) — bez tohto testu by oba vyzerali "rovnako staré".
        employee({ id: "eva", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    const assignments = [
      assignment({ employeeId: "jana", date: "2026-08-01" }),
      assignment({ employeeId: "eva", date: "2026-08-01" }),
    ];
    const result = assignShiftLeaders(input, assignments);
    expect(result.decisions).toEqual([{ positionId: "p1", date: "2026-08-01", employeeId: "jana" }]);
  });

  it("prerušený blok (deň voľna UPROSTRED) sa počíta ako DVA bloky — po prerušení sa seniority prepočíta odznova", () => {
    const input = baseInput({
      employees: [
        employee({ id: "jana", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "eva", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    // Jana: 1.-3., VOĽNO 4., 5.-6. (druhý, NOVÝ blok). Eva: neprerušene 2.-6.
    const assignments = [
      assignment({ employeeId: "jana", date: "2026-08-01" }),
      assignment({ employeeId: "jana", date: "2026-08-02" }),
      assignment({ employeeId: "jana", date: "2026-08-03" }),
      assignment({ employeeId: "jana", date: "2026-08-05" }),
      assignment({ employeeId: "jana", date: "2026-08-06" }),
      assignment({ employeeId: "eva", date: "2026-08-02" }),
      assignment({ employeeId: "eva", date: "2026-08-03" }),
      assignment({ employeeId: "eva", date: "2026-08-05" }),
      assignment({ employeeId: "eva", date: "2026-08-06" }),
    ];
    const result = assignShiftLeaders(input, assignments);
    const leaderByDate = new Map(result.decisions.map((d) => [d.date, d.employeeId]));

    expect(leaderByDate.get("2026-08-01")).toBe("jana"); // len Jana pracuje
    expect(leaderByDate.get("2026-08-02")).toBe("jana"); // Janin (prvý) blok začal 1., Evin až 2. — Jana senior
    expect(leaderByDate.get("2026-08-03")).toBe("jana");
    // 5.-6.: Janin NOVÝ blok začal 5. (po voľne 4.), Evin NEPRETRŽITÝ blok začal 2. — teraz Eva senior.
    expect(leaderByDate.get("2026-08-05")).toBe("eva");
    expect(leaderByDate.get("2026-08-06")).toBe("eva");
  });
});

describe("assignShiftLeaders — KROK 4: férovosť na BLOK (nie na deň), rozhoduje LEN pri remíze seniority", () => {
  it("7-dňový turnusový blok = JEDEN bod, nie 7 — nespôsobí neprimeranú nevýhodu voči niekomu, kto viedol len 1-dňový blok", () => {
    const input = baseInput({
      employees: [
        employee({ id: "c1", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "c2", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    const assignments = [
      // Kolo 1 (1.-7.): OBAJA prítomní 1. (remíza, oba fresh) → c1 vyhrá (nižšie ID), vedie CELÝCH 7 dní = JEDEN blok.
      ...["01", "02", "03", "04", "05", "06", "07"].map((d) => assignment({ employeeId: "c1", date: `2026-08-${d}` })),
      assignment({ employeeId: "c2", date: "2026-08-01" }), // c2 prítomný LEN 1. — prehrá remízu, nevedie ani deň
      // Medzera 08.-09.
      // Kolo 2 (10.): LEN c2 pracuje — jediný kandidát, žiadna remíza, 1-dňový blok.
      assignment({ employeeId: "c2", date: "2026-08-10" }),
      // Medzera 11.
      // Kolo 3 (12.): OBAJA znova prítomní, OBAJA fresh (blockStart=12.) → remíza → rozhoduje férovosť.
      assignment({ employeeId: "c1", date: "2026-08-12" }),
      assignment({ employeeId: "c2", date: "2026-08-12" }),
    ];
    const result = assignShiftLeaders(input, assignments);
    const leaderByDate = new Map(result.decisions.map((d) => [d.date, d.employeeId]));

    expect(leaderByDate.get("2026-08-01")).toBe("c1");
    for (const d of ["02", "03", "04", "05", "06", "07"]) expect(leaderByDate.get(`2026-08-${d}`)).toBe("c1"); // kontinuita — CELÝ 7-dňový blok
    expect(leaderByDate.get("2026-08-10")).toBe("c2");
    // KĽÚČOVÉ: v kole 3 majú OBAJA presne 1 odvedený blok (c1 zo 7 dní, c2 z 1 dňa) →
    // OPÄŤ remíza → rozhodne employeeId → c1. Keby sa 7-dňový blok počítal ako 7
    // bodov namiesto 1, c2 (1 bod < 7) by tu vyhral namiesto c1.
    expect(leaderByDate.get("2026-08-12")).toBe("c1");
  });

  it("viac oprávnených ľudí, čo OPAKOVANE začínajú NOVÝ blok v ten istý deň (remíza seniority) → vedúcovstvo sa za mesiac rozdelí ROVNOMERNE, nie že jeden vedie stále", () => {
    const input = baseInput({
      employees: [
        employee({ id: "e1", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "e2", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "e3", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    // 5 kôl, každé 2 dni, VŠETCI TRAJA prítomní naraz, s 1-dňovou medzerou
    // medzi kolami (prerušuje kontinuitu KAŽDÉMU — každé kolo je preto
    // NOVÁ remíza všetkých troch, nikdy sa nedá vyhrať "len tým, že už vediem").
    const roundStarts = [1, 4, 7, 10, 13];
    const assignments = roundStarts.flatMap((start) =>
      ["e1", "e2", "e3"].flatMap((id) => [
        assignment({ employeeId: id, date: `2026-08-${String(start).padStart(2, "0")}` }),
        assignment({ employeeId: id, date: `2026-08-${String(start + 1).padStart(2, "0")}` }),
      ]),
    );

    const result = assignShiftLeaders(input, assignments);
    const blocksLed = new Map<string, number>();
    for (let i = 0; i < result.decisions.length; i++) {
      const d = result.decisions[i];
      const prev = result.decisions[i - 1];
      // Nový blok = zmena vedúceho oproti predošlému rozhodnutiu (alebo úplne prvé rozhodnutie).
      if (!prev || prev.employeeId !== d.employeeId) blocksLed.set(d.employeeId, (blocksLed.get(d.employeeId) ?? 0) + 1);
    }

    expect(result.gaps).toEqual([]);
    expect([...blocksLed.values()].reduce((a, b) => a + b, 0)).toBe(5); // presne 5 kôl = 5 blokov spolu
    // ROVNOMERNE — nikto nesmie dominovať (5 kôl medzi 3 ľuďmi: max rozdiel medzi najviac a najmenej vedúcim je 1).
    const counts = ["e1", "e2", "e3"].map((id) => blocksLed.get(id) ?? 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.every((c) => c >= 1)).toBe(true); // KAŽDÝ z troch aspoň raz viedol — nie 5-0-0
  });
});

describe("assignShiftLeaders — viacero dní/pozícií naraz, bez krížovej kontaminácie", () => {
  it("dve pozície, viacero dní, rôzne osudy — každá kombinácia (deň, pozícia) sa rieši nezávisle", () => {
    const input = baseInput({
      employees: [
        employee({ id: "e1", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "e2", positionId: "p2", canBeShiftLeader: false }),
        employee({ id: "e3", positionId: "p2", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1", "p2"],
    });
    const assignments = [
      assignment({ employeeId: "e1", date: "2026-08-01" }),
      assignment({ employeeId: "e1", date: "2026-08-02" }),
      assignment({ employeeId: "e2", date: "2026-08-01" }),
      assignment({ employeeId: "e3", date: "2026-08-01" }),
    ];
    const result = assignShiftLeaders(input, assignments);

    expect(result.decisions).toHaveLength(3); // p1/08-01, p1/08-02, p2/08-01
    expect(result.decisions).toContainEqual({ positionId: "p1", date: "2026-08-01", employeeId: "e1" });
    expect(result.decisions).toContainEqual({ positionId: "p1", date: "2026-08-02", employeeId: "e1" });
    expect(result.decisions).toContainEqual({ positionId: "p2", date: "2026-08-01", employeeId: "e3" }); // e2 nie je oprávnená, e3 áno
    expect(result.gaps).toEqual([]);
  });
});

describe("assignShiftLeaders — KROK 6: regenerácia rešpektuje existujúce RUČNÉ (source='manual') dni ako 'pravdu o dni', nikdy do nich nezapisuje", () => {
  it("manuálny deň sa NIKDY neobjaví v decisions (writer by ho aj tak zahodil) — algoritmus preň jednoducho nič negeneruje", () => {
    const input = baseInput({
      employees: [employee({ id: "jana", positionId: "p1", canBeShiftLeader: true })],
      positionsRequiringShiftLeader: ["p1"],
    });
    const assignments = [assignment({ employeeId: "jana", date: "2026-08-05" })];
    const existingManualLeaders = [{ positionId: "p1", date: "2026-08-05", employeeId: "jana" }];

    const result = assignShiftLeaders(input, assignments, existingManualLeaders);
    expect(result.decisions).toEqual([]); // deň JE obsadený (jana pracuje aj vedie), ale MANUÁLNE — algoritmus doň nezasahuje
    expect(result.gaps).toEqual([]);
  });

  it("kontinuita CEZ manuálny deň — vedúci ručne prepísaný na iného (Petra) 5. deň, Peter pokračuje AJ 6.-7. (generované), hoci pôvodne viedla Jana", () => {
    const input = baseInput({
      employees: [
        employee({ id: "jana", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "peter", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    // Jana aj Peter pracujú NEPRETRŽITE 1.-7. — bez zásahu by seniorita (Jana, blockStart 1.) vyhrala každý deň.
    const dates = ["01", "02", "03", "04", "05", "06", "07"].map((d) => `2026-08-${d}`);
    const assignments = [
      ...dates.map((date) => assignment({ employeeId: "jana", date })),
      ...dates.map((date) => assignment({ employeeId: "peter", date })),
    ];
    // Manažér RUČNE prepísal 5. deň na Petra (napr. mal ten deň skúsenosť navyše).
    const existingManualLeaders = [{ positionId: "p1", date: "2026-08-05", employeeId: "peter" }];

    const result = assignShiftLeaders(input, assignments, existingManualLeaders);
    const leaderByDate = new Map(result.decisions.map((d) => [d.date, d.employeeId]));

    // 1.-4.: pred manuálnym dňom, Jana (seniorita) vedie normálne.
    for (const d of ["01", "02", "03", "04"]) expect(leaderByDate.get(`2026-08-${d}`)).toBe("jana");
    // 5.: manuálny, NIE JE v decisions vôbec.
    expect(leaderByDate.has("2026-08-05")).toBe(false);
    // 6.-7.: KĽÚČOVÉ — pokračuje Peter (prevzatý z manuálneho dňa), NIE Jana, hoci Janina seniorita by inak vyhrala.
    expect(leaderByDate.get("2026-08-06")).toBe("peter");
    expect(leaderByDate.get("2026-08-07")).toBe("peter");
  });

  it("manuálne nastavené 'žiadny vedúci' PRERUŠÍ kontinuitu — nasledujúci deň sa rieši ako nová voľba (seniorita/férovosť), nie automatické pokračovanie predošlého vedúceho", () => {
    const input = baseInput({
      employees: [
        employee({ id: "jana", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "peter", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    const dates = ["01", "02", "03", "04", "05"].map((d) => `2026-08-${d}`);
    const assignments = [
      ...dates.map((date) => assignment({ employeeId: "jana", date })),
      // Peter sa pridáva AŽ od 4. (jeho blok je mladší než Janin) — bez prerušenia by Jana vyhrala aj 4.-5.
      assignment({ employeeId: "peter", date: "2026-08-04" }),
      assignment({ employeeId: "peter", date: "2026-08-05" }),
    ];
    const existingManualLeaders = [{ positionId: "p1", date: "2026-08-03", employeeId: null }]; // vedome "žiadny vedúci"

    const result = assignShiftLeaders(input, assignments, existingManualLeaders);
    const leaderByDate = new Map(result.decisions.map((d) => [d.date, d.employeeId]));

    expect(leaderByDate.get("2026-08-01")).toBe("jana");
    expect(leaderByDate.get("2026-08-02")).toBe("jana");
    expect(leaderByDate.has("2026-08-03")).toBe(false); // manuálne "žiadny vedúci" — nie v decisions
    // 4.: Janina kontinuita PRERUŠENÁ manuálnym dňom 3. — nová voľba. Jej blockStartDate (skutočná práca) je STÁLE 1. (nepretržite pracuje),
    // Petrov je 4. — Jana teda AJ TAK vyhrá senioritou (prerušenie kontinuity nemení, KTO je senior, len že sa musí prehodnotiť).
    expect(leaderByDate.get("2026-08-04")).toBe("jana");
    expect(leaderByDate.get("2026-08-05")).toBe("jana");
  });

  it("manuálny blok sa počíta do férovosti presne ako vygenerovaný — jeden manuálny 7-dňový blok = JEDEN bod, ovplyvní budúcu remízu", () => {
    const input = baseInput({
      employees: [
        employee({ id: "c1", positionId: "p1", canBeShiftLeader: true }),
        employee({ id: "c2", positionId: "p1", canBeShiftLeader: true }),
      ],
      positionsRequiringShiftLeader: ["p1"],
    });
    // c1 pracuje 1.-7. (manuálne vedie CELÝCH 7 dní — 7 samostatných manuálnych riadkov, jeden neprerušený blok).
    // c2 sa objaví AŽ 10. (fresh, žiadna predošlá práca) — 10. je ich JEDINÁ spoločná remíza (oba blockStart=10.).
    const c1Dates = ["01", "02", "03", "04", "05", "06", "07"].map((d) => `2026-08-${d}`);
    const assignments = [...c1Dates.map((date) => assignment({ employeeId: "c1", date })), assignment({ employeeId: "c1", date: "2026-08-10" }), assignment({ employeeId: "c2", date: "2026-08-10" })];
    const existingManualLeaders = c1Dates.map((date) => ({ positionId: "p1", date, employeeId: "c1" }));

    const result = assignShiftLeaders(input, assignments, existingManualLeaders);
    const leaderByDate = new Map(result.decisions.map((d) => [d.date, d.employeeId]));

    // KĽÚČOVÉ — 10.: remíza (obaja blockStart=10., keďže c1 mal medzeru 8.-9.) → c1 má 1 bod (NIE 7, aj keď manuálne viedol 7 dní) vs c2 0 bodov → c2 vyhrá.
    expect(leaderByDate.get("2026-08-10")).toBe("c2");
  });
});
