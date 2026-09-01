import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schedules } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";

/**
 * `scheduled_shifts.schedule_id` je NOT NULL — pred prvým manuálnym zápisom
 * do mesiaca/prevádzky musí existovať `schedules` riadok (inak generuje
 * Blok 9, tu ho len založíme so statusom 'draft', ak ešte nie je). Upsert
 * cez no-op UPDATE (re-zapíše rovnaký `year`), aby RETURNING vždy vrátilo
 * riadok — `.onConflictDoNothing()` by pri existujúcom riadku nič nevrátil.
 */
export async function getOrCreateSchedule(
  tx: PostgresJsDatabase<typeof schema>,
  workplaceId: string,
  year: number,
  month: number,
) {
  const [row] = await tx
    .insert(schedules)
    .values({ workplaceId, year, month })
    .onConflictDoUpdate({
      target: [schedules.workplaceId, schedules.year, schedules.month],
      set: { year },
    })
    .returning();
  return row;
}

export async function findSchedule(
  tx: PostgresJsDatabase<typeof schema>,
  workplaceId: string,
  year: number,
  month: number,
) {
  const [row] = await tx
    .select()
    .from(schedules)
    .where(and(eq(schedules.workplaceId, workplaceId), eq(schedules.year, year), eq(schedules.month, month)));
  return row ?? null;
}
