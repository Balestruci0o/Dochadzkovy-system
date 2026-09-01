-- ============================================================================
-- Blok A1 (turnusový pracovný čas, §87 ZP) — klient potrebuje aj
-- nerovnomerne rozvrhnutý pracovný čas (kontroluje sa priemer za
-- vyrovnávacie obdobie, nie tvrdý 40h strop na KAŽDÝ jednotlivý týždeň).
-- Predtým bol režim zadrátovaný (jediné správanie = rovnomerny) — teraz je
-- to konfigurácia: default na pozícii, prepísateľná na zamestnancovi
-- (rovnaký vzor ako employee_shift_templates.override_* — nullable prepis).
--
-- `rovnomerny` default na positions.work_time_mode zachováva PRESNE dnešné
-- správanie pre všetky existujúce riadky — žiadna tichá zmena chovania.
-- ============================================================================

CREATE TYPE work_time_mode AS ENUM ('rovnomerny', 'nerovnomerny_turnus');

ALTER TABLE positions
  ADD COLUMN work_time_mode work_time_mode NOT NULL DEFAULT 'rovnomerny',
  ADD COLUMN balancing_period_months integer NOT NULL DEFAULT 4;

ALTER TABLE employees
  ADD COLUMN override_work_time_mode work_time_mode,
  ADD COLUMN override_balancing_period_months integer;
