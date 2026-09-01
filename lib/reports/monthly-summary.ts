import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  absenceKindEnum,
  absences,
  attendanceDays,
  employeePositionHistory,
  employees,
  employeeWorkplaces,
  positions,
  workplaces,
} from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { getRateAt, getSalaryAt } from "@/lib/payroll/calculate";
import { type PayMode, resolvePayMode } from "@/lib/payroll/resolve-pay-mode";
import { toDateStr } from "@/lib/shared/dates";

type Db = PostgresJsDatabase<typeof schema>;

export type AbsenceKind = (typeof absenceKindEnum.enumValues)[number];

export type EmployeeMonthlySummary = {
  employeeId: string;
  name: string;
  personalNumber: string | null;
  positionName: string | null;
  payMode: PayMode;
  daysWorked: number;
  workedHours: number;
  overtimeHours: number;
  weekendHours: number;
  holidayHours: number;
  nightHours: number;
  lateCount: number;
  lateMinutesTotal: number;
  absenceDays: Record<AbsenceKind, number>;
  vacation: { entitlement: number; taken: number; remaining: number };
  grossWage: number;
  /**
   * Fixný plat, Fáza 4 (exporty) — null pre hodinových (irelevantné) AJ pre
   * fixných BEZ založenej histórie (žiadne dáta, nie "0 €"). Výstupy ich
   * zobrazujú ako samostatné položky vedľa `grossWage` (ten pre "fixny"
   * ostáva ich súčtom, presne ako doteraz — Fáza 3).
   */
  fixAmount: number | null;
  variableAmount: number | null;
};

export type MonthlySummary = {
  workplaceId: string;
  workplaceName: string;
  year: number;
  month: number;
  employees: EmployeeMonthlySummary[];
  totals: {
    daysWorked: number;
    workedHours: number;
    overtimeHours: number;
    weekendHours: number;
    holidayHours: number;
    nightHours: number;
    absenceDays: Record<AbsenceKind, number>;
    grossWage: number;
    /** Súčet za VŠETKÝCH fixných zamestnancov (bez histórie prispieva 0, rovnako ako grossWage). */
    fixAmount: number;
    variableAmount: number;
  };
};

const ZERO_ABSENCE_DAYS: Record<AbsenceKind, number> = Object.fromEntries(
  absenceKindEnum.enumValues.map((k) => [k, 0]),
) as Record<AbsenceKind, number>;

/**
 * Výkazy (PDF/Excel/web) nevypisujú náhradné voľno ako vlastný riadok —
 * ostatné typy neprítomnosti áno. `absenceKindEnum.enumValues` samotný
 * ostáva kompletný (kalendár aj žiadosti náhradné voľno naďalej ponúkajú,
 * `components/calendar/absence-kinds.ts`) — toto je len zoznam TOHO, čo sa
 * vo výkazoch zobrazuje, zdieľané naprieč všetkými 3 rendererami, nech sa
 * filter nerozíde medzi PDF/Excel/webom.
 */
export const REPORTED_ABSENCE_KINDS = absenceKindEnum.enumValues.filter((k) => k !== "nahradne_volno");

/**
 * Výkazy zobrazujú absencie v HODINÁCH, nie dňoch — `absenceDays` v
 * `MonthlySummary` zostáva v pôvodnej jednotke (deň, príp. deň-zlomok pri
 * čiastočnej absencii), aby sa nemenil existujúci, otestovaný kontrakt
 * dátovej vrstvy; prepočet na hodiny je len na zobrazenie. Rovnaký 8h/deň
 * predpoklad, aký `buildMonthlySummary` používa pri prepočte hodín na
 * deň-zlomok (`hours ? hours/8 : 1`) nižšie — tu sa len obracia späť, takže
 * pre absencie so zaznamenanými hodinami vyjde presne pôvodná hodnota.
 */
export function absenceDaysToHours(days: number): number {
  return days * 8;
}

