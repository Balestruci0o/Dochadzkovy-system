import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { scheduleViolations, shiftLeaderAssignments } from "@/lib/db/schema";
import { getOrCreateSchedule } from "@/app/(app)/kalendar/schedule";
import type { AssignShiftLeadersResult } from "./shift-leader";

type Db = PostgresJsDatabase<typeof schema>;

export type PersistShiftLeaderResultSummary = {
  leadersAssigned: number;
  leaderGapsRecorded: number;
};

/**
 * Vedúci smeny, krok 2 — zapíše `AssignShiftLeadersResult` (čistá funkcia
 * `assignShiftLeaders`) do DB. VOLAJÚCI ju musí zavolať AŽ PO
 * `persistGenerateResult` v TEJ ISTEJ transakcii (`run-generate.ts`) —
 * `persistGenerateResult` po ceste označí VŠETKY predošlé nevyriešené
 * `schedule_violations` tohto rozvrhu ako `resolved = true` (bez ohľadu na
 * `rule_code`), takže staré `NO_SHIFT_LEADER` riadky sa vyriešia sami, bez
 * duplicitnej logiky tu — táto funkcia už len PRIDÁVA nové.
 *
 * Rovnaký vzor ako `db-writer.ts#persistGenerateResult`: KAŽDÉ volanie
 * najprv zmaže staré `source = 'generated'` rozhodnutia tohto rozvrhu
 * (generuj/regeneruj = rovnaká cesta), `source = 'manual'` (krok 5, ručný
 * prepis) sa nikdy nedotkne — ani DELETE (podmienka `source = 'generated'`),
 * ani INSERT (`onConflictDoUpdate` s `setWhere: source != 'manual'`, presne
 * ako `scheduled_shifts.locked`).
 */
export async function persistShiftLeaderResult(
  tx: Db,
  workplaceId: string,
  year: number,
  month: number,
  result: AssignShiftLeadersResult,
): Promise<PersistShiftLeaderResultSummary> {
  const schedule = await getOrCreateSchedule(tx, workplaceId, year, month);

  await tx
    .delete(shiftLeaderAssignments)
    .where(and(eq(shiftLeaderAssignments.scheduleId, schedule.id), eq(shiftLeaderAssignments.source, "generated")));

  let leadersAssigned = 0;
  if (result.decisions.length > 0) {
    const written = await tx
      .insert(shiftLeaderAssignments)
      .values(
        result.decisions.map((d) => ({
          scheduleId: schedule.id,
          workplaceId,
          positionId: d.positionId,
          date: d.date,
          employeeId: d.employeeId,
          source: "generated" as const,
          decidedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [shiftLeaderAssignments.workplaceId, shiftLeaderAssignments.positionId, shiftLeaderAssignments.date],
        set: {
          scheduleId: schedule.id,
          employeeId: sql`excluded.employee_id`,
          source: "generated",
          decidedAt: sql`excluded.decided_at`,
        },
        // Ručne nastavený vedúci (krok 5) sa NIKDY neprepíše regeneráciou.
        setWhere: sql`${shiftLeaderAssignments.source} != 'manual'`,
      })
      .returning({ id: shiftLeaderAssignments.id });
    leadersAssigned = written.length;
  }

  let leaderGapsRecorded = 0;
  if (result.gaps.length > 0) {
    await tx.insert(scheduleViolations).values(
      result.gaps.map((g) => ({
        scheduleId: schedule.id,
        date: g.date,
        positionId: g.positionId,
        severity: "soft_violation" as const,
        ruleCode: "NO_SHIFT_LEADER",
        ruleSource: "generator",
        message: g.message,
      })),
    );
    leaderGapsRecorded = result.gaps.length;
  }

  return { leadersAssigned, leaderGapsRecorded };
}
