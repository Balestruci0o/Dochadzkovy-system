/**
 * Blok A1 — režim pracovného času (§87 ZP: rovnomerne vs. nerovnomerne
 * rozvrhnutý pracovný čas). VÝHRADNE na zamestnancovi (`employees.work_time_mode`/
 * `balancing_period_months`) — pozícia do toho už vôbec nehovorí (predošlý
 * "default na pozícii, prepis na zamestnancovi" vzor bol zámerne opustený).
 * Čistá funkcia — žiadna DB.
 */

export type WorkTimeMode = "rovnomerny" | "nerovnomerny_turnus";

export type ResolvedWorkTimeMode = {
  mode: WorkTimeMode;
  /** Zmysluplné len pri `nerovnomerny_turnus` — počet mesiacov vyrovnávacieho obdobia (§87 ZP). */
  balancingPeriodMonths: number;
};

export function resolveWorkTimeMode(employee: {
  workTimeMode: WorkTimeMode;
  balancingPeriodMonths: number;
}): ResolvedWorkTimeMode {
  return { mode: employee.workTimeMode, balancingPeriodMonths: employee.balancingPeriodMonths };
}
