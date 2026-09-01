import { and, eq, gte, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { absences, attendanceDays } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { toDateStr } from "@/lib/shared/dates";
import type { AbsenceKind } from "./monthly-summary";

type Db = PostgresJsDatabase<typeof schema>;

export type DailyRow = {
  date: string;
  isAbsence: boolean;
  absenceKind: AbsenceKind | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  breakMinutes: number;
  workedHours: number;
  overtimeHours: number;
  status: string;
};

/**
 * Blok 12, bod 2 — denná evidencia PRE JEDNÉHO zamestnanca (PDF výkaz —
 * `monthly-summary.ts` agreguje za mesiac, zámerne zahadzuje jednotlivé dni;
 * táto funkcia ich naopak vracia). Samostatná od `buildMonthlySummary`, aby
 * sa nemenil jej existujúci, otestovaný kontrakt (hromadný Excel dennú
 * evidenciu nepotrebuje).
 */
export async function getEmployeeDailyRows(tx: Db, employeeId: string, workplaceId: string, year: number, month: number): Promise<DailyRow[]> {
  const monthStart = toDateStr(year, month, 1);
  const monthEnd = toDateStr(year, month, new Date(year, month, 0).getDate());

  const attendanceRows = await tx
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.workplaceId, workplaceId), gte(attendanceDays.date, monthStart), lte(attendanceDays.date, monthEnd)));

  const absenceRows = await tx
    .select()
    .from(absences)
    .where(and(eq(absences.employeeId, employeeId), eq(absences.isConfirmed, true), gte(absences.date, monthStart), lte(absences.date, monthEnd)));

  const byDate = new Map<string, DailyRow>();
  for (const day of attendanceRows) {
    byDate.set(day.date, {
      date: day.date,
      isAbsence: false,
      absenceKind: null,
      plannedStart: day.plannedStart,
      plannedEnd: day.plannedEnd,
      actualStart: day.actualStart,
      actualEnd: day.actualEnd,
      breakMinutes: day.breakMinutes,
      workedHours: Number(day.workedHours),
      overtimeHours: Number(day.overtimeHours),
      status: day.status,
    });
  }
  // Absencia v deň, kde AJ TAK existuje attendance_days riadok, je nekonzistentný
  // stav, ktorý appka inde nedovolí (kalendár maže jedno pri zápise druhého)
  // — absencia tu preto vyhráva len vtedy, keď attendance_days pre
  // ten deň vôbec neexistuje.
  for (const abs of absenceRows) {
    if (!byDate.has(abs.date)) {
      byDate.set(abs.date, {
        date: abs.date,
        isAbsence: true,
        absenceKind: abs.kind,
        plannedStart: null,
        plannedEnd: null,
        actualStart: null,
        actualEnd: null,
        breakMinutes: 0,
        workedHours: 0,
        overtimeHours: 0,
        status: "absence",
      });
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
