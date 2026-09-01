import { and, asc, count, desc, eq, inArray, ne, or } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import {
  absenceRequests,
  attendanceDays,
  employeeAvailabilityRules,
  employeePairings,
  employeePositionHistory,
  employeeRateHistory,
  employeeSalaryHistory,
  employees,
  employeeWorkplaces,
  positions,
  punchEvents,
  scheduledShifts,
  shiftTemplates,
  users,
  workplaces,
} from "@/lib/db/schema";

export async function getEmployeeDetail(user: CurrentUser, employeeId: string) {
  return withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!employee) return null;

    const [positionHistory, rateHistory, salaryHistory, employeeWorkplaceRows, availabilityRules, allWorkplaces, allPositions, accountRows, shiftTemplateRows] =
      await Promise.all([
        tx
          .select({
            id: employeePositionHistory.id,
            positionId: employeePositionHistory.positionId,
            positionName: positions.name,
            positionColor: positions.color,
            // Fixný plat, Fáza 2 — potrebné na resolvePayMode() v page.tsx
            // (default režimu odmeňovania žije na POZÍCII, viď schema.ts).
            positionPayMode: positions.payMode,
            validFrom: employeePositionHistory.validFrom,
            validTo: employeePositionHistory.validTo,
          })
          .from(employeePositionHistory)
          .innerJoin(positions, eq(positions.id, employeePositionHistory.positionId))
          .where(eq(employeePositionHistory.employeeId, employeeId))
          .orderBy(desc(employeePositionHistory.validFrom)),

        tx
          .select({
            id: employeeRateHistory.id,
            workplaceId: employeeRateHistory.workplaceId,
            workplaceName: workplaces.name,
            hourlyRate: employeeRateHistory.hourlyRate,
            validFrom: employeeRateHistory.validFrom,
            validTo: employeeRateHistory.validTo,
          })
          .from(employeeRateHistory)
          .leftJoin(workplaces, eq(workplaces.id, employeeRateHistory.workplaceId))
          .where(eq(employeeRateHistory.employeeId, employeeId))
          .orderBy(desc(employeeRateHistory.validFrom)),

        // Fixný plat, Fáza 2 — BEZ prevádzky (employee_salary_history nemá
        // workplace_id, na rozdiel od rateHistory vyššie — fix je vlastnosť
        // človeka, nie prevádzky).
        tx
          .select({
            id: employeeSalaryHistory.id,
            fixAmount: employeeSalaryHistory.fixAmount,
            variableAmount: employeeSalaryHistory.variableAmount,
            validFrom: employeeSalaryHistory.validFrom,
            validTo: employeeSalaryHistory.validTo,
          })
          .from(employeeSalaryHistory)
          .where(eq(employeeSalaryHistory.employeeId, employeeId))
          .orderBy(desc(employeeSalaryHistory.validFrom)),

        tx
          .select({
            workplaceId: employeeWorkplaces.workplaceId,
            workplaceName: workplaces.name,
            isPrimary: employeeWorkplaces.isPrimary,
          })
          .from(employeeWorkplaces)
          .innerJoin(workplaces, eq(workplaces.id, employeeWorkplaces.workplaceId))
          .where(eq(employeeWorkplaces.employeeId, employeeId)),

        tx
          .select()
          .from(employeeAvailabilityRules)
          .where(eq(employeeAvailabilityRules.employeeId, employeeId))
          .orderBy(desc(employeeAvailabilityRules.createdAt)),

        tx
          .select({ id: workplaces.id, name: workplaces.name })
          .from(workplaces)
          .where(eq(workplaces.orgId, user.orgId))
          .orderBy(asc(workplaces.name)),

        tx
          .select({ id: positions.id, name: positions.name })
          .from(positions)
          .where(eq(positions.orgId, user.orgId))
          .orderBy(asc(positions.name)),

        // Prepojené prihlasovacie konto (employees.user_id) — dovtedy väzba,
        // ktorú žiadny reálny tok nikdy nevypĺňal ani nečítal. NULL, keď
        // zamestnanec žiadne konto nemá (napr. zatiaľ nepozvaný).
        employee.userId
          ? tx.select().from(users).where(eq(users.id, employee.userId))
          : Promise.resolve([]),

        // Šablóny zmien pre výber "Preferovaná zmena" (pravidlo `preferred_shift`)
        // — len z prevádzok, kde je zamestnanec priradený (shift_templates je
        // vždy naviazaná na jednu konkrétnu prevádzku), a len aktívne.
        tx
          .select({ id: shiftTemplates.id, name: shiftTemplates.name })
          .from(shiftTemplates)
          .innerJoin(employeeWorkplaces, eq(employeeWorkplaces.workplaceId, shiftTemplates.workplaceId))
          .where(and(eq(employeeWorkplaces.employeeId, employeeId), eq(shiftTemplates.isActive, true)))
          .orderBy(asc(shiftTemplates.name)),
      ]);

    const currentPosition = positionHistory.find((p) => !p.validTo) ?? null;

    return {
      employee,
      currentPosition,
      positionHistory,
      rateHistory,
      salaryHistory,
      employeeWorkplaces: employeeWorkplaceRows,
      // jsonb stĺpec `params` je z Drizzle typovaný ako `unknown` (obsah je
      // voľná štruktúra podľa rule_type, viď components/employees/availability-rule-types.ts).
      availabilityRules: availabilityRules.map((r) => ({
        ...r,
        params: r.params as Record<string, unknown>,
      })),
      allWorkplaces,
      allPositions,
      account: accountRows[0] ?? null,
      shiftTemplateOptions: shiftTemplateRows,
    };
  });
}

