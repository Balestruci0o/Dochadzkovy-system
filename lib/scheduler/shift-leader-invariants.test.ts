import { describe, expect, it } from "vitest";
import type { Assignment, GenerateEmployee, GenerateInput } from "./generate";
import { assignShiftLeaders, type ExistingManualLeader } from "./shift-leader";

/**
 * Vedúci smeny — NEMENNÉ vlastnosti (mirror vzoru `invariants.test.ts` pre
 * jadro generátora), overené v ZLOŽITÝCH, viacpozičných/viacmesačných
 * scenároch naraz — nie mechaniku jedného pravidla (tú už majú svoje testy
 * `shift-leader.test.ts`/`shift-leader-writer.test.ts`/
 * `shift-leader-end-to-end.test.ts`). Cieľ: potvrdiť, že kroky 2–6 spolu
 * NEROZBÍJAJÚ jeden druhého vo väčšom, realistickejšom behu.
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
    year: 2027,
    month: 3, // 31 dní
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

const DAYS_MARCH_2027 = Array.from({ length: 31 }, (_, i) => `2027-03-${String(i + 1).padStart(2, "0")}`);

describe("Vedúci smeny — Nemenné #1: vedúci je VŽDY medzi reálne priradenými, headcount sa nikdy nezmení", () => {
  it("2 pozície, 6 zamestnancov, náhodný denný výber priradených (seedovaný), cez celý mesiac", () => {
    // Deterministický pseudo-náhodný výber (žiadna závislosť na Math.random — reprodukovateľné zlyhanie, ak by nastalo).
    let seed = 42;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    const positions = ["p1", "p2"];
    const employees: GenerateEmployee[] = [];
    for (const p of positions) {
      for (let i = 0; i < 3; i++) {
        employees.push(employee({ id: `${p}-e${i}`, positionId: p, canBeShiftLeader: i !== 2 })); // tretí na každej pozícii nie je oprávnený
      }
    }

    const assignments: Assignment[] = [];
    for (const date of DAYS_MARCH_2027) {
      for (const p of positions) {
        const candidates = employees.filter((e) => e.positionId === p);
        // Každý deň pracujú 2 z 3 (náhodne, ale deterministicky) — simuluje reálne striedanie.
        const shuffled = [...candidates].sort(() => rand() - 0.5);
        for (const c of shuffled.slice(0, 2)) assignments.push(assignment({ employeeId: c.id, date }));
      }
    }

    const input = baseInput({ employees, positionsRequiringShiftLeader: positions });
    const result = assignShiftLeaders(input, assignments);

    expect(result.decisions.length).toBeGreaterThan(0);
    for (const d of result.decisions) {
      const workingThatDay = assignments.filter((a) => a.date === d.date && employees.find((e) => e.id === a.employeeId)?.positionId === d.positionId).map((a) => a.employeeId);
      expect(workingThatDay, `${d.date}/${d.positionId}: vedúci ${d.employeeId} MUSÍ byť medzi ${JSON.stringify(workingThatDay)}`).toContain(d.employeeId);
      expect(workingThatDay.length).toBe(2); // headcount presne taký, ako bol priradený — vedúci nič nezmenil
    }
  });
});

describe("Vedúci smeny — Nemenné #2: NIKDY dvaja vedúci na tú istú (pozícia, deň)", () => {
  it("aj pri viacerých pozíciách/mesiacoch naraz — žiadna duplicita v decisions", () => {
    const positions = ["p1", "p2", "p3"];
    const employees: GenerateEmployee[] = positions.flatMap((p) => [
      employee({ id: `${p}-a`, positionId: p, canBeShiftLeader: true }),
      employee({ id: `${p}-b`, positionId: p, canBeShiftLeader: true }),
    ]);
    const assignments: Assignment[] = [];
    for (const date of DAYS_MARCH_2027) {
      for (const p of positions) {
        assignments.push(assignment({ employeeId: `${p}-a`, date }));
        assignments.push(assignment({ employeeId: `${p}-b`, date }));
      }
    }

    const result = assignShiftLeaders(baseInput({ employees, positionsRequiringShiftLeader: positions }), assignments);

    const seen = new Set<string>();
    for (const d of result.decisions) {
      const key = `${d.positionId}|${d.date}`;
      expect(seen.has(key), `duplicitné rozhodnutie pre ${key}`).toBe(false);
      seen.add(key);
    }
    // Presne jedno rozhodnutie za KAŽDÝ (pozícia, deň), žiadne diery (obaja vždy oprávnení a prítomní).
    expect(result.decisions).toHaveLength(positions.length * DAYS_MARCH_2027.length);
  });
});

describe("Vedúci smeny — Nemenné #3: kontinuita — vedúci sa NEMENÍ deň po dni, kým jeho vlastná práca trvá neprerušene", () => {
  it("jediný nepretržite pracujúci oprávnený vedie CELÝ mesiac bez jediného prerušenia, aj keď sa okolo neho strieda 5 ďalších (neoprávnených aj oprávnených s medzerami)", () => {
    // Chvost z FEBRUÁRA (pred 1.3., mimo tohto behu) dáva "steady" NESPOCHYBNITEĽNÚ senioritu —
    // bez toho by sa mohol náhodou 1.3. remizovať s niekým iným, kto je TIEŽ prítomný od prvého dňa (rovnaký blockStart).
    const steady = employee({
      id: "steady",
      positionId: "p1",
      canBeShiftLeader: true,
      priorMonthTailShifts: [{ date: "2027-02-28", startTime: "09:00:00", endTime: "17:00:00", crossesMidnight: false, breakMinutes: 30 }],
    });
    const others = Array.from({ length: 5 }, (_, i) => employee({ id: `other${i}`, positionId: "p1", canBeShiftLeader: i % 2 === 0 }));
    const employees = [steady, ...others];

    let seed = 7;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    const assignments: Assignment[] = DAYS_MARCH_2027.map((date) => assignment({ employeeId: "steady", date }));
    for (const date of DAYS_MARCH_2027) {
      for (const o of others) {
        if (rand() > 0.4) assignments.push(assignment({ employeeId: o.id, date })); // nepravidelne prítomní
      }
    }

    const result = assignShiftLeaders(baseInput({ employees, positionsRequiringShiftLeader: ["p1"] }), assignments);
    expect(result.decisions.every((d) => d.employeeId === "steady")).toBe(true);
    expect(result.decisions).toHaveLength(DAYS_MARCH_2027.length); // vedúci určený KAŽDÝ deň, bez diery
  });
});

describe("Vedúci smeny — Nemenné #4: férovosť — rozdiel v počte VEDENÝCH BLOKOV medzi oprávnenými ostáva malý aj cez veľa opakovaných remíz", () => {
  it("4 rovnako oprávnení, 10 opakovaných kôl (remíza zakaždým) — rozdiel medzi najviac/najmenej vedúcim ≤ 1", () => {
    const employees = Array.from({ length: 4 }, (_, i) => employee({ id: `e${i}`, positionId: "p1", canBeShiftLeader: true }));
    const assignments: Assignment[] = [];
    // 10 kôl po 2 dni, s 1-dňovou medzerou medzi kolami (núti fresh remízu zakaždým).
    let day = 1;
    for (let round = 0; round < 10; round++) {
      for (const e of employees) {
        assignments.push(assignment({ employeeId: e.id, date: `2027-03-${String(day).padStart(2, "0")}` }));
        assignments.push(assignment({ employeeId: e.id, date: `2027-03-${String(day + 1).padStart(2, "0")}` }));
      }
      day += 3; // 2 dni kolo + 1 deň medzera
      if (day > 29) break; // marec má 31 dní, nech sa zmestíme
    }

    const result = assignShiftLeaders(baseInput({ employees, positionsRequiringShiftLeader: ["p1"] }), assignments);

    const blocksLed = new Map<string, number>();
    let prev: string | null = null;
    for (const d of result.decisions) {
      if (d.employeeId !== prev) blocksLed.set(d.employeeId, (blocksLed.get(d.employeeId) ?? 0) + 1);
      prev = d.employeeId;
    }
    const counts = employees.map((e) => blocksLed.get(e.id) ?? 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.every((c) => c >= 1)).toBe(true); // nikto nedostal 0 kôl (nie 10-0-0-0 dominancia)
  });
});

describe("Vedúci smeny — Nemenné #5: manuálne dni sa NIKDY neobjavia v decisions, bez ohľadu na to, ako komplexný je zvyšok behu", () => {
  it("mix generovaných aj manuálnych dní naprieč 3 pozíciami — ani jedno manuálne dátum+pozícia nie je v decisions", () => {
    const positions = ["p1", "p2", "p3"];
    const employees: GenerateEmployee[] = positions.flatMap((p) => [
      employee({ id: `${p}-a`, positionId: p, canBeShiftLeader: true }),
      employee({ id: `${p}-b`, positionId: p, canBeShiftLeader: true }),
    ]);
    const assignments: Assignment[] = [];
    for (const date of DAYS_MARCH_2027) {
      for (const p of positions) {
        assignments.push(assignment({ employeeId: `${p}-a`, date }));
        assignments.push(assignment({ employeeId: `${p}-b`, date }));
      }
    }
    // Každý 5. deň, na každej pozícii, je manuálne nastavený (striedavo konkrétny človek / "žiadny vedúci").
    const existingManualLeaders: ExistingManualLeader[] = [];
    for (let i = 4; i < DAYS_MARCH_2027.length; i += 5) {
      for (const p of positions) {
        existingManualLeaders.push({ positionId: p, date: DAYS_MARCH_2027[i], employeeId: i % 2 === 0 ? `${p}-a` : null });
      }
    }
    const manualKeys = new Set(existingManualLeaders.map((m) => `${m.date}|${m.positionId}`));

    const result = assignShiftLeaders(baseInput({ employees, positionsRequiringShiftLeader: positions }), assignments, existingManualLeaders);

    for (const d of result.decisions) {
      expect(manualKeys.has(`${d.date}|${d.positionId}`), `manuálny deň ${d.date}/${d.positionId} sa NESMEL objaviť v decisions`).toBe(false);
    }
  });
});

describe("Vedúci smeny — Nemenné #6: 'nikto oprávnený' je VŽDY SOFT diera (gap), nikdy pád/výnimka, aj v zložitom viacpozičnom behu", () => {
  it("3 pozície, jedna úplne bez oprávnených, ostatné normálne — beh dokončí, len tá jedna pozícia má diery každý deň", () => {
    const employees: GenerateEmployee[] = [
      employee({ id: "p1-a", positionId: "p1", canBeShiftLeader: true }),
      employee({ id: "p2-a", positionId: "p2", canBeShiftLeader: true }),
      employee({ id: "p3-a", positionId: "p3", canBeShiftLeader: false }), // JEDINÁ na p3, neoprávnená
      employee({ id: "p3-b", positionId: "p3", canBeShiftLeader: false }),
    ];
    const assignments: Assignment[] = [];
    for (const date of DAYS_MARCH_2027) {
      assignments.push(assignment({ employeeId: "p1-a", date }));
      assignments.push(assignment({ employeeId: "p2-a", date }));
      assignments.push(assignment({ employeeId: "p3-a", date }));
      assignments.push(assignment({ employeeId: "p3-b", date }));
    }

    let result: ReturnType<typeof assignShiftLeaders> | undefined;
    expect(() => {
      result = assignShiftLeaders(baseInput({ employees, positionsRequiringShiftLeader: ["p1", "p2", "p3"] }), assignments);
    }).not.toThrow();

    expect(result!.decisions.every((d) => d.positionId !== "p3")).toBe(true); // p3 nikdy nemá rozhodnutie
    expect(result!.gaps.filter((g) => g.positionId === "p3")).toHaveLength(DAYS_MARCH_2027.length); // presne jedna diera KAŽDÝ deň na p3
    expect(result!.decisions.filter((d) => d.positionId === "p1")).toHaveLength(DAYS_MARCH_2027.length); // p1/p2 bežia normálne, nedotknuté
    expect(result!.decisions.filter((d) => d.positionId === "p2")).toHaveLength(DAYS_MARCH_2027.length);
  });
});
