import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/zamestnancov/šablónu priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import {
  generationRuns,
  organizations,
  scheduledShifts,
  scheduleViolations,
  shiftTemplates,
  users,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import type { GenerateResult } from "./generate";
import { persistGenerateResult } from "./db-writer";

/**
 * Blok 9d-2/9d-3 (🔍) — `persistGenerateResult` zapisuje `GenerateResult`
 * (Blok 9c, čistá funkcia) do DB. Testuje sa TU priamo so syntetickým
 * `GenerateResult` (nie cez celý `loadGenerateInput` → `generateSchedule`
 * reťazec, ten už overil reálny beh na skutočných dátach) — cieľom je overiť
 * SAMOTNÚ zapisovaciu vrstvu: transakčnosť, `locked` sa nikdy neprepíše (DB
 * úroveň, nezávisle od toho, či by generátor sám kolidujúce priradenie
 * ponúkol), `source='generated'`, diery → `schedule_violations` prepojené
 * cez `generationRunId`, beh → `generation_runs`, a REGENEROVANIE (9d-3):
 * staré vygenerované zmeny zmiznú (aj tie, ktoré nový beh vôbec nespomenie),
 * staré diery sa označia `resolved`, nezmažú sa.
 *
 * Beží pod `withUserContext` (RLS pod identitou owner-a), nie `adminDb` —
 * presne ako reálna cesta.
 */

let orgId: string;
let workplaceId: string;
let ownerId: string;
let shiftTemplateId: string;
let employee1Id: string;
let employee2Id: string;
let employee3Id: string;

const LOCKED_DATE = "2027-03-10";
const GENERATED_DATE = "2027-03-11";
const GENERATED_DATE_2 = "2027-03-13";

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `db-writer test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  const [owner] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `owner-${crypto.randomUUID()}@dbwriter-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerId = owner.id;

  const [template] = await adminDb
    .insert(shiftTemplates)
    .values({ workplaceId, name: "Denná 8h", code: `D8-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00", crossesMidnight: false, breakMinutes: 30 })
    .returning();
  shiftTemplateId = template.id;

  const { employees } = await import("@/lib/db/schema");
  const [emp1] = await adminDb.insert(employees).values({ orgId, firstName: "Prvý", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
  const [emp2] = await adminDb.insert(employees).values({ orgId, firstName: "Druhý", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
  const [emp3] = await adminDb.insert(employees).values({ orgId, firstName: "Tretí", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
  employee1Id = emp1.id;
  employee2Id = emp2.id;
  employee3Id = emp3.id;

  // Vopred ZAMKNUTÁ zmena (manažérova ručná voľba) — persistGenerateResult ju MUSÍ zachovať nedotknutú,
  // aj keby (hypoteticky, chybne) dostala od volajúceho konfliktné priradenie na ten istý deň.
  const { getOrCreateSchedule } = await import("@/app/(app)/kalendar/schedule");
  const schedule = await withUserContext(ownerId, (tx) => getOrCreateSchedule(tx, workplaceId, 2027, 3));
  await adminDb.insert(scheduledShifts).values({
    scheduleId: schedule.id,
    employeeId: employee1Id,
    workplaceId,
    date: LOCKED_DATE,
    startTime: "06:00:00",
    endTime: "14:00:00",
    breakMinutes: 45,
    crossesMidnight: false,
    source: "manual",
    locked: true,
  });
});

afterAll(async () => {
  // deleteOrgCascade nájde a vynuluje generation_runs.triggeredBy
  // (neceskaduje na users) sama, netreba to tu ručne predchádzať.
  await deleteOrgCascade(orgId);
});

describe("persistGenerateResult", () => {
  it("zapíše priradenia ako source='generated', NIKDY neprepíše locked=true (aj keď dostane kolidujúce priradenie), zapíše generation_runs a schedule_violations", async () => {
    const result: GenerateResult = {
      assignments: [
        {
          employeeId: employee2Id,
          date: GENERATED_DATE,
          shiftTemplateId,
          startTime: "07:00:00",
          endTime: "15:00:00",
          crossesMidnight: false,
          breakMinutes: 30,
          source: "generated",
          candidatesConsidered: [],
        },
        {
          // Tento riadok DRUHÝ beh (regenerácia, nižšie) VÔBEC nespomenie —
          // overuje sa ním, že sa naozaj ZMAŽE, nie že len ostane zabudnutý.
          employeeId: employee3Id,
          date: GENERATED_DATE_2,
          shiftTemplateId,
          startTime: "07:00:00",
          endTime: "15:00:00",
          crossesMidnight: false,
          breakMinutes: 30,
          source: "generated",
          candidatesConsidered: [],
        },
        {
          // Zámerne KOLIDUJE s vopred zamknutou zmenou (rovnaký employeeId/workplaceId/date) —
          // simuluje hypotetickú chybu volajúceho, aby sa overila DB úroveň ochrany (setWhere locked=false).
          employeeId: employee1Id,
          date: LOCKED_DATE,
          shiftTemplateId,
          startTime: "07:00:00",
          endTime: "15:00:00",
          crossesMidnight: false,
          breakMinutes: 30,
          source: "generated",
          candidatesConsidered: [],
        },
      ],
      gaps: [
        {
          date: "2027-03-12",
          positionId: null,
          needed: 1,
          assigned: 0,
          message: "12. 3. — chýba obsadenie (potrebná 1, priradených 0).",
          candidatesRejected: [{ employeeId: employee1Id, name: "Prvý Zamestnanec", blockedBy: "MIN_REST_DAILY", detail: "odpočinok by bol 9 h, min. 11 h", shortfall: 2, shortfallUnit: "hours" }],
        },
      ],
    };

    const summary = await withUserContext(ownerId, (tx) => persistGenerateResult(tx, workplaceId, 2027, 3, result, ownerId));

    expect(summary.shiftsDeleted).toBe(0); // prvé generovanie — nič vopred nebolo
    expect(summary.shiftsCreated).toBe(2); // GENERATED_DATE + GENERATED_DATE_2 — LOCKED_DATE bol preskočený
    expect(summary.shiftsSkippedLocked).toBe(1);
    expect(summary.gapsRecorded).toBe(1);

    // 1. Nová zmena je naozaj zapísaná, source='generated'.
    const [generatedRow] = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employee2Id), eq(scheduledShifts.date, GENERATED_DATE)));
    expect(generatedRow).toMatchObject({ source: "generated", locked: false, startTime: "07:00:00", endTime: "15:00:00" });

    // 2. Zamknutý riadok ostáva PRESNE nedotknutý — nie prepísaný na 07:00-15:00/generated.
    const [lockedRow] = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employee1Id), eq(scheduledShifts.date, LOCKED_DATE)));
    expect(lockedRow).toMatchObject({ source: "manual", locked: true, startTime: "06:00:00", endTime: "14:00:00", breakMinutes: 45 });

    // 3. generation_runs zaznamenal beh správne.
    const [run] = await adminDb.select().from(generationRuns).where(eq(generationRuns.id, summary.generationRunId));
    expect(run).toMatchObject({ workplaceId, year: 2027, month: 3, triggeredBy: ownerId, shiftsCreated: 2, status: "success" });
    expect(run.finishedAt).not.toBeNull();

    // 4. schedule_violations je prepojená cez generationRunId, obsahuje presnú hlášku.
    const violations = await adminDb.select().from(scheduleViolations).where(eq(scheduleViolations.generationRunId, summary.generationRunId));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ date: "2027-03-12", ruleCode: "MIN_REST_DAILY", ruleSource: "generator" });
    expect(violations[0].message).toContain("chýba obsadenie");
  });

  it("regenerácia (druhý beh, Blok 9d-3): staré generated zmiznú (aj tá, čo nový beh vôbec nespomenie), zamknutá ostáva nedotknutá, staré diery sa OZNAČIA resolved (nezmažú sa)", async () => {
    // Simuluje regenerovanie: employee2 dostane INÉ časy, employee3 (GENERATED_DATE_2) sa VÔBEC nespomenie.
    const result: GenerateResult = {
      assignments: [
        {
          employeeId: employee2Id,
          date: GENERATED_DATE,
          shiftTemplateId,
          startTime: "09:00:00",
          endTime: "17:00:00",
          crossesMidnight: false,
          breakMinutes: 30,
          source: "generated",
          candidatesConsidered: [],
        },
      ],
      gaps: [],
    };

    const summary = await withUserContext(ownerId, (tx) => persistGenerateResult(tx, workplaceId, 2027, 3, result, ownerId));
    expect(summary.shiftsDeleted).toBe(2); // obe staré generated zmeny z prvého behu (GENERATED_DATE + GENERATED_DATE_2)
    expect(summary.shiftsCreated).toBe(1);
    expect(summary.shiftsSkippedLocked).toBe(0);
    expect(summary.gapsRecorded).toBe(0);

    // 1. employee2 na GENERATED_DATE je AKTUALIZOVANÝ (nová hodnota), nie duplicitný riadok.
    const rows = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employee2Id), eq(scheduledShifts.date, GENERATED_DATE)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startTime: "09:00:00", endTime: "17:00:00" });

    // 2. employee3 na GENERATED_DATE_2 NAOZAJ ZMIZOL — regenerácia nie je "diff", je "prepočítaj odznova okolo locked".
    const goneRow = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employee3Id), eq(scheduledShifts.date, GENERATED_DATE_2)));
    expect(goneRow).toHaveLength(0);

    // 3. Zamknutý riadok ostáva PRESNE nedotknutý naprieč regeneráciou.
    const [lockedRow] = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employee1Id), eq(scheduledShifts.date, LOCKED_DATE)));
    expect(lockedRow).toMatchObject({ source: "manual", locked: true, startTime: "06:00:00", endTime: "14:00:00" });

    // 4. Diera z PRVÉHO behu sa NEZMAZALA — len sa označila resolved=true (audit stopa).
    const allViolations = await adminDb.select().from(scheduleViolations).where(eq(scheduleViolations.scheduleId, rows[0].scheduleId));
    const oldViolation = allViolations.find((v) => v.date === "2027-03-12");
    expect(oldViolation).toBeDefined();
    expect(oldViolation!.resolved).toBe(true);
    expect(oldViolation!.resolvedAt).not.toBeNull();

    // 5. Druhý beh nemal diery — žiadna NOVÁ (resolved=false) violation nevznikla.
    expect(allViolations.filter((v) => !v.resolved)).toHaveLength(0);

    // 6. generation_runs má TERAZ 2 riadky pre tento mesiac — obidva behy zostali, história sa nekolabuje.
    const runs = await adminDb.select().from(generationRuns).where(and(eq(generationRuns.workplaceId, workplaceId), eq(generationRuns.year, 2027), eq(generationRuns.month, 3)));
    expect(runs).toHaveLength(2);
  });

  it("chyba v jednej časti zápisu zruší CELÚ transakciu (celý rozvrh alebo nič) — neostane osamotený generation_runs riadok", async () => {
    // scheduleId z GENERATED result musí patriť k reálnemu schedule — vynútime zlyhanie
    // vložením priradenia s neexistujúcim shiftTemplateId (FK violation) do inak platného behu.
    const bogusShiftTemplateId = "00000000-0000-0000-0000-000000000000";
    const runsBefore = await adminDb.select().from(generationRuns).where(and(eq(generationRuns.workplaceId, workplaceId), eq(generationRuns.year, 2027), eq(generationRuns.month, 3)));

    const result: GenerateResult = {
      assignments: [
        {
          employeeId: employee2Id,
          date: "2027-03-15",
          shiftTemplateId: bogusShiftTemplateId,
          startTime: "07:00:00",
          endTime: "15:00:00",
          crossesMidnight: false,
          breakMinutes: 30,
          source: "generated",
          candidatesConsidered: [],
        },
      ],
      gaps: [],
    };

    await expect(withUserContext(ownerId, (tx) => persistGenerateResult(tx, workplaceId, 2027, 3, result, ownerId))).rejects.toThrow();

    const runsAfterFailure = await adminDb.select().from(generationRuns).where(and(eq(generationRuns.workplaceId, workplaceId), eq(generationRuns.year, 2027), eq(generationRuns.month, 3)));
    // Rovnaký počet ako PRED pokusom — zlyhaný beh nenechal ŽIADNU stopu (celá transakcia sa zahodila).
    expect(runsAfterFailure).toHaveLength(runsBefore.length);

    const failedShift = await adminDb.select().from(scheduledShifts).where(and(eq(scheduledShifts.employeeId, employee2Id), eq(scheduledShifts.date, "2027-03-15")));
    expect(failedShift).toHaveLength(0);
  });
});
