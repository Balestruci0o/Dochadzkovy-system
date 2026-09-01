-- ============================================================================
-- Granulárne pravomoci manažérov — Fáza 4 (Mzdy), POSLEDNÁ.
--
-- view_wages — JEDINÁ politika v celej tejto funkcii, čo sa SPRÍSŇUJE
-- (všetky ostatné len otvárali niečo, čo bolo predtým zamknuté). Default
-- stĺpca aj has_manager_permission() fallback sú TRUE (Fáza 1) — existujúci
-- manažér bez riadku má PRESNE dnešné správanie, nič sa mu nemení.
--
-- Zmena je PRESNE cielená — pridáva sa `AND has_manager_permission('view_wages')`
-- LEN do MANAŽÉRSKEJ vetvy (`current_user_role() = 'manager'`), nie do
-- owner/accountant/self vetiev. Účtovníčka VIDÍ VŽDY, bez ohľadu na balíčky —
-- to je jej práca, nie je to súčasť systému pravomocí manažérov.
--
-- edit_wages — rate_write/salary_write boli doteraz `USING (is_owner())`
-- BEZ vlastnej scoping vetvy pre manažéra vôbec. Nová vetva kopíruje PRESNE
-- ten istý employee_workplaces/accessible_workplaces() vzor ako
-- rate_select/salary_select (scoping na vlastnú prevádzku, "ako dnes" pre
-- read).
-- ============================================================================

DROP POLICY rate_select ON employee_rate_history;
CREATE POLICY rate_select ON employee_rate_history FOR SELECT USING (
  is_owner()
  OR current_user_role() = 'accountant'
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_rate_history.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
        AND current_user_role() = 'manager'
        AND has_manager_permission('view_wages')
     )
  OR employee_id = current_employee_id()
);

DROP POLICY rate_write ON employee_rate_history;
CREATE POLICY rate_write ON employee_rate_history FOR ALL USING (
  is_owner()
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_rate_history.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
        AND current_user_role() = 'manager'
        AND has_manager_permission('edit_wages')
     )
) WITH CHECK (
  is_owner()
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_rate_history.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
        AND current_user_role() = 'manager'
        AND has_manager_permission('edit_wages')
     )
);

DROP POLICY salary_select ON employee_salary_history;
CREATE POLICY salary_select ON employee_salary_history FOR SELECT USING (
  is_owner()
  OR current_user_role() = 'accountant'
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_salary_history.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
        AND current_user_role() = 'manager'
        AND has_manager_permission('view_wages')
     )
  OR employee_id = current_employee_id()
);

DROP POLICY salary_write ON employee_salary_history;
CREATE POLICY salary_write ON employee_salary_history FOR ALL USING (
  is_owner()
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_salary_history.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
        AND current_user_role() = 'manager'
        AND has_manager_permission('edit_wages')
     )
) WITH CHECK (
  is_owner()
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_salary_history.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
        AND current_user_role() = 'manager'
        AND has_manager_permission('edit_wages')
     )
);
