/**
 * Manažér pri priraďovaní zmeny môže prepísať default prestávky zo šablóny
 * (`shift_templates.break_minutes`) individuálne pre TOTO priradenie —
 * rovnaký princíp ako `employee_shift_templates.override_break_min`, len
 * materializovaný priamo do `scheduled_shifts.break_minutes` (tá tabuľka
 * nemá "override" stĺpec navyše, každé priradenie si nesie svoju konkrétnu
 * hodnotu — rovnako ako `start_time`/`end_time`, ktoré tiež nie sú živý
 * odkaz na šablónu, len jej hodnota v čase priradenia).
 */
export function resolveBreakOverride(raw: FormDataEntryValue | null, templateDefault: number): number {
  if (raw === null || raw === "") return templateDefault;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return templateDefault;
  return Math.round(n);
}
