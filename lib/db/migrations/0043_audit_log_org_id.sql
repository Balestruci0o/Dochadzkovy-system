-- ============================================================================
-- Audit log UI — `audit_trigger()` doteraz `org_id` vôbec
-- nezapisoval (INSERT stĺpec chýbal), takže bol vo VŠETKÝCH riadkoch NULL.
-- RLS zostáva `is_owner()` bez zmeny (owner je v CELOM tomto schéme globálna,
-- nie org-scoped rola — rovnaký vzor ako `sched_select`, `published_shifts_select`
-- a každá ďalšia "owner vidí všetko" politika; robiť z audit_log jedinú
-- výnimku by bola nekonzistencia, nie oprava). `org_id` sa dopĺňa LEN pre
-- budúce filtrovanie/zobrazenie v UI, nie ako nová RLS hranica.
--
-- Odvodenie org_id z riadku (JSONB, aby to fungovalo pre KAŽDÚ auditovanú
-- tabuľku bez per-tabuľkovej vetvy v kóde):
--   1. priamo stĺpec `org_id` na riadku (employees),
--   2. inak cez `employee_id` → employees.org_id (attendance_days,
--      scheduled_shifts, absence_requests, employee_rate_history,
--      employee_availability_rules, punch_events),
--   3. inak cez `employee_a_id` → employees.org_id (employee_pairings —
--      jediná auditovaná tabuľka bez `employee_id`, má pár `employee_a_id`/
--      `employee_b_id`, org oboch je vždy rovnaká, stačí jeden),
--   4. inak cez `workplace_id` → workplaces.org_id (rezerva pre budúce
--      auditované tabuľky, ktoré majú workplace_id, ale nie employee_id).
-- Staré riadky (org_id už zapísaný ako NULL) sa spätne NEDOPĹŇAJÚ — pri 87k+
-- riadkoch prevažne testovacieho šumu by to bol drahý dobeh bez reálnej
-- hodnoty (audit UI sa bez org_id v starých riadkoch zaobíde, viď data.ts).
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS trigger AS $$
DECLARE
  actor uuid;
  row_data jsonb;
  resolved_org_id uuid;
BEGIN
  -- ID používateľa nastaví aplikácia cez SET LOCAL app.user_id
  BEGIN
    actor := current_setting('app.user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    actor := NULL;
  END;

  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  resolved_org_id := NULLIF(row_data->>'org_id', '')::uuid;

  IF resolved_org_id IS NULL AND row_data ? 'employee_id' THEN
    SELECT org_id INTO resolved_org_id FROM employees WHERE id = NULLIF(row_data->>'employee_id', '')::uuid;
  END IF;

  IF resolved_org_id IS NULL AND row_data ? 'employee_a_id' THEN
    SELECT org_id INTO resolved_org_id FROM employees WHERE id = NULLIF(row_data->>'employee_a_id', '')::uuid;
  END IF;

  IF resolved_org_id IS NULL AND row_data ? 'workplace_id' THEN
    SELECT org_id INTO resolved_org_id FROM workplaces WHERE id = NULLIF(row_data->>'workplace_id', '')::uuid;
  END IF;

  INSERT INTO audit_log (org_id, table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    resolved_org_id,
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

-- Default zoradenie v audit UI je "najnovšie hore" bez ďalších filtrov —
-- existujúce indexy vedú (table_name, record_id, ...) alebo (changed_by, ...),
-- ani jeden nepomôže čistému `ORDER BY changed_at DESC` nad 87k+ riadkami.
CREATE INDEX ON audit_log (changed_at DESC);
