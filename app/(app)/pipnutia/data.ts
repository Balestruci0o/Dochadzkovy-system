import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import {
  attendanceDays,
  employeePositionHistory,
  employees,
  employeeWorkplaces,
  positions,
  punchEvents,
  workplaces,
} from "@/lib/db/schema";
import { liveWorkedHours } from "@/lib/punch/live-worked-hours";
import { resolveBreakTrackingMode } from "@/lib/scheduler/break-tracking-mode";
import { localDateStr } from "@/lib/shared/time";

export type PunchOverviewRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  breakMinutes: number;
  workedHours: number;
  status: string;
  isLate: boolean;
  lateMinutes: number;
  isCorrected: boolean;
  /** Môže manažér opravovať prestávku PÍPNUTÍM (nie len príchod/odchod)? Závisí od pozície/prepisu zamestnanca. */
  canCorrectBreak: boolean;
  /**
   * Zamestnanec je PRÁVE TERAZ na prestávke (posledné "prestavka" pípnutie
   * toho dňa je "out" bez nasledujúceho "in") — čas odchodu. `breakMinutes`
   * počas prebiehajúcej prestávky NESMIE ukazovať naplánovanú (config)
   * hodnotu, kým reálne neuplynula — UI zobrazí "od {čas}", nie počet minút.
   */
  onBreakSince: Date | null;
};

export type PunchEventRow = {
  id: number;
  direction: "in" | "out";
  kind: "zmena" | "prestavka";
  occurredAt: Date;
  method: string;
  correctsEventId: number | null;
  correctionReason: string | null;
  /** Táto udalosť bola NESKÔR nahradená opravnou/anulačnou udalosťou (má potomka s corrects_event_id na ňu). */
  superseded: boolean;
  /** Táto udalosť VÔBEC nepredstavuje reálne pípnutie — len anuluje svoj corrects_event_id cieľ (granulárne "zmazanie"). */
  isVoid: boolean;
};

export type PunchOverviewData = {
  allWorkplaces: { id: string; name: string }[];
  workplace: { id: string; name: string } | null;
  employeeOptions: { id: string; name: string }[];
  rows: PunchOverviewRow[];
  /** Surové razítka toho dňa/zamestnanca (VRÁTANE nahradených, na plnú históriu) — kľúč `${employeeId}|${date}`. */
  eventsByRow: Record<string, PunchEventRow[]>;
  totals: { workedHours: number; days: number };
};

/**
 * "Prehľad pípnutí" — manažér/owner vidí, kto kedy pípol (príchod/odchod/
 * prestávka), za deň aj za obdobie (`dateFrom`/`dateTo`), s voliteľným
 * filtrom na jedného zamestnanca. Rovnaký vzor prístupných prevádzok ako
 * `vykazy/data.ts` a `kalendar/data.ts` (`accessible_workplaces()`, nie
 * org-wide `workplaces_select`).
 */
