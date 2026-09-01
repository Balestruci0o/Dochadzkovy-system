-- ============================================================================
-- RLS na zvyšných 23 tabuľkách (opravuje medzeru z 0003_disable_default_rls.sql
-- — vtedy sme RLS len bezpečne vypli, teraz dopĺňame skutočné politiky podľa
-- štyroch skupín).
-- ============================================================================

CREATE OR REPLACE FUNCTION current_user_org_id() RETURNS uuid AS $$
  SELECT org_id FROM users WHERE id = current_user_id();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- A) ČÍSELNÍKY — číta každý prihlásený, mení len owner
-- ----------------------------------------------------------------------------

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY holidays_select ON holidays FOR SELECT USING (current_user_id() IS NOT NULL);
CREATE POLICY holidays_write ON holidays FOR ALL USING (is_owner()) WITH CHECK (is_owner());

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY positions_select ON positions FOR SELECT USING (current_user_id() IS NOT NULL);
CREATE POLICY positions_write ON positions FOR ALL USING (is_owner()) WITH CHECK (is_owner());

ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_templates_select ON shift_templates FOR SELECT USING (current_user_id() IS NOT NULL);
CREATE POLICY shift_templates_write ON shift_templates FOR ALL USING (is_owner()) WITH CHECK (is_owner());

ALTER TABLE workplaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY workplaces_select ON workplaces FOR SELECT USING (current_user_id() IS NOT NULL);
CREATE POLICY workplaces_write ON workplaces FOR ALL USING (is_owner()) WITH CHECK (is_owner());

ALTER TABLE workplace_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY workplace_closures_select ON workplace_closures FOR SELECT USING (current_user_id() IS NOT NULL);
CREATE POLICY workplace_closures_write ON workplace_closures FOR ALL USING (is_owner()) WITH CHECK (is_owner());

ALTER TABLE legal_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_rules_select ON legal_rules FOR SELECT USING (current_user_id() IS NOT NULL);
CREATE POLICY legal_rules_write ON legal_rules FOR ALL USING (is_owner()) WITH CHECK (is_owner());

ALTER TABLE coverage_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY coverage_requirements_select ON coverage_requirements FOR SELECT USING (current_user_id() IS NOT NULL);
CREATE POLICY coverage_requirements_write ON coverage_requirements FOR ALL USING (is_owner()) WITH CHECK (is_owner());

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_select ON organizations FOR SELECT USING (current_user_id() IS NOT NULL);
CREATE POLICY organizations_write ON organizations FOR ALL USING (is_owner()) WITH CHECK (is_owner());

-- ----------------------------------------------------------------------------
-- B) ODVODENÉ OD PRÍSTUPU K PREVÁDZKE — rovnaká logika ako emp_select/emp_write
-- ----------------------------------------------------------------------------

ALTER TABLE employee_workplaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_workplaces_select ON employee_workplaces FOR SELECT USING (
  is_owner() OR workplace_id IN (SELECT accessible_workplaces())
);
CREATE POLICY employee_workplaces_write ON employee_workplaces FOR ALL USING (
  is_owner() OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
) WITH CHECK (
  is_owner() OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
);

ALTER TABLE employee_shift_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_shift_templates_select ON employee_shift_templates FOR SELECT USING (
  is_owner() OR EXISTS (
    SELECT 1 FROM shift_templates st
    WHERE st.id = employee_shift_templates.shift_template_id
      AND st.workplace_id IN (SELECT accessible_workplaces())
  )
);
CREATE POLICY employee_shift_templates_write ON employee_shift_templates FOR ALL USING (
  is_owner() OR (current_user_role() = 'manager' AND EXISTS (
    SELECT 1 FROM shift_templates st
    WHERE st.id = employee_shift_templates.shift_template_id
      AND st.workplace_id IN (SELECT accessible_workplaces())
  ))
) WITH CHECK (
  is_owner() OR (current_user_role() = 'manager' AND EXISTS (
    SELECT 1 FROM shift_templates st
    WHERE st.id = employee_shift_templates.shift_template_id
      AND st.workplace_id IN (SELECT accessible_workplaces())
  ))
);

ALTER TABLE employee_position_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_position_history_select ON employee_position_history FOR SELECT USING (
  is_owner() OR EXISTS (
    SELECT 1 FROM employee_workplaces ew
    WHERE ew.employee_id = employee_position_history.employee_id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  )
);
CREATE POLICY employee_position_history_write ON employee_position_history FOR ALL USING (
  is_owner() OR (current_user_role() = 'manager' AND EXISTS (
    SELECT 1 FROM employee_workplaces ew
    WHERE ew.employee_id = employee_position_history.employee_id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  ))
) WITH CHECK (
  is_owner() OR (current_user_role() = 'manager' AND EXISTS (
    SELECT 1 FROM employee_workplaces ew
    WHERE ew.employee_id = employee_position_history.employee_id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  ))
);

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedules_select ON schedules FOR SELECT USING (
  is_owner() OR workplace_id IN (SELECT accessible_workplaces())
);
CREATE POLICY schedules_write ON schedules FOR ALL USING (
  is_owner() OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
) WITH CHECK (
  is_owner() OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
);

ALTER TABLE generation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY generation_runs_select ON generation_runs FOR SELECT USING (
  is_owner() OR workplace_id IN (SELECT accessible_workplaces())
);
CREATE POLICY generation_runs_write ON generation_runs FOR ALL USING (
  is_owner() OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
) WITH CHECK (
  is_owner() OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
);

