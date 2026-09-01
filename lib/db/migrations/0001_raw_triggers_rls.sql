-- ============================================================================
-- Raw SQL migrácia — veci, ktoré Drizzle nevie vygenerovať zo schémy:
--   1. EXCLUDE USING gist (prekrývajúce sa obdobia histórie)
--   2. Immutable trigger na punch_events (append-only)
--   3. Audit log trigger
--   4. RLS pomocné funkcie, politiky
--
-- Prevzaté 1:1 zo schema.sql, sekcie 3, 8, 10.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXCLUDE CONSTRAINTS — história pozícií a sadzieb sa nesmie prekrývať
-- ----------------------------------------------------------------------------
ALTER TABLE "employee_position_history"
  ADD CONSTRAINT employee_position_history_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  );

ALTER TABLE "employee_rate_history"
  ADD CONSTRAINT employee_rate_history_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    COALESCE(workplace_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  );

-- ----------------------------------------------------------------------------
-- 2. PUNCH_EVENTS SÚ IMMUTABLE (append-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION punch_events_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'punch_events je append-only: UPDATE/DELETE nie je povolené. Použi opravnú udalosť (corrects_event_id).';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_punch_no_update BEFORE UPDATE ON punch_events
  FOR EACH ROW EXECUTE FUNCTION punch_events_immutable();
CREATE TRIGGER trg_punch_no_delete BEFORE DELETE ON punch_events
  FOR EACH ROW EXECUTE FUNCTION punch_events_immutable();

-- ----------------------------------------------------------------------------
-- 3. AUDIT LOG — zapisuje trigger, nie aplikácia
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS trigger AS $$
DECLARE
  actor uuid;
BEGIN
  -- ID používateľa nastaví aplikácia cez SET LOCAL app.user_id
  BEGIN
    actor := current_setting('app.user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    actor := NULL;
  END;

  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id::text, OLD.id::text),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
    actor
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_attendance AFTER INSERT OR UPDATE OR DELETE ON attendance_days
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER audit_shifts AFTER INSERT OR UPDATE OR DELETE ON scheduled_shifts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER audit_absences AFTER INSERT OR UPDATE OR DELETE ON absence_requests
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER audit_rates AFTER INSERT OR UPDATE OR DELETE ON employee_rate_history
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER audit_rules AFTER INSERT OR UPDATE OR DELETE ON employee_availability_rules
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS user_role AS $$
  SELECT role FROM users WHERE id = current_user_id();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_owner() RETURNS boolean AS $$
  SELECT current_user_role() = 'owner';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION accessible_workplaces() RETURNS SETOF uuid AS $$
  SELECT w.id FROM workplaces w
  JOIN users u ON u.id = current_user_id()
  WHERE u.role IN ('owner','accountant') AND w.org_id = u.org_id
  UNION
  SELECT mw.workplace_id FROM manager_workplaces mw
  WHERE mw.user_id = current_user_id()
  UNION
  SELECT ew.workplace_id FROM employee_workplaces ew
  JOIN employees e ON e.id = ew.employee_id
  WHERE e.user_id = current_user_id();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_employee_id() RETURNS uuid AS $$
  SELECT id FROM employees WHERE user_id = current_user_id();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

ALTER TABLE employees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_days      ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_shifts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences             ENABLE ROW LEVEL SECURITY;
ALTER TABLE punch_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_violations  ENABLE ROW LEVEL SECURITY;

-- --- ZAMESTNANCI ---
CREATE POLICY emp_select ON employees FOR SELECT USING (
  is_owner()
  OR EXISTS (
    SELECT 1 FROM employee_workplaces ew
    WHERE ew.employee_id = employees.id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  )
);

CREATE POLICY emp_write ON employees FOR ALL USING (
  is_owner()
  OR (current_user_role() = 'manager' AND EXISTS (
        SELECT 1 FROM employee_workplaces ew
        WHERE ew.employee_id = employees.id
          AND ew.workplace_id IN (SELECT accessible_workplaces())
      ))
);

-- --- DOCHÁDZKA ---
CREATE POLICY att_select ON attendance_days FOR SELECT USING (
  is_owner()
  OR workplace_id IN (SELECT accessible_workplaces())
  OR employee_id = current_employee_id()
);

CREATE POLICY att_write ON attendance_days FOR UPDATE USING (
  (is_owner() OR current_user_role() = 'manager')
  AND workplace_id IN (SELECT accessible_workplaces())
  AND is_locked = false
);

-- --- ROZVRH ---
CREATE POLICY sched_select ON scheduled_shifts FOR SELECT USING (
  is_owner()
  OR workplace_id IN (SELECT accessible_workplaces())
  OR employee_id = current_employee_id()
);

CREATE POLICY sched_write ON scheduled_shifts FOR ALL USING (
  (is_owner() OR current_user_role() = 'manager')
  AND workplace_id IN (SELECT accessible_workplaces())
);

-- --- ŽIADOSTI ---
CREATE POLICY req_select ON absence_requests FOR SELECT USING (
  is_owner()
  OR workplace_id IN (SELECT accessible_workplaces())
  OR employee_id = current_employee_id()
);

CREATE POLICY req_insert ON absence_requests FOR INSERT WITH CHECK (
  is_owner()
  OR (current_user_role() = 'manager'
      AND workplace_id IN (SELECT accessible_workplaces()))
  OR employee_id = current_employee_id()
);

CREATE POLICY req_update ON absence_requests FOR UPDATE USING (
  (
    (is_owner() OR current_user_role() = 'manager')
    AND workplace_id IN (SELECT accessible_workplaces())
  )
  OR (
    employee_id = current_employee_id()
    AND status = 'pending'
  )
);

-- --- MZDOVÉ SADZBY ---
CREATE POLICY rate_select ON employee_rate_history FOR SELECT USING (
  is_owner()
  OR current_user_role() = 'accountant'
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_rate_history.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
        AND current_user_role() = 'manager'
     )
  OR employee_id = current_employee_id()
);

CREATE POLICY rate_write ON employee_rate_history FOR ALL USING (is_owner());

-- --- RAZÍTKA --- (čítanie; zápis ide cez service role, nie cez klienta)
CREATE POLICY punch_select ON punch_events FOR SELECT USING (
  is_owner()
  OR workplace_id IN (SELECT accessible_workplaces())
  OR employee_id = current_employee_id()
);

-- --- PRAVIDLÁ DOSTUPNOSTI ---
CREATE POLICY rules_select ON employee_availability_rules FOR SELECT USING (
  is_owner()
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_availability_rules.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
     )
  OR employee_id = current_employee_id()
);

CREATE POLICY rules_write ON employee_availability_rules FOR ALL USING (
  is_owner()
  OR (current_user_role() = 'manager' AND EXISTS (
        SELECT 1 FROM employee_workplaces ew
        WHERE ew.employee_id = employee_availability_rules.employee_id
          AND ew.workplace_id IN (SELECT accessible_workplaces())
      ))
);

-- --- PORUŠENIA ---
CREATE POLICY viol_select ON schedule_violations FOR SELECT USING (
  is_owner()
  OR EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_violations.schedule_id
        AND s.workplace_id IN (SELECT accessible_workplaces())
     )
);
