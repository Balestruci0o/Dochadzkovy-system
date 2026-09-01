/**
 * Fixný plat namiesto hodinovej sadzby — Fáza 1. Default žije na POZÍCII
 * (`positions.pay_mode`), zamestnanec ho smie prepísať
 * (`employees.override_pay_mode`) — rovnaký vzor ako
 * `lib/scheduler/break-tracking-mode.ts` (NIE `work-time-mode.ts`, ten je
 * výhradne na zamestnancovi bez dedenia z pozície). Čistá funkcia — žiadna DB.
 */

export type PayMode = "hodinovy" | "fixny";

export function resolvePayMode(
  position: { payMode: PayMode } | null,
  employeeOverride: { overridePayMode: PayMode | null },
): PayMode {
  return employeeOverride.overridePayMode ?? position?.payMode ?? "hodinovy";
}
