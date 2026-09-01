import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { attendanceDays } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { recomputeAttendanceDay } from "./attendance";

export type Tx = PostgresJsDatabase<typeof schema>;

/**
 * adminDb (service role) nikdy nenastavuje app.user_id — bez tohto by
 * audit_log (audit_attendance, audit_punch_events_insert) zapísal
 * changed_by=NULL aj pre manažérom vyvolanú zmenu. Len na AUDIT, nie na RLS
 * (tá sa na tomto pripojení aj tak nevyhodnocuje).
 */
export async function setAuditActor(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
}

/**
 * Spoločný záver KAŽDEJ manuálnej zmeny dochádzky — korekcia existujúceho
 * pípnutia AJ pridanie ÚPLNE CHÝBAJÚCEHO ("chýba mi pípnutie", terminál
 * nešiel). Znova spočíta `attendance_days` (`recomputeAttendanceDay` je
 * upsert — VYTVORÍ riadok, ak pre tento deň ešte žiaden neexistoval) a
 * poznačí naň kto/kedy/prečo. MUSÍ bežať AŽ PO vložení všetkých
 * `punch_events` udalostí danej akcie.
 *
 * Vyhľadáva deň AŽ PO recompute podľa employeeId+workplaceId+date (nie podľa
 * vopred znameho ID) — pri "chýba mi pípnutie" mohol `attendance_days`
 * riadok vzniknúť PRÁVE TERAZ, takže žiadne ID vopred nemáme.
 *
 * Notifikáciu zámerne NEPOSIELA — každý volajúci pozná svoj vlastný kontext
 * (manažér opravil BEZ žiadosti vs. schválil KONKRÉTNU žiadosť zamestnanca)
 * a text sa má líšiť, viď `notifyPunchCorrectedByManager` vs.
 * `notifyMissingPunchResolved`/`notifyPunchCorrectionResolved`.
 */
export async function finalizeAttendanceCorrection(
  tx: Tx,
  target: { employeeId: string; workplaceId: string; date: string },
  actorUserId: string,
  reason: string,
): Promise<void> {
  await recomputeAttendanceDay(tx, target.employeeId, target.workplaceId, target.date);

  const [day] = await tx
    .select({ id: attendanceDays.id })
    .from(attendanceDays)
    .where(
      and(
        eq(attendanceDays.employeeId, target.employeeId),
        eq(attendanceDays.workplaceId, target.workplaceId),
        eq(attendanceDays.date, target.date),
      ),
    );
  // Defenzívne — recomputeAttendanceDay je upsert, riadok by tu VŽDY mal byť.
  if (!day) return;

  await tx
    .update(attendanceDays)
    .set({ isCorrected: true, correctedBy: actorUserId, correctedAt: new Date(), correctionNote: reason })
    .where(eq(attendanceDays.id, day.id));
}
