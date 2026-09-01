import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { generationRuns, schedules, scheduledShifts, scheduleViolations } from "@/lib/db/schema";
import { getOrCreateSchedule } from "@/app/(app)/kalendar/schedule";
import type { GenerateResult } from "./generate";

type Db = PostgresJsDatabase<typeof schema>;

export type PersistGenerateResultSummary = {
  generationRunId: string;
  shiftsDeleted: number;
  shiftsCreated: number;
  shiftsSkippedLocked: number;
  gapsRecorded: number;
};

/**
 * Blok 9d-2/9d-3 (🔍) — zapíše `GenerateResult` (čistá funkcia `generateSchedule`,
 * Blok 9c) späť do DB. VOLAJÚCI musí bežať pod `withUserContext` — táto
 * funkcia sama žiadnu transakciu neotvára, len POUŽÍVA `tx`, ktorý dostane.
 * Celý beh `loadGenerateInput` → `generateSchedule` → `persistGenerateResult`
 * v JEDNEJ `withUserContext` transakcii = "celý rozvrh alebo nič": ak
 * čokoľvek v tejto funkcii zlyhá (chyba, výnimka), Postgres CELÚ transakciu
 * zahodí — vrátane `generation_runs`/`scheduled_shifts`/`schedule_violations`
 * riadkov zapísaných skôr V TEJTO ISTEJ transakcii. Poradie zápisu v kóde
 * (generation_runs najprv, aby sme mali jeho `id` pre `schedule_violations`)
 * na atomickosť nemá vplyv — tú zaručuje transakcia ako celok, nie poradie.
 *
 * `locked = true` sa NIKDY neprepíše — nie preto, že by to `generateSchedule`
 * (čistá funkcia) sľúbila (ona len nikdy NEPONÚKNE kolidujúce priradenie,
 * viď `lockedShifts` seed v `generate.ts`), ale preto, že TU, na zápise, je
 * o to postarané dvoma nezávislými poistkami:
 *   1. DELETE nižšie berie LEN `source = 'generated'` — `source = 'manual'`
 *      (čo `locked = true` vždy je, viď `assignShiftAction`) sa touto
 *      podmienkou nikdy nechytí.
 *   2. `ON CONFLICT ... DO UPDATE ... WHERE locked = false` na INSERTe —
 *      pre prípad, že by niekedy vznikol `locked = true` riadok so
 *      `source = 'generated'` (dnes sa nestáva, ale nespolieha sa na to).
 *
 * REGENEROVANIE — KAŽDÉ volanie tejto funkcie
 * NAJPRV zmaže staré `source = 'generated'` zmeny TOHTO rozvrhu (mesiaca).
 * Prvé generovanie nemá čo zmazať (no-op DELETE) — "generuj" a "regeneruj"
 * sú preto ROVNAKÁ cesta kódu, nie dve vetvy, ktoré sa môžu časom rozísť.
 * Staré `schedule_violations` z predošlého behu sa NEMAŽÚ (audit stopa)
 * — označia sa `resolved = true` (stĺpec už na to
 * existoval, len sa nepoužíval). `generation_runs` sa NIKDY nemaže ani
 * neprepisuje — každý beh (aj regenerovanie) dostane VLASTNÝ nový riadok,
 * takže história "kedy sa tento mesiac generoval, kým, koľkokrát" zostáva
 * celá, presne v duchu princípu 8 (história namiesto kolabovaného stavu).
 *
 * ZVEREJNENIE (nezverejniť automaticky) — KAŽDÉ generovanie (tlačidlo AJ
 * cron) VŽDY nastaví `schedules.status = 'draft'`, BEZ OHĽADU na to, v akom
 * stave bol predtým. `getOrCreateSchedule` sama status nemení (jej
 * `onConflictDoUpdate` prepisuje len `year`) — bez tohto explicitného
 * kroku by regenerácia UŽ ZVEREJNENÉHO mesiaca nový (možno výrazne odlišný)
 * obsah potichu poslala rovno naživo, bez kontroly manažérom. Zamestnanci
 * odteraz čítajú `published_shifts` (samostatná snímka, `publishScheduleAction`
 * v `kalendar/actions.ts`) — tá sa TU vôbec nedotýka, takže regenerácia
 * nezmení, čo zamestnanec práve vidí, kým manažér znova nezverejní.
 */
