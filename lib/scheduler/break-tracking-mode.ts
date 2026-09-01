/**
 * Pípanie prestávok, krok 2 — kto si prestávky reálne PÍPA vs. komu sa vždy
 * odpočíta AUTOMATICKY zo šablóny/priradenia. Default žije na POZÍCII
 * (`positions.break_tracking_mode`), zamestnanec ho smie prepísať
 * (`employees.override_break_tracking_mode`) — rovnaký vzor ako
 * `lib/scheduler/work-time-mode.ts`. Čistá funkcia — žiadna DB.
 */

export type BreakTrackingMode = "automaticky" | "pipa";

export function resolveBreakTrackingMode(
  position: { breakTrackingMode: BreakTrackingMode } | null,
  employeeOverride: { overrideBreakTrackingMode: BreakTrackingMode | null },
): BreakTrackingMode {
  return employeeOverride.overrideBreakTrackingMode ?? position?.breakTrackingMode ?? "automaticky";
}
