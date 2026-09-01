-- ============================================================================
-- Fixný plat namiesto hodinovej sadzby — Fáza 1 (dátový model + história).
--
-- Réžim odmeňovania: default na pozícii, prepísateľný na zamestnancovi
-- (NULL = zdedené) — PRESNE vzor break_tracking_mode (migrácia 0001 pre
-- positions.break_tracking_mode / employees.override_break_tracking_mode),
-- NIE work_time_mode (ten je výhradne na zamestnancovi bez dedenia z
-- pozície, vedome opustený vzor — migrácia 0015). "hodinovy" default
-- zachováva PRESNE dnešné správanie pre všetky existujúce riadky.
--
-- Fix + variabilná zložka: NOVÁ tabuľka employee_salary_history, ZÁMERNE
-- nie rozšírenie employee_rate_history — ten je overený/citlivý mzdový
-- výpočet (lib/payroll/calculate.ts::getRateAt), jeho tvar sa nemení. Rovnaký
-- vzor histórie (EXCLUDE constraint proti prekrývajúcim sa obdobiam), ale
-- BEZ workplace_id — fixný plat je vlastnosť ČLOVEKA, nie prevádzky.
--
-- Kotviaci dátum pri výpočte mzdy z tejto histórie (getSalaryAt, Fáza 3):
-- RAZ za mesiac, hodnota platná KU KONCU vykazovaného mesiaca — fix je
-- mesačný paušál, žiadne prorátovanie naprieč mesiacom. Zmena režimu
-- uprostred mesiaca → celý mesačný výkaz sa riadi AKTUÁLNYM (v čase
-- generovania výkazu) nastaveným režimom, rovnako ako break_tracking_mode/
-- work_time_mode dnes nie sú historizované.
-- ============================================================================

CREATE TYPE pay_mode AS ENUM ('hodinovy', 'fixny');

ALTER TABLE positions
  ADD COLUMN pay_mode pay_mode NOT NULL DEFAULT 'hodinovy';

ALTER TABLE employees
  ADD COLUMN override_pay_mode pay_mode;

CREATE TABLE employee_salary_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fix_amount numeric(10, 2) NOT NULL,
  variable_amount numeric(10, 2) NOT NULL DEFAULT 0,
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

ALTER TABLE employee_salary_history
  ADD CONSTRAINT employee_salary_history_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  );

-- ----------------------------------------------------------------------------
-- RLS — presne vzor employee_rate_history (migrácia 0001, rate_select/
-- rate_write): owner vidí/píše všetko, účtovníčka a manažér (s prístupom na
-- prevádzku zamestnanca) vidia, zamestnanec vidí VLASTNÝ fixný plat. Zápis
-- len owner (rovnaké zdôvodnenie ako pri sadzbách — mzdový údaj).
-- ----------------------------------------------------------------------------
ALTER TABLE employee_salary_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY salary_select ON employee_salary_history FOR SELECT USING (
  is_owner()
  OR current_user_role() = 'accountant'
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_salary_history.employee_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
        AND current_user_role() = 'manager'
     )
  OR employee_id = current_employee_id()
);

CREATE POLICY salary_write ON employee_salary_history FOR ALL USING (is_owner());

-- Audit log — rovnaký vzor ako audit_rates.
CREATE TRIGGER audit_salary_history AFTER INSERT OR UPDATE OR DELETE ON employee_salary_history
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