export async function persistGenerateResult(
  tx: Db,
  workplaceId: string,
  year: number,
  month: number,
  result: GenerateResult,
  // `null` = cron (Blok 9d-5) — nemá prihláseného používateľa, presne ako
  // `runAutoClose()`. `generation_runs.triggered_by`/`scheduled_shifts.created_by`
  // sú v schema.sql nullable práve pre tento prípad.
  triggeredByUserId: string | null,
): Promise<PersistGenerateResultSummary> {
  const schedule = await getOrCreateSchedule(tx, workplaceId, year, month);

  // Nikdy sa nezverejní automaticky — každé (re)generovanie vracia na draft,
  // aj keď bol mesiac už zverejnený predtým (viď funkčný komentár vyššie).
  await tx.update(schedules).set({ status: "draft" }).where(eq(schedules.id, schedule.id));

  const deletedRows = await tx
    .delete(scheduledShifts)
    .where(and(eq(scheduledShifts.scheduleId, schedule.id), eq(scheduledShifts.source, "generated")))
    .returning({ id: scheduledShifts.id });
  const shiftsDeleted = deletedRows.length;

  await tx
    .update(scheduleViolations)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(and(eq(scheduleViolations.scheduleId, schedule.id), eq(scheduleViolations.resolved, false)));

  let shiftsCreated = 0;
  if (result.assignments.length > 0) {
    const written = await tx
      .insert(scheduledShifts)
      .values(
        result.assignments.map((a) => ({
          scheduleId: schedule.id,
          employeeId: a.employeeId,
          workplaceId,
          date: a.date,
          shiftTemplateId: a.shiftTemplateId,
          startTime: a.startTime,
          endTime: a.endTime,
          breakMinutes: a.breakMinutes,
          crossesMidnight: a.crossesMidnight,
          source: "generated" as const,
          locked: false,
          createdBy: triggeredByUserId,
        })),
      )
      .onConflictDoUpdate({
        target: [scheduledShifts.employeeId, scheduledShifts.workplaceId, scheduledShifts.date],
        set: {
          scheduleId: schedule.id,
          shiftTemplateId: sql`excluded.shift_template_id`,
          startTime: sql`excluded.start_time`,
          endTime: sql`excluded.end_time`,
          breakMinutes: sql`excluded.break_minutes`,
          crossesMidnight: sql`excluded.crosses_midnight`,
          source: "generated",
          createdBy: triggeredByUserId,
        },
        // KĽÚČOVÝ riadok: existujúci riadok sa prepíše LEN ak nie je zamknutý.
        // Ak JE zamknutý, INSERT aj UPDATE sa pre TENTO riadok potichu
        // preskočí (Postgres ON CONFLICT ... WHERE) — RETURNING ho preto
        // vôbec nevráti, čo použijeme na spočítanie preskočených nižšie.
        setWhere: sql`${scheduledShifts.locked} = false`,
      })
      .returning({ id: scheduledShifts.id });
    shiftsCreated = written.length;
  }
  const shiftsSkippedLocked = result.assignments.length - shiftsCreated;

  const [run] = await tx
    .insert(generationRuns)
    .values({
      workplaceId,
      year,
      month,
      triggeredBy: triggeredByUserId,
      finishedAt: new Date(),
      shiftsCreated,
      status: "success",
      inputSnapshot: { assignments: result.assignments.length, gaps: result.gaps.length, shiftsSkippedLocked, shiftsDeleted },
    })
    .returning();

  let gapsRecorded = 0;
  if (result.gaps.length > 0) {
    await tx.insert(scheduleViolations).values(
      result.gaps.map((g) => ({
        scheduleId: schedule.id,
        generationRunId: run.id,
        date: g.date,
        positionId: g.positionId,
        severity: "gap" as const,
        ruleCode: g.candidatesRejected[0]?.blockedBy ?? "NO_CANDIDATE",
        ruleSource: "generator",
        message: g.message,
        details: { needed: g.needed, assigned: g.assigned, candidatesRejected: g.candidatesRejected },
      })),
    );
    gapsRecorded = result.gaps.length;
  }

  return { generationRunId: run.id, shiftsDeleted, shiftsCreated, shiftsSkippedLocked, gapsRecorded };
}
