import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import {
  absences,
  coverageRequirements,
  employeeAvailabilityRules,
  employeePairings,
  employeePositionHistory,
  employees,
  employeeShiftTemplates,
  employeeWorkplaces,
  holidays,
  legalRules,
  positions,
  scheduledShifts,
  shiftTemplates,
  workplaceClosures,
  workplaces,
} from "@/lib/db/schema";
import { addDays, daysInMonth, toDateStr } from "@/lib/shared/dates";
import type { AbsenceEntry, CoverageNeed, EmployeePairingInput, ExternalPartnerShift, GenerateEmployee, GenerateInput, LockedShift } from "./generate";
import type { AssignedShift, AvailabilityRuleInput, LegalRuleInput } from "./rules";
import { resolveWorkTimeMode } from "./work-time-mode";

/**
 * Blok A (carryOverBlock) — koľko kalendárnych dní PRED
 * 1. dňom generovaného mesiaca sa načíta ako "chvost" predchádzajúceho
 * mesiaca. Musí byť dosť veľké na akýkoľvek reálny `block_length`
 * (typicky ≤ 7) aj `min_rest_days` — 14 dní je veľkorysá rezerva.
 */
const PRIOR_MONTH_TAIL_DAYS = 14;

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Blok 9d-1 (🔍) — poskladá `GenerateInput` z REÁLNYCH tabuliek. Beží
 * VÝHRADNE pod `tx` z `withUserContext` (RLS pod identitou prihláseného
 * používateľa, nikdy `adminDb`) — manažér, ktorý smie vidieť len svoju
 * prevádzku, dostane len jej dáta aj tu, nie preto, že by táto funkcia
 * niečo filtrovala navyše, ale preto, že RLS politiky na `employees`,
 * `scheduled_shifts` atď. mu inak nič nevrátia.
 *
 * Blok 9d-4 (VYRIEŠENÉ): `coverage_requirements.shift_template_id`
 * (migrácia 0014) hovorí KTORÚ zmenu má potreba pokrytia obsadiť. Riadky BEZ
 * väzby (NULL, alebo odkaz na neaktívnu/zmazanú šablónu) sa do `coverageNeeds`
 * NEZARADIA — nezadrátuje sa žiadny odhad, namiesto
 * toho sa spočítajú zvlášť (`counts.coverageNeedsUsable` < `coverageRequirementsRaw`)
 * a UI (Nastavenia → Pokrytie) ich viditeľne označí, nie potichu zahodí.
 */
export type LoadedGenerateInput = {
  input: GenerateInput;
  /** Diagnostika pre 9d-1 demo beh — surové počty z DB, nech sa dajú overiť proti realite. */
  counts: {
    employees: number;
    availabilityRules: number;
    shiftTemplates: number;
    legalRules: number;
    coverageRequirementsRaw: number;
    /** Koľko z `coverageRequirementsRaw` má platnú väzbu na aktívnu šablónu zmeny (9d-4) — rozdiel = neviditeľné pre generátor, viď UI badge. */
    coverageNeedsUsable: number;
    absences: number;
    workplaceClosures: number;
    holidays: number;
    lockedShifts: number;
    /** Blok 15 (Stage 2a) — počet párov, kde je aspoň jeden zo zamestnancov v tejto prevádzke tento mesiac. */
    pairings: number;
  };
};