export async function getPunchOverviewData(
  user: CurrentUser,
  requestedWorkplaceId: string | undefined,
  dateFrom: string,
  dateTo: string,
  employeeId: string | undefined,
): Promise<PunchOverviewData> {
  return withUserContext(user.id, async (tx) => {
    const allWorkplaces = await tx
      .select({ id: workplaces.id, name: workplaces.name })
      .from(workplaces)
      .where(and(eq(workplaces.orgId, user.orgId), sql`${workplaces.id} IN (SELECT accessible_workplaces())`))
      .orderBy(asc(workplaces.name));

    const workplace = allWorkplaces.find((w) => w.id === requestedWorkplaceId) ?? allWorkplaces[0] ?? null;
    if (!workplace) {
      return {
        allWorkplaces,
        workplace: null,
        employeeOptions: [],
        rows: [],
        eventsByRow: {},
        totals: { workedHours: 0, days: 0 },
      };
    }

    const employeeOptions = await tx
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employeeWorkplaces)
      .innerJoin(employees, eq(employees.id, employeeWorkplaces.employeeId))
      .where(eq(employeeWorkplaces.workplaceId, workplace.id))
      .orderBy(asc(employees.lastName), asc(employees.firstName));

    const rowsRaw = await tx
      .select({
        id: attendanceDays.id,
        employeeId: attendanceDays.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        date: attendanceDays.date,
        plannedStart: attendanceDays.plannedStart,
        plannedEnd: attendanceDays.plannedEnd,
        actualStart: attendanceDays.actualStart,
        actualEnd: attendanceDays.actualEnd,
        breakMinutes: attendanceDays.breakMinutes,
        workedHours: attendanceDays.workedHours,
        status: attendanceDays.status,
        isLate: attendanceDays.isLate,
        lateMinutes: attendanceDays.lateMinutes,
        isCorrected: attendanceDays.isCorrected,
      })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .where(
        and(
          eq(attendanceDays.workplaceId, workplace.id),
          gte(attendanceDays.date, dateFrom),
          lte(attendanceDays.date, dateTo),
          employeeId ? eq(attendanceDays.employeeId, employeeId) : undefined,
        ),
      )
      .orderBy(desc(attendanceDays.date), asc(employees.lastName), asc(employees.firstName));

    const employeeIds = [...new Set(rowsRaw.map((r) => r.employeeId))];

    // Prestávka sa dá opraviť PÍPNUTÍM len pre "pipa" pozície (rovnaká
    // podmienka ako web-pípanie) — inak sa breakMinutes berie z konfigu a
    // korekcia cez punch_events by na výpočet nemala žiadny vplyv (mätúce).
    const breakModeByEmployee = new Map<string, boolean>();
    if (employeeIds.length > 0) {
      const positionRows = await tx
        .select({
          employeeId: employeePositionHistory.employeeId,
          breakTrackingMode: positions.breakTrackingMode,
          overrideBreakTrackingMode: employees.overrideBreakTrackingMode,
        })
        .from(employeePositionHistory)
        .innerJoin(positions, eq(positions.id, employeePositionHistory.positionId))
        .innerJoin(employees, eq(employees.id, employeePositionHistory.employeeId))
        .where(and(inArray(employeePositionHistory.employeeId, employeeIds), isNull(employeePositionHistory.validTo)));
      for (const p of positionRows) {
        const mode = resolveBreakTrackingMode(
          { breakTrackingMode: p.breakTrackingMode },
          { overrideBreakTrackingMode: p.overrideBreakTrackingMode },
        );
        breakModeByEmployee.set(p.employeeId, mode === "pipa");
      }
    }

    const rows: PunchOverviewRow[] = rowsRaw.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: `${r.firstName} ${r.lastName}`,
      date: r.date,
      plannedStart: r.plannedStart,
      plannedEnd: r.plannedEnd,
      actualStart: r.actualStart,
      actualEnd: r.actualEnd,
      breakMinutes: r.breakMinutes,
      workedHours: Number(r.workedHours),
      status: r.status,
      isLate: r.isLate,
      lateMinutes: r.lateMinutes,
      isCorrected: r.isCorrected,
      canCorrectBreak: breakModeByEmployee.get(r.employeeId) ?? false,
      onBreakSince: null,
    }));

    // Surové razítka za CELÉ obdobie naraz (VRÁTANE nahradených opravou, na
    // plnú históriu "kto kedy pípol") — okno o 6h/30h širšie ako dateFrom/
    // dateTo, rovnaký dôvod ako `eventsForLocalDate` (timestamptz vs. lokálny
    // kalendárny deň), len naraz pre celé obdobie/všetkých zamestnancov.
    const windowStart = new Date(new Date(`${dateFrom}T00:00:00Z`).getTime() - 6 * 3600 * 1000);
    const windowEnd = new Date(new Date(`${dateTo}T00:00:00Z`).getTime() + 30 * 3600 * 1000);

    const eventRows =
      employeeIds.length > 0
        ? await tx
            .select()
            .from(punchEvents)
            .where(
              and(
                eq(punchEvents.workplaceId, workplace.id),
                inArray(punchEvents.employeeId, employeeIds),
                gte(punchEvents.occurredAt, windowStart),
                lt(punchEvents.occurredAt, windowEnd),
              ),
            )
            .orderBy(asc(punchEvents.occurredAt))
        : [];

    const supersededIds = new Set(eventRows.filter((e) => e.correctsEventId != null).map((e) => e.correctsEventId));

    const eventsByRow: Record<string, PunchEventRow[]> = {};
    for (const e of eventRows) {
      const localDate = localDateStr(e.occurredAt);
      if (localDate < dateFrom || localDate > dateTo) continue;
      const key = `${e.employeeId}|${localDate}`;
      (eventsByRow[key] ??= []).push({
        id: e.id,
        direction: e.direction,
        kind: e.kind,
        occurredAt: e.occurredAt,
        method: e.method,
        correctsEventId: e.correctsEventId,
        correctionReason: e.correctionReason,
        superseded: supersededIds.has(e.id),
        isVoid: e.isVoid,
      });
    }

    // Prebiehajúca prestávka — posledné AKTÍVNE (nie nahradené/anulované)
    // "prestavka" pípnutie dňa je "out" bez nasledujúceho "in". `eventsByRow`
    // je zámerne zoradené chronologicky (eventRows: `orderBy(asc(occurredAt))`).
    const now = new Date();
    for (const r of rows) {
      const events = eventsByRow[`${r.employeeId}|${r.date}`] ?? [];
      const activeBreakEvents = events.filter((e) => e.kind === "prestavka" && !e.superseded && !e.isVoid);
      const lastActiveBreak = [...activeBreakEvents].reverse()[0];
      if (lastActiveBreak?.direction === "out") {
        r.onBreakSince = lastActiveBreak.occurredAt;
      }

      // Zmena je ešte OTVORENÁ ("V práci") — `worked_hours` v DB sa dopočíta
      // až po odpípaní odchodu (`calculateAttendanceDay`), dovtedy by tu bola
      // 0/stará hodnota. Toto je ČISTO zobrazenie (nič sa nezapisuje) —
      // živý prepočet z príchodu a skutočne odpípaných prestávok.
      if (r.status === "working" && r.actualStart) {
        r.workedHours = liveWorkedHours(r.actualStart, activeBreakEvents, now);
      }
    }

    const totals = rows.reduce(
      (acc, r) => ({
        workedHours: acc.workedHours + r.workedHours,
        days: acc.days + (r.status !== "planned" && r.status !== "absent" ? 1 : 0),
      }),
      { workedHours: 0, days: 0 },
    );

    return {
      allWorkplaces,
      workplace,
      employeeOptions: employeeOptions.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })),
      rows,
      eventsByRow,
      totals,
    };
  });
}
