-- ============================================================================
-- OPRAVA: Supabase automaticky zapína Row Level Security na KAŽDEJ novej
-- tabuľke (platformový default, nie správanie vanilla Postgresu). schema.sql
-- (sekcia 10) zámerne zapína RLS len na 9 tabuľkách — všetky ostatné mali byť
-- bez RLS, čítateľné cez bežné GRANTy (lib/db/migrations/0002_app_role_grants.sql).
--
-- Dôsledok, kým toto nebolo opravené: RLS politiky ako emp_select/rate_select
-- robia vnútri seba EXISTS (SELECT 1 FROM employee_workplaces ...) —
-- a keďže employee_workplaces malo RLS zapnuté BEZ policy, ten EXISTS bol
-- vždy false. Výsledok: manažér nevidel VÔBEC ŽIADNYCH zamestnancov (nielen
-- cudzích) — presne to ticho-zlé správanie, ktorému má RLS zabraňovať.
--
-- Táto migrácia vypína RLS na všetkých tabuľkách OKREM tých 9 zo schema.sql,
-- čím obnovuje presne zamýšľané správanie.
-- ============================================================================

ALTER TABLE absence_attachments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_requirements      DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_position_history  DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_shift_templates   DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_workplaces        DISABLE ROW LEVEL SECURITY;
ALTER TABLE generation_runs            DISABLE ROW LEVEL SECURITY;
ALTER TABLE holidays                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE legal_rules                DISABLE ROW LEVEL SECURITY;
ALTER TABLE login_events               DISABLE ROW LEVEL SECURITY;
ALTER TABLE manager_workplaces         DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications              DISABLE ROW LEVEL SECURITY;
ALTER TABLE organizations              DISABLE ROW LEVEL SECURITY;
ALTER TABLE positions                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE punch_correction_requests  DISABLE ROW LEVEL SECURITY;
ALTER TABLE qr_tokens                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedules                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates            DISABLE ROW LEVEL SECURITY;
ALTER TABLE terminals                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE users                      DISABLE ROW LEVEL SECURITY;
ALTER TABLE vacation_balances          DISABLE ROW LEVEL SECURITY;
ALTER TABLE workplace_closures         DISABLE ROW LEVEL SECURITY;
ALTER TABLE workplaces                 DISABLE ROW LEVEL SECURITY;