export async function loadGenerateInput(tx: Db, workplaceId: string, year: number, month: number): Promise<LoadedGenerateInput> {
  const monthStart = toDateStr(year, month, 1);
  const monthEnd = toDateStr(year, month, daysInMonth(year, month));

  // `workplaces_select` RLS (migrácia 0009) je len ORG-scoped
  // (`org_id = current_user_org_id()`) — zámerne, nech dropdown/prepínač
  // prevádzok vidí VŠETKY prevádzky organizácie. Samo o sebe by preto
  // NEODHALILO manažéra, ktorý má prístup len k Hotelu a skúsi (aj
  // vyforsovaným `workplaceId`) vygenerovať pre Office — ten SICE existuje
  // v jeho org, ale nemá naň konkrétny prístup. Bez explicitného
  // `accessible_workplaces()` dopytu TU by sa to odhalilo až neskôr, v
  // `persistGenerateResult` (schedules_write RLS), s menej čitateľnou
  // chybou (Skupina D, 9d bezpečnostný sweep). Rovnaký vzor ako
  // `getCalendarData` (app/(app)/kalendar/data.ts) používa pre `allWorkplaces`.
  //
  // `current_user_id() IS NULL` = service role/cron beh (`runGenerateAsCron`,
  // `adminDb.transaction`, žiadny `SET LOCAL app.user_id`) — tam je
  // `accessible_workplaces()` prázdne (nemá čí), ale RLS je aj tak úplne
  // obídené (`adminDb`), takže tento dodatočný filter sa preň VYPÍNA — nie
  // je čo kontrolovať navyše, cron dostáva len `workplaceId` z vlastného
  // `SELECT ... WHERE is_active = true` (route.ts), nie od nedôveryhodného klienta.
  const [workplace] = await tx
    .select()
    .from(workplaces)
    .where(and(eq(workplaces.id, workplaceId), sql`(current_user_id() IS NULL OR ${workplaces.id} IN (SELECT accessible_workplaces()))`));
  if (!workplace) {
    // RLS fail-safe: 0 riadkov namiesto chyby, ak
    // používateľ na túto prevádzku vôbec nemá prístup — nerozlišujeme to od
    // "neexistuje", presne ako zvyšok appky.
    throw new Error("Prevádzka neexistuje alebo k nej nemáš prístup.");
  }

  // --- 1. Zamestnanci aktívni v tejto prevádzke POČAS cieľového mesiaca ---
  // (nielen momentálne aktívni — niekto mohol nastúpiť/odísť UPROSTRED
  // mesiaca).
  const employeeRows = await tx
    .select({ employee: employees })
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
  const employeeIds = employeeRows.map((r) => r.employee.id);

  // --- Pozícia každého zamestnanca PLATNÁ počas cieľového mesiaca ---
  // (história, nie statické pole). Zjednodušenie:
  // ak sa pozícia zmenila UPROSTRED mesiaca, berie sa tá s najneskorším
  // valid_from — generátor pozná len JEDNU pozíciu na zamestnanca na celý
  // beh, nie zmenu v priebehu mesiaca. Vedomé, zapísané zjednodušenie.
  const positionHistoryRows =
    employeeIds.length === 0
      ? []
      : await tx
          .select()
          .from(employeePositionHistory)
          .where(
            and(
              inArray(employeePositionHistory.employeeId, employeeIds),
              lte(employeePositionHistory.validFrom, monthEnd),
              or(isNull(employeePositionHistory.validTo), gte(employeePositionHistory.validTo, monthStart)),
            ),
          );
  const latestValidFromByEmployee = new Map<string, string>();
  const positionByEmployee = new Map<string, string | null>();
  for (const row of positionHistoryRows) {
    const seenValidFrom = latestValidFromByEmployee.get(row.employeeId);
    if (!seenValidFrom || row.validFrom > seenValidFrom) {
      latestValidFromByEmployee.set(row.employeeId, row.validFrom);
      positionByEmployee.set(row.employeeId, row.positionId);
    }
  }

  // --- 2. Pravidlá dostupnosti — vlastné zamestnancovi ALEBO viazané na TÚTO prevádzku ---
  const ruleRows =
    employeeIds.length === 0
      ? []
      : await tx
          .select()
          .from(employeeAvailabilityRules)
          .where(
            and(
              inArray(employeeAvailabilityRules.employeeId, employeeIds),
              eq(employeeAvailabilityRules.isActive, true),
              or(isNull(employeeAvailabilityRules.workplaceId), eq(employeeAvailabilityRules.workplaceId, workplaceId)),
              or(isNull(employeeAvailabilityRules.validFrom), lte(employeeAvailabilityRules.validFrom, monthEnd)),
              or(isNull(employeeAvailabilityRules.validTo), gte(employeeAvailabilityRules.validTo, monthStart)),
            ),
          );
  const rulesByEmployee = new Map<string, AvailabilityRuleInput[]>();
  for (const r of ruleRows) {
    const list = rulesByEmployee.get(r.employeeId) ?? [];
    list.push({ ruleType: r.ruleType, params: r.params as Record<string, unknown>, isHard: r.isHard, priority: r.priority });
    rulesByEmployee.set(r.employeeId, list);
  }

  // --- 3. Šablóny zmien + preferencie zamestnanca (override* sa zatiaľ NEPOUŽÍVA
  // pri samotnom generovaní — generátor priraďuje presne časy z CoverageNeed,
  // nie z employee_shift_templates; is_preferred ovplyvňuje len skóre.) ---
  const templateRows = await tx.select().from(shiftTemplates).where(and(eq(shiftTemplates.workplaceId, workplaceId), eq(shiftTemplates.isActive, true)));

  const preferredByEmployee = new Map<string, string>();
  if (employeeIds.length > 0) {
    const empShiftRows = await tx
      .select()
      .from(employeeShiftTemplates)
      .where(and(inArray(employeeShiftTemplates.employeeId, employeeIds), eq(employeeShiftTemplates.isPreferred, true)));
    for (const r of empShiftRows) preferredByEmployee.set(r.employeeId, r.shiftTemplateId);
  }

  // --- 1c. Blok A (§87 ZP) — vyriešený work_time_mode KAŽDÉHO zamestnanca (výhradne zo zamestnanca, pozícia doň nehovorí). ---
  const workTimeByEmployee = new Map(
    employeeRows.map(({ employee }) => [
      employee.id,
      resolveWorkTimeMode({ workTimeMode: employee.workTimeMode, balancingPeriodMonths: employee.balancingPeriodMonths }),
    ] as const),
  );

  // --- 1d. Blok A (carryOverBlock) — "chvost" KAŽDÉHO zamestnanca
  // (bez ohľadu na work_time_mode — block_length/min_rest_days/MIN_REST_DAILY sa
  // týkajú všetkých) z KONCA predchádzajúceho mesiaca. JEDINÉ, čo sa cez hranicu
  // mesiaca prenáša — žiadny súčet hodín, len skutočné priradené zmeny, aby
  // findBlockContinuer/odpočinok na 1. dni nového mesiaca videli pravdivý kontext.
  const tailStart = addDays(monthStart, -PRIOR_MONTH_TAIL_DAYS);
  const tailEnd = addDays(monthStart, -1);
  const tailRows =
    employeeIds.length === 0
      ? []
      : await tx
          .select({ employeeId: scheduledShifts.employeeId, date: scheduledShifts.date, startTime: scheduledShifts.startTime, endTime: scheduledShifts.endTime, crossesMidnight: scheduledShifts.crossesMidnight, breakMinutes: scheduledShifts.breakMinutes })
          .from(scheduledShifts)
          .where(and(inArray(scheduledShifts.employeeId, employeeIds), eq(scheduledShifts.workplaceId, workplaceId), gte(scheduledShifts.date, tailStart), lte(scheduledShifts.date, tailEnd)));
  const tailByEmployee = new Map<string, AssignedShift[]>();
  for (const r of tailRows) {
    const list = tailByEmployee.get(r.employeeId) ?? [];
    list.push({ date: r.date, startTime: r.startTime, endTime: r.endTime, crossesMidnight: r.crossesMidnight, breakMinutes: r.breakMinutes });
    tailByEmployee.set(r.employeeId, list);
  }

  // --- 4. §ZP a firemné pravidlá (celá organizácia) ---
  // Načítané PRED zamestnancami — Q10 potrebuje `MAX_WEEKLY_HOURS`
  // ako fallback "plný úväzok", keď zamestnanec nemá vlastný `contract_hours_per_month`.
  const legalRuleRows = await tx.select().from(legalRules).where(and(eq(legalRules.orgId, workplace.orgId), eq(legalRules.isActive, true)));
  const generateLegalRules: LegalRuleInput[] = legalRuleRows.map((r) => ({ code: r.code, params: r.params as Record<string, unknown>, isHard: r.isHard }));

  // Q10 — "úväzok sa nastavuje per zamestnanec, DEFAULT PLNÝ,
  // prepísateľný". `employees.contract_hours_per_month` je nullable (nikdy sa
  // nezadal) — bez fallbacku by to znamenalo "žiadny osobný cieľ" namiesto
  // "plný úväzok" a fondová férovosť (scoring.ts) by ho úplne ignorovala.
  // Namiesto zadrátovania "40" sa "plný úväzok" berie z
  // už existujúceho `legal_rules.MAX_WEEKLY_HOURS` — org má tento riadok VŽDY
  // nakonfigurovaný (je to primárny týždenný strop). `MAX_WEEKLY_HOURS` je
  // TÝŽDENNÝ (§ZP koncept), takže fallback sa prevádza × priemerný počet
  // týždňov v mesiaci (365.25/7/12) — rovnaký orientačný prepočet ako predtým,
  // len teraz LEN pre fallback, nie pre zamestnancovu vlastnú
  // hodnotu (tá je od teraz priamo mesačná).
  const standardWeeklyHours = legalRuleRows.find((r) => r.code === "MAX_WEEKLY_HOURS")?.params as { hours?: number } | undefined;
  const fullTimeMonthlyHours = standardWeeklyHours?.hours != null ? standardWeeklyHours.hours * 4.348125 : null;

  const generateEmployees: GenerateEmployee[] = employeeRows.map(({ employee }) => {
    const positionId = positionByEmployee.get(employee.id) ?? null;
    const workTime = workTimeByEmployee.get(employee.id)!;

    const monthlyHours = employee.contractHoursPerMonth ? Number(employee.contractHoursPerMonth) : fullTimeMonthlyHours;

    return {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      positionId,
      rules: rulesByEmployee.get(employee.id) ?? [],
      contractedMonthlyHours: monthlyHours,
      preferredShiftTemplateId: preferredByEmployee.get(employee.id) ?? null,
      workTimeMode: workTime.mode,
      priorMonthTailShifts: tailByEmployee.get(employee.id) ?? [],
      canBeShiftLeader: employee.canBeShiftLeader,
    };
  });

  // --- Vedúci smeny, krok 2 — pozície tejto prevádzky (aj org-wide, `workplace_id IS NULL`),
  // čo vyžadujú vedúceho. Org-scoped (`workplace.orgId`) — `workplace_id IS NULL` samo
  // osebe by inak zachytilo aj org-wide pozície INEJ organizácie.
  const requiredLeaderPositionRows = await tx
    .select({ id: positions.id })
    .from(positions)
    .where(
      and(
        eq(positions.orgId, workplace.orgId),
        or(eq(positions.workplaceId, workplaceId), isNull(positions.workplaceId)),
        eq(positions.requiresShiftLeader, true),
        eq(positions.isActive, true),
      ),
    );
  const positionsRequiringShiftLeader = requiredLeaderPositionRows.map((p) => p.id);

  // --- 5. coverage_requirements → CoverageNeed[] (9d-4) ---
  const coverageRows = await tx.select().from(coverageRequirements).where(and(eq(coverageRequirements.workplaceId, workplaceId), eq(coverageRequirements.isActive, true)));
  const templateById = new Map(templateRows.map((t) => [t.id, t]));
  const coverageNeeds: CoverageNeed[] = [];
  for (const r of coverageRows) {
    const template = r.shiftTemplateId ? templateById.get(r.shiftTemplateId) : undefined;
    if (!template) continue; // bez väzby na AKTÍVNU šablónu — generátor toto pravidlo nevidí, viď funkčný komentár vyššie
    coverageNeeds.push({
      positionId: r.positionId,
      minPeople: r.minPeople,
      weekdays: r.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
      appliesHolidays: r.appliesHolidays,
      isHard: r.isHard,
      shiftTemplateId: template.id,
      startTime: template.startTime,
      endTime: template.endTime,
      crossesMidnight: template.crossesMidnight,
      breakMinutes: template.breakMinutes,
    });
  }

  // --- 6. Absencie (SCHVÁLENÉ AJ NESCHVÁLENÉ — obe blokujú, viď generate.ts AbsenceEntry) ---
  const absenceRows = await tx.select().from(absences).where(and(eq(absences.workplaceId, workplaceId), gte(absences.date, monthStart), lte(absences.date, monthEnd)));
  const generateAbsences: AbsenceEntry[] = absenceRows.map((a) => ({ employeeId: a.employeeId, date: a.date }));

  // --- 7. Zatvorené dni prevádzky ---
  const closureRows = await tx.select().from(workplaceClosures).where(and(eq(workplaceClosures.workplaceId, workplaceId), gte(workplaceClosures.date, monthStart), lte(workplaceClosures.date, monthEnd)));
  const closedDates = closureRows.map((c) => c.date);

  // --- 8. Štátne sviatky (nie sú viazané na org/workplace) ---
  const holidayRows = await tx.select().from(holidays).where(and(gte(holidays.date, monthStart), lte(holidays.date, monthEnd)));
  const holidayDates = holidayRows.map((h) => h.date);

  // --- 9. Zamknuté zmeny → LockedShift[] (generátor sa ich NIKDY nedotkne) ---
  const lockedRows =
    employeeIds.length === 0
      ? []
      : await tx
          .select()
          .from(scheduledShifts)
          .where(
            and(
              eq(scheduledShifts.workplaceId, workplaceId),
              gte(scheduledShifts.date, monthStart),
              lte(scheduledShifts.date, monthEnd),
              eq(scheduledShifts.locked, true),
            ),
          );
  const generateLockedShifts: LockedShift[] = lockedRows.map((s) => ({
    employeeId: s.employeeId,
    date: s.date,
    positionId: positionByEmployee.get(s.employeeId) ?? null,
    startTime: s.startTime,
    endTime: s.endTime,
    crossesMidnight: s.crossesMidnight,
    breakMinutes: s.breakMinutes,
  }));

  // --- 10. Blok 15 (Stage 2a) — párovanie zamestnancov. Nezávislé od pozície
  // AJ prevádzky (schema.ts) — preto sa NEFILTRUJE na workplaceId, len na
  // employeeId (párov, kde je aspoň jeden z dvojice zamestnancom TEJTO
  // prevádzky tento mesiac). Partner môže pokojne byť z inej prevádzky.
  const pairingRows =
    employeeIds.length === 0
      ? []
      : await tx
          .select()
          .from(employeePairings)
          .where(and(eq(employeePairings.isActive, true), or(inArray(employeePairings.employeeAId, employeeIds), inArray(employeePairings.employeeBId, employeeIds))));
  const generatePairings: EmployeePairingInput[] = pairingRows.map((p) => ({ employeeAId: p.employeeAId, employeeBId: p.employeeBId, isHard: p.isHard }));

  // Partneri MIMO tejto prevádzky (generátor pre nich tu negeneruje) — ich UŽ
  // uložené zmeny za cieľový mesiac, na mäkké skóre "partner v ten deň pracuje"
  // (viď `ExternalPartnerShift` v generate.ts — READ-ONLY snímka).
  const employeeIdSet = new Set(employeeIds);
  const externalPartnerIds = [
    ...new Set(pairingRows.flatMap((p) => [p.employeeAId, p.employeeBId]).filter((id) => !employeeIdSet.has(id))),
  ];
  const externalShiftRows =
    externalPartnerIds.length === 0
      ? []
      : await tx
          .select({ employeeId: scheduledShifts.employeeId, date: scheduledShifts.date })
          .from(scheduledShifts)
          .where(and(inArray(scheduledShifts.employeeId, externalPartnerIds), gte(scheduledShifts.date, monthStart), lte(scheduledShifts.date, monthEnd)));
  const generateExternalPartnerShifts: ExternalPartnerShift[] = externalShiftRows.map((r) => ({ employeeId: r.employeeId, date: r.date }));

  // Blok 15 (Stage 3a) — mená a absencie externých partnerov, LEN tie, čo
  // TOMUTO behu skutočne RLS ukáže (`emp_select`/`absences_select` — manažér
  // obmedzený na inú prevádzku dostane pre neviditeľného partnera jednoducho
  // 0 riadkov, nie chybu). `generate.ts` (`verifiedEmployeeIds`) toto berie
  // ako signál "neoveriteľné" a hard-pair kontrolu preň VÔBEC nevynúti —
  // nikdy nesmie neviditeľnosť dát vyzerať ako "partner nepracuje".
  const externalPartnerNameRows =
    externalPartnerIds.length === 0
      ? []
      : await tx.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName }).from(employees).where(inArray(employees.id, externalPartnerIds));
  const generateExternalPartnerNames = externalPartnerNameRows.map((r) => ({ employeeId: r.id, name: `${r.firstName} ${r.lastName}` }));

  const externalPartnerAbsenceRows =
    externalPartnerIds.length === 0
      ? []
      : await tx
          .select({ employeeId: absences.employeeId, date: absences.date })
          .from(absences)
          .where(and(inArray(absences.employeeId, externalPartnerIds), gte(absences.date, monthStart), lte(absences.date, monthEnd)));
  const generateExternalPartnerAbsences: AbsenceEntry[] = externalPartnerAbsenceRows.map((r) => ({ employeeId: r.employeeId, date: r.date }));

  const input: GenerateInput = {
    workplaceId,
    year,
    month,
    employees: generateEmployees,
    coverageNeeds,
    legalRules: generateLegalRules,
    lockedShifts: generateLockedShifts,
    absences: generateAbsences,
    closedDates,
    holidayDates,
    pairings: generatePairings,
    externalPartnerShifts: generateExternalPartnerShifts,
    externalPartnerNames: generateExternalPartnerNames,
    externalPartnerAbsences: generateExternalPartnerAbsences,
    positionsRequiringShiftLeader,
  };

  return {
    input,
    counts: {
      employees: generateEmployees.length,
      availabilityRules: ruleRows.length,
      shiftTemplates: templateRows.length,
      legalRules: generateLegalRules.length,
      coverageRequirementsRaw: coverageRows.length,
      coverageNeedsUsable: coverageNeeds.length,
      absences: generateAbsences.length,
      workplaceClosures: closedDates.length,
      holidays: holidayDates.length,
      lockedShifts: generateLockedShifts.length,
      pairings: generatePairings.length,
    },
  };
}
