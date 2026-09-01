/**
 * Režim odchodu — kto si odchod reálne PÍPA vs. komu ho systém AUTO-pípne na
 * konci plánovanej zmeny. Default žije na POZÍCII (`positions.departure_mode`),
 * zamestnanec ho smie prepísať (`employees.override_departure_mode`) —
 * rovnaký vzor ako `lib/scheduler/break-tracking-mode.ts`. Čistá funkcia —
 * žiadna DB.
 *
 * Rieši VÝHRADNE odchod (koniec zmeny). Prestávkový dôkaz (odišiel na
 * prestávku, nevrátil sa → uzavrie sa v čase odchodu na prestávku) platí pre
 * VŠETKÝCH nezávisle od tohto nastavenia — viď lib/punch/auto-close.ts.
 */

export type DepartureMode = "pipa" | "nepipa";

export function resolveDepartureMode(
  position: { departureMode: DepartureMode } | null,
  employeeOverride: { overrideDepartureMode: DepartureMode | null },
): DepartureMode {
  return employeeOverride.overrideDepartureMode ?? position?.departureMode ?? "pipa";
}