export type EmployeeDetail = NonNullable<Awaited<ReturnType<typeof getEmployeeDetail>>>;

/**
 * Blok 14, bod 3 — prehľad DÔSLEDKOV pred mazaním zamestnanca, nech owner
 * vidí, čo presne zmizne (najmä počet pípnutí — jediné, čo doteraz platilo
 * ako "sa nikdy nedá zmazať") PREDTÝM, než si vyžiada
 * potvrdzovací kód. Číta sa cez bežný RLS-scoped `withUserContext`, žiadny
 * `set_config('app.confirmed_employee_delete_id', ...)` sa tu nenastavuje —
 * to robí až samotné mazanie (`confirmDeleteEmployeeAction`).
 */
export async function getEmployeeDeletionSummary(user: CurrentUser, employeeId: string) {
  return withUserContext(user.id, async (tx) => {
    const [
      [punchEventsRow],
      [absenceRequestsRow],
      [attendanceDaysRow],
      [scheduledShiftsRow],
      [positionHistoryRow],
      [rateHistoryRow],
    ] = await Promise.all([
      tx.select({ n: count() }).from(punchEvents).where(eq(punchEvents.employeeId, employeeId)),
      tx.select({ n: count() }).from(absenceRequests).where(eq(absenceRequests.employeeId, employeeId)),
      tx.select({ n: count() }).from(attendanceDays).where(eq(attendanceDays.employeeId, employeeId)),
      tx.select({ n: count() }).from(scheduledShifts).where(eq(scheduledShifts.employeeId, employeeId)),
      tx.select({ n: count() }).from(employeePositionHistory).where(eq(employeePositionHistory.employeeId, employeeId)),
      tx.select({ n: count() }).from(employeeRateHistory).where(eq(employeeRateHistory.employeeId, employeeId)),
    ]);

    return {
      punchEventsCount: punchEventsRow.n,
      absenceRequestsCount: absenceRequestsRow.n,
      attendanceDaysCount: attendanceDaysRow.n,
      scheduledShiftsCount: scheduledShiftsRow.n,
      positionHistoryCount: positionHistoryRow.n,
      rateHistoryCount: rateHistoryRow.n,
    };
  });
}

export type EmployeeDeletionSummary = Awaited<ReturnType<typeof getEmployeeDeletionSummary>>;

/**
 * Blok 15 (párovanie zamestnancov) — páry TOHTO zamestnanca, nezávisle od
 * toho, či je uložený ako `employee_a_id` alebo `employee_b_id` (appka
 * zoraďuje dvojicu pred insertom, viď `lib/employees/pairings.ts`, ale
 * čítanie musí hľadať v OBOCH stĺpcoch). Mená partnerov sa doťahujú
 * samostatným dopytom (nie JOIN s CASE) — jednoduchšie na čítanie a počet
 * párov na zamestnanca je v praxi malý.
 */
export async function getEmployeePairings(user: CurrentUser, employeeId: string) {
  return withUserContext(user.id, async (tx) => {
    const rows = await tx
      .select({ id: employeePairings.id, employeeAId: employeePairings.employeeAId, employeeBId: employeePairings.employeeBId, isHard: employeePairings.isHard, note: employeePairings.note })
      .from(employeePairings)
      .where(and(eq(employeePairings.isActive, true), or(eq(employeePairings.employeeAId, employeeId), eq(employeePairings.employeeBId, employeeId))))
      .orderBy(desc(employeePairings.createdAt));

    const partnerIds = rows.map((r) => (r.employeeAId === employeeId ? r.employeeBId : r.employeeAId));
    const partners = partnerIds.length > 0
      ? await tx.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName }).from(employees).where(inArray(employees.id, partnerIds))
      : [];
    const partnerById = new Map(partners.map((p) => [p.id, p]));

    return rows.map((r) => {
      const partnerId = r.employeeAId === employeeId ? r.employeeBId : r.employeeAId;
      const partner = partnerById.get(partnerId);
      return {
        id: r.id,
        isHard: r.isHard,
        note: r.note,
        partnerId,
        partnerName: partner ? `${partner.firstName} ${partner.lastName}` : "(zmazaný zamestnanec)",
      };
    });
  });
}

export type EmployeePairing = Awaited<ReturnType<typeof getEmployeePairings>>[number];

/** Kandidáti na spárovanie — VŠETCI aktívni zamestnanci org (nezávisle od pozície/prevádzky), okrem seba samého. */
export async function getPairingCandidates(user: CurrentUser, employeeId: string) {
  return withUserContext(user.id, (tx) =>
    tx
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(and(eq(employees.orgId, user.orgId), eq(employees.isActive, true), ne(employees.id, employeeId)))
      .orderBy(asc(employees.lastName), asc(employees.firstName)),
  );
}
