import { and, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { employeeAvailabilityRules, employees, legalRules, scheduledShifts, workplaces } from "@/lib/db/schema";
import { addDays } from "@/lib/shared/dates";
import { evaluateRules, type CandidateShift, type RuleViolation } from "./rules";
import { resolveWorkTimeMode } from "./work-time-mode";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Q3 — "obsaď aj tak, len upozorni". Manuálne priradenie z
 * kalendára (`assignShiftAction`) dnes vôbec nekontrolovalo pravidlá — vložilo
 * ZAMKNUTÚ zmenu bez ohľadu na §ZP/dostupnosť, úplne potichu. Táto funkcia
 * spustí PRESNE ten istý `evaluateRules` (rules.ts), ktorý používa generátor
 * (Blok 9), na JEDNU konkrétnu manuálnu zmenu — aby manažér VIDEL, čo by
 * porušil, PRED tým, než sa rozhodne (a nie generátor sám za neho —
 * zákaz "najmenšieho zla" platí pre AUTOMATICKÉ generovanie, nie pre
 * vedomé manuálne rozhodnutie manažéra, ktorý smie vedome obsadiť aj cez
 * porušenie).
 *
 * Okno `existingShifts` (−21/+7 dní okolo `date`) je veľkorysá rezerva nad
 * realistický `block_length`/týždenný súčet (rovnaká úvaha ako
 * `PRIOR_MONTH_TAIL_DAYS` v `db-loader.ts`) — nie celý mesiac, aby dopyt
 * zostal lacný pre jednorazovú kontrolu jedného kliku.
 */
const CONTEXT_WINDOW_BEFORE_DAYS = 21;
const CONTEXT_WINDOW_AFTER_DAYS = 7;

export async function checkManualAssignment(
  tx: Db,
  params: { employeeId: string; workplaceId: string; date: string; shift: CandidateShift },
): Promise<RuleViolation[]> {
  const [employee] = await tx.select().from(employees).where(eq(employees.id, params.employeeId));
  if (!employee) return [];

  const [workplace] = await tx.select().from(workplaces).where(eq(workplaces.id, params.workplaceId));
  if (!workplace) return [];

  const workTimeMode = resolveWorkTimeMode({
    workTimeMode: employee.workTimeMode,
    balancingPeriodMonths: employee.balancingPeriodMonths,
  }).mode;

  const ruleRows = await tx
    .select()
    .from(employeeAvailabilityRules)
    .where(
      and(
        eq(employeeAvailabilityRules.employeeId, params.employeeId),
        eq(employeeAvailabilityRules.isActive, true),
        or(isNull(employeeAvailabilityRules.workplaceId), eq(employeeAvailabilityRules.workplaceId, params.workplaceId)),
        or(isNull(employeeAvailabilityRules.validFrom), lte(employeeAvailabilityRules.validFrom, params.date)),
        or(isNull(employeeAvailabilityRules.validTo), gte(employeeAvailabilityRules.validTo, params.date)),
      ),
    );

  const legalRuleRows = await tx.select().from(legalRules).where(and(eq(legalRules.orgId, workplace.orgId), eq(legalRules.isActive, true)));

  const windowStart = addDays(params.date, -CONTEXT_WINDOW_BEFORE_DAYS);
  const windowEnd = addDays(params.date, CONTEXT_WINDOW_AFTER_DAYS);
  const existingShiftRows = await tx
    .select({ date: scheduledShifts.date, startTime: scheduledShifts.startTime, endTime: scheduledShifts.endTime, crossesMidnight: scheduledShifts.crossesMidnight, breakMinutes: scheduledShifts.breakMinutes })
    .from(scheduledShifts)
    .where(
      and(
        eq(scheduledShifts.employeeId, params.employeeId),
        eq(scheduledShifts.workplaceId, params.workplaceId),
        gte(scheduledShifts.date, windowStart),
        lte(scheduledShifts.date, windowEnd),
        ne(scheduledShifts.date, params.date), // nahrádzame TENTO deň — jeho stará hodnota (ak existuje) sa nesmie počítať dvakrát
      ),
    );

  return evaluateRules(
    { id: employee.id, name: `${employee.firstName} ${employee.lastName}` },
    params.date,
    params.shift,
    {
      rules: ruleRows.map((r) => ({ ruleType: r.ruleType, params: r.params as Record<string, unknown>, isHard: r.isHard, priority: r.priority })),
      legalRules: legalRuleRows.map((r) => ({ code: r.code, params: r.params as Record<string, unknown>, isHard: r.isHard })),
      existingShifts: existingShiftRows,
      workTimeMode,
    },
  );
}