/**
 * Dátový základ výkazu (mesačný prehľad prevádzky). Číta VÝHRADNE
 * už existujúce, priebežne počítané dáta (`attendance_days`,
 * `absences`) — nič sa tu prepočítava naново, len sa agreguje za
 * obdobie. Jediný nový výpočet oproti dennému `calculateAttendanceDay` je
 * mzda: `getRateAt()` (doteraz nikde reálne zapojené) sa volá PRE
 * KAŽDÝ DEŇ ZVLÁŠŤ — ak sa sadzba zmení v priebehu
 * mesiaca, dni pred zmenou a po zmene majú každý svoju.
 *
 * "Hrubá mzda" = Σ (workedHours+overtimeHours dňa) × (sadzba PLATNÁ ten deň).
 * BEZ príplatkov (nočné/víkend/sviatok sú len informatívne stĺpce) — presná
 * výška príplatku je stále otvorená otázka (architektura.md #9, bod 3).
 *
 * Dovolenka nárok/čerpané/zostatok sa počíta NAŽIVO z `employees` +
 * `absences` (nie z `vacation_balances` — tá tabuľka existuje v schéme, ale
 * nič ju nezapisuje; počítať naživo je jednoduchšie a nemôže sa rozísť s
 * realitou). Čerpané = potvrdené `dovolenka` dni od 1.1. daného roka po
 * koniec vykazovaného mesiaca (nie len tento mesiac — nárok je ROČNÝ).
 */
