-- ============================================================================
-- Blok 6 (Kalendár rozvrhu) — `absences` malo RLS zapnuté od 0001_raw_
-- triggers_rls.sql, ale nikdy nedostalo ani jednu policy (fail-safe: appka
-- (app_user) doteraz nevidela ani nemohla zapísať žiadny riadok). Kalendár
-- potrebuje priamy zápis absencie z bunky (manažér klikne "Dovolenka" —
-- Blok 10 nad tým neskôr postaví plný request/schvaľovací tok, ale
-- materializovaný stav v `absences` musí byť zapisovateľný už teraz).
-- Rovnaký tvar ako sched_select/sched_write pre scheduled_shifts.
-- ============================================================================

CREATE POLICY absences_select ON absences FOR SELECT USING (
  is_owner()
  OR workplace_id IN (SELECT accessible_workplaces())
  OR employee_id = current_employee_id()
);

CREATE POLICY absences_write ON absences FOR ALL USING (
  (is_owner() OR current_user_role() = 'manager')
  AND workplace_id IN (SELECT accessible_workplaces())
) WITH CHECK (
  (is_owner() OR current_user_role() = 'manager')
  AND workplace_id IN (SELECT accessible_workplaces())
);