ALTER TABLE vacation_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY vacation_balances_select ON vacation_balances FOR SELECT USING (
  is_owner() OR EXISTS (
    SELECT 1 FROM employee_workplaces ew
    WHERE ew.employee_id = vacation_balances.employee_id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  )
);
CREATE POLICY vacation_balances_write ON vacation_balances FOR ALL USING (
  is_owner() OR (current_user_role() = 'manager' AND EXISTS (
    SELECT 1 FROM employee_workplaces ew
    WHERE ew.employee_id = vacation_balances.employee_id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  ))
) WITH CHECK (
  is_owner() OR (current_user_role() = 'manager' AND EXISTS (
    SELECT 1 FROM employee_workplaces ew
    WHERE ew.employee_id = vacation_balances.employee_id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  ))
);

-- absence_attachments nemá vlastný workplace_id — odvodzuje sa cez
-- absence_requests (rovnaká viditeľnosť ako req_select: workplace prístup
-- ALEBO vlastná žiadosť zamestnanca).
ALTER TABLE absence_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY absence_attachments_select ON absence_attachments FOR SELECT USING (
  is_owner() OR EXISTS (
    SELECT 1 FROM absence_requests ar
    WHERE ar.id = absence_attachments.request_id
      AND (ar.workplace_id IN (SELECT accessible_workplaces()) OR ar.employee_id = current_employee_id())
  )
);
CREATE POLICY absence_attachments_insert ON absence_attachments FOR INSERT WITH CHECK (
  is_owner() OR EXISTS (
    SELECT 1 FROM absence_requests ar
    WHERE ar.id = absence_attachments.request_id
      AND (ar.workplace_id IN (SELECT accessible_workplaces()) OR ar.employee_id = current_employee_id())
  )
);
CREATE POLICY absence_attachments_delete ON absence_attachments FOR DELETE USING (is_owner());

-- punch_correction_requests: zamestnanec žiada (INSERT/SELECT vlastných),
-- manažér/owner rozhoduje (UPDATE) — rovnaký tvar ako absence_requests
-- (req_select/req_insert/req_update), lebo ide o identický tok
-- "zamestnanec žiada → manažér schváli" (docs/ARCHITECTURE.md, 3. Pípanie).
ALTER TABLE punch_correction_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY punch_correction_requests_select ON punch_correction_requests FOR SELECT USING (
  is_owner()
  OR employee_id = current_employee_id()
  OR EXISTS (
      SELECT 1 FROM attendance_days ad
      WHERE ad.id = punch_correction_requests.attendance_day_id
        AND ad.workplace_id IN (SELECT accessible_workplaces())
     )
);
CREATE POLICY punch_correction_requests_insert ON punch_correction_requests FOR INSERT WITH CHECK (
  is_owner() OR employee_id = current_employee_id()
);
CREATE POLICY punch_correction_requests_update ON punch_correction_requests FOR UPDATE USING (
  is_owner()
  OR (current_user_role() = 'manager' AND EXISTS (
      SELECT 1 FROM attendance_days ad
      WHERE ad.id = punch_correction_requests.attendance_day_id
        AND ad.workplace_id IN (SELECT accessible_workplaces())
     ))
);

ALTER TABLE manager_workplaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY manager_workplaces_select ON manager_workplaces FOR SELECT USING (
  is_owner() OR user_id = current_user_id()
);
CREATE POLICY manager_workplaces_write ON manager_workplaces FOR ALL USING (is_owner()) WITH CHECK (is_owner());

-- ----------------------------------------------------------------------------
-- C) LEN VLASTNÝ RIADOK
-- ----------------------------------------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON notifications FOR ALL USING (
  user_id = current_user_id()
) WITH CHECK (
  user_id = current_user_id()
);

-- users: vidí seba; owner vidí všetkých vo svojej organizácii.
-- Zápis (vrátane zmeny role) je zámerne obmedzený len na ownera — samoobslužná
-- úprava vlastného profilu (meno, telefón) môže dostať užšiu policy neskôr
-- (Blok 2), keď bude jasné, ktoré stĺpce smie meniť aj bežný používateľ.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select ON users FOR SELECT USING (
  id = current_user_id() OR (is_owner() AND org_id = current_user_org_id())
);
CREATE POLICY users_write ON users FOR ALL USING (
  is_owner() AND org_id = current_user_org_id()
) WITH CHECK (
  is_owner() AND org_id = current_user_org_id()
);

-- ----------------------------------------------------------------------------
-- D) ŽIADNY PRÍSTUP PRE BEŽNÉ ROLE — len service role (adminDb)
-- ----------------------------------------------------------------------------

-- terminals a qr_tokens: RLS zapnuté, ŽIADNA policy → appka (app_user) sem
-- nedostane ani jeden riadok. Prístup len cez lib/db/admin.ts (punch endpoint
-- po overení HMAC, docs/ARCHITECTURE.md sekcia 3).
ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON terminals FROM app_user;
REVOKE ALL ON qr_tokens FROM app_user;

-- audit_log a login_events: RLS zapnuté, žiadny zápis pre app_user (zapisuje
-- len SECURITY DEFINER trigger / service-role login handler), len SELECT pre ownera.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM app_user;
GRANT SELECT ON audit_log TO app_user;
-- POZN.: audit_log.org_id nikdy nevypĺňa trigger audit_trigger() (viď schema.sql) —
-- ostáva vždy NULL, takže filtrovanie podľa organizácie zatiaľ nie je možné.
-- Kým to nepríde na rad (trigger treba doplniť), owner vidí všetky riadky.
CREATE POLICY audit_log_select_owner ON audit_log FOR SELECT USING (is_owner());

ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON login_events FROM app_user;
GRANT SELECT ON login_events TO app_user;
CREATE POLICY login_events_select_owner ON login_events FOR SELECT USING (
  is_owner() AND (
    user_id IS NULL
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = login_events.user_id AND u.org_id = current_user_org_id())
  )
);