export async function buildMonthlySummary(tx: Db, workplaceId: string, year: number, month: number): Promise<MonthlySummary> {
  // `workplaces_select` RLS je len org-wide (migrácia 0009), nie per-manažér —
  // rovnaká explicitná dovnútra-query poistka ako lib/scheduler/db-loader.ts,
  // nech výkaz nejde vytvoriť ani pre prevádzku mimo prístupu volajúceho.
  const [workplace] = await tx
    .select()
    .from(workplaces)
    .where(and(eq(workplaces.id, workplaceId), sql`(current_user_id() IS NULL OR ${workplaces.id} IN (SELECT accessible_workplaces()))`));
  if (!workplace) throw new Error("Prevádzka neexistuje alebo k nej nemáš prístup.");

  const monthStart = toDateStr(year, month, 1);
  const monthEnd = toDateStr(year, month, new Date(year, month, 0).getDate());
  const yearStart = toDateStr(year, 1, 1);

  // Rovnaký vzor ako lib/scheduler/db-loader.ts — zamestnanec aktívny v
  // TEJTO prevádzke POČAS cieľového mesiaca (nielen momentálne aktívny).
  // Toto je pre KALENDÁR/GENEROVANIE (db-loader.ts) správne kritérium — tam
  // má neaktívny ostať skrytý (nesmie dostať nové zmeny). VO VÝKAZOCH to ale
  // bol bug: `is_active` schováva aj zamestnanca, čo v danom historickom
  // mesiaci reálne pracoval, ale je MEDZITÝM (dnes) ukončený — napr. import
  // historickej dochádzky, kde zamestnanec skončil pred pár mesiacmi.
  const activeInMonthRows = await tx
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(employeeWorkplaces, eq(employeeWorkplaces.employeeId, employees.id))
    .where(
      and(
        eq(employeeWorkplaces.workplaceId, workplaceId),
        eq(employees.isActive, true),
        lte(employees.hiredOn, monthEnd),
        or(isNull(employees.terminatedOn), gte(employees.terminatedOn, monthStart)),
      ),
    );

  // DOPLNOK (oprava vyššie spomenutého bugu) — KTOKOĽVEK, kto mal v tomto
  // mesiaci na TEJTO prevádzke reálnu dochádzku alebo (potvrdenú) absenciu,
  // bez ohľadu na dnešný `is_active`. Zjednotené s riadkom vyššie cez množinu
  // ID — aktívnych to nemení (tí prejdú aj tak), len PRIDÁVA medzitým
  // ukončených, čo v danom mesiaci reálne niečo mali. Kto nemal nič (ani
  // aktívny záznam v mesiaci, ani dochádzku/absenciu), do výkazu nepatrí —
  // žiadny prázdny riadok s nulami.
  const [attendedRows, absentRows] = await Promise.all([
    tx
      .selectDistinct({ employeeId: attendanceDays.employeeId })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.workplaceId, workplaceId), gte(attendanceDays.date, monthStart), lte(attendanceDays.date, monthEnd))),
    tx
      .selectDistinct({ employeeId: absences.employeeId })
      .from(absences)
      .where(and(eq(absences.workplaceId, workplaceId), eq(absences.isConfirmed, true), gte(absences.date, monthStart), lte(absences.date, monthEnd))),
  ]);

  const employeeIdSet = new Set<string>([
    ...activeInMonthRows.map((r) => r.id),
    ...attendedRows.map((r) => r.employeeId),
    ...absentRows.map((r) => r.employeeId),
  ]);

  if (employeeIdSet.size === 0) {
    return {
      workplaceId,
      workplaceName: workplace.name,
      year,
      month,
      employees: [],
      totals: { daysWorked: 0, workedHours: 0, overtimeHours: 0, weekendHours: 0, holidayHours: 0, nightHours: 0, absenceDays: { ...ZERO_ABSENCE_DAYS }, grossWage: 0, fixAmount: 0, variableAmount: 0 },
    };
  }

  const employeeRows = await tx
    .select({ employee: employees })
    .from(employees)
    .where(inArray(employees.id, [...employeeIdSet]));
  const employeeIds = employeeRows.map((r) => r.employee.id);

  // Pozícia PLATNÁ počas mesiaca (rovnaké zjednodušenie ako db-loader.ts,
  // pri zmene uprostred mesiaca berie tú s najneskorším valid_from).
  const positionHistoryRows = await tx
    .select()
    .from(employeePositionHistory)
    .where(
      and(
        inArray(employeePositionHistory.employeeId, employeeIds),
        lte(employeePositionHistory.validFrom, monthEnd),
        or(isNull(employeePositionHistory.validTo), gte(employeePositionHistory.validTo, monthStart)),
      ),
    );
  const positionByEmployee = new Map<string, string>();
  const latestValidFromByEmployee = new Map<string, string>();
  for (const row of positionHistoryRows) {
    const seen = latestValidFromByEmployee.get(row.employeeId);
    if (!seen || row.validFrom > seen) {
      latestValidFromByEmployee.set(row.employeeId, row.validFrom);
      positionByEmployee.set(row.employeeId, row.positionId);
    }
  }
  const usedPositionIds = [...new Set(positionByEmployee.values())];
  const positionRows =
    usedPositionIds.length === 0
      ? []
      : await tx.select({ id: positions.id, name: positions.name, payMode: positions.payMode }).from(positions).where(inArray(positions.id, usedPositionIds));
  const positionNameById = new Map(positionRows.map((p) => [p.id, p.name]));
  const positionPayModeById = new Map(positionRows.map((p) => [p.id, p.payMode]));

  const attendanceRows = await tx
    .select()
    .from(attendanceDays)
    .where(and(inArray(attendanceDays.employeeId, employeeIds), eq(attendanceDays.workplaceId, workplaceId), gte(attendanceDays.date, monthStart), lte(attendanceDays.date, monthEnd)));

  const absenceRowsInMonth = await tx
    .select()
    .from(absences)
    .where(and(inArray(absences.employeeId, employeeIds), eq(absences.isConfirmed, true), gte(absences.date, monthStart), lte(absences.date, monthEnd)));

  // Dovolenka čerpaná OD ZAČIATKU ROKA (nárok je ročný, nie mesačný) — samostatný dotaz, širší rozsah dátumov.
  const vacationYtdRows = await tx
    .select({ employeeId: absences.employeeId, date: absences.date, hours: absences.hours })
    .from(absences)
    .where(and(inArray(absences.employeeId, employeeIds), eq(absences.isConfirmed, true), eq(absences.kind, "dovolenka"), gte(absences.date, yearStart), lte(absences.date, monthEnd)));

  const vacationTakenByEmployee = new Map<string, number>();
  for (const row of vacationYtdRows) {
    // Celodenná dovolenka (hours=NULL) = 1 deň. Čiastočná (hours nastavené,
    // zvyčajne paragraf/lekár, zriedka dovolenka) = pomerná časť z 8h dňa —
    // zjednodušenie.
    const dayFraction = row.hours ? Number(row.hours) / 8 : 1;
    vacationTakenByEmployee.set(row.employeeId, (vacationTakenByEmployee.get(row.employeeId) ?? 0) + dayFraction);
  }

  const attendanceByEmployee = new Map<string, typeof attendanceRows>();
  for (const row of attendanceRows) {
    const list = attendanceByEmployee.get(row.employeeId) ?? [];
    list.push(row);
    attendanceByEmployee.set(row.employeeId, list);
  }

  const absenceByEmployee = new Map<string, Record<AbsenceKind, number>>();
  for (const row of absenceRowsInMonth) {
    const rec = absenceByEmployee.get(row.employeeId) ?? { ...ZERO_ABSENCE_DAYS };
    const dayFraction = row.hours ? Number(row.hours) / 8 : 1;
    rec[row.kind] += dayFraction;
    absenceByEmployee.set(row.employeeId, rec);
  }

  const employeeSummaries: EmployeeMonthlySummary[] = [];
  for (const { employee } of employeeRows) {
    const dayRows = attendanceByEmployee.get(employee.id) ?? [];
    const positionId = positionByEmployee.get(employee.id);
    const payMode = resolvePayMode(
      positionId && positionPayModeById.has(positionId) ? { payMode: positionPayModeById.get(positionId)! } : null,
      { overridePayMode: employee.overridePayMode },
    );

    let workedHours = 0;
    let overtimeHours = 0;
    let weekendHours = 0;
    let holidayHours = 0;
    let nightHours = 0;
    let lateCount = 0;
    let lateMinutesTotal = 0;
    let daysWorked = 0;
    let grossWage = 0;
    let fixAmount: number | null = null;
    let variableAmount: number | null = null;

    for (const day of dayRows) {
      const worked = Number(day.workedHours);
      const overtime = Number(day.overtimeHours);
      if (day.status === "done" && (worked > 0 || overtime > 0)) daysWorked += 1;
      workedHours += worked;
      overtimeHours += overtime;
      weekendHours += Number(day.weekendHours);
      holidayHours += Number(day.holidayHours);
      nightHours += Number(day.nightHours);
      if (day.isLate) {
        lateCount += 1;
        lateMinutesTotal += day.lateMinutes;
      }

      // Hodinový režim (default, dnešné jediné správanie) — NEZMENENÉ.
      // Blok 8 (getRateAt) — volané PER DEŇ, nie raz za mesiac.
      if (payMode === "hodinovy") {
        const rate = await getRateAt(tx, employee.id, day.date);
        if (rate !== null) grossWage += (worked + overtime) * rate;
      }
    }

    // Fixný plat — nová vetva (fixný plat namiesto hodinovej sadzby). Fix +
    // variabilná, mesačný paušál BEZ prorátovania — getSalaryAt sa volá RAZ
    // za mesiac, s dátumom KONCA mesiaca (nie per deň ako getRateAt vyššie).
    // Hodiny sa aj tak počítali v cykle vyššie (informačne vo výkaze), len sa
    // z nich mzda nepočíta.
    if (payMode === "fixny") {
      const salary = await getSalaryAt(tx, employee.id, monthEnd);
      if (salary) {
        grossWage = salary.fixAmount + salary.variableAmount;
        fixAmount = salary.fixAmount;
        variableAmount = salary.variableAmount;
      }
    }

    const entitlement = Number(employee.vacationDaysPerYear ?? 20) + Number(employee.vacationCarriedOver ?? 0);
    const taken = vacationTakenByEmployee.get(employee.id) ?? 0;

    employeeSummaries.push({
      employeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      personalNumber: employee.personalNumber,
      positionName: positionNameById.get(positionId ?? "") ?? null,
      payMode,
      daysWorked,
      workedHours,
      overtimeHours,
      weekendHours,
      holidayHours,
      nightHours,
      lateCount,
      lateMinutesTotal,
      absenceDays: absenceByEmployee.get(employee.id) ?? { ...ZERO_ABSENCE_DAYS },
      vacation: { entitlement, taken, remaining: entitlement - taken },
      grossWage,
      fixAmount,
      variableAmount,
    });
  }

  const totals = employeeSummaries.reduce(
    (acc, e) => {
      acc.daysWorked += e.daysWorked;
      acc.workedHours += e.workedHours;
      acc.overtimeHours += e.overtimeHours;
      acc.weekendHours += e.weekendHours;
      acc.holidayHours += e.holidayHours;
      acc.nightHours += e.nightHours;
      acc.grossWage += e.grossWage;
      acc.fixAmount += e.fixAmount ?? 0;
      acc.variableAmount += e.variableAmount ?? 0;
      for (const kind of absenceKindEnum.enumValues) acc.absenceDays[kind] += e.absenceDays[kind];
      return acc;
    },
    { daysWorked: 0, workedHours: 0, overtimeHours: 0, weekendHours: 0, holidayHours: 0, nightHours: 0, absenceDays: { ...ZERO_ABSENCE_DAYS }, grossWage: 0, fixAmount: 0, variableAmount: 0 },
  );

  return { workplaceId, workplaceName: workplace.name, year, month, employees: employeeSummaries, totals };
}
