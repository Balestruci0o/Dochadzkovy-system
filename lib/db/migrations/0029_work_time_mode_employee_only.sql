-- ============================================================================
-- Režim pracovného času (§87 ZP, turnus/rovnomerný) presunutý VÝHRADNE na
-- zamestnanca — pozícia už do tohto vôbec nehovorí. `positions.work_time_mode`/
-- `balancing_period_months` sa RUŠIA; `employees.override_work_time_mode`/
-- `override_balancing_period_months` sa premenúvajú na priame (nie "prepis")
-- stĺpce a stávajú sa NOT NULL — už neexistuje nič, čo by sa "dedilo".
-- Backfill NULL → default PRED nastavením NOT NULL, nech žiadny existujúci
-- riadok nezostane bez hodnoty (žiadna tichá zmena správania).
-- ============================================================================

ALTER TABLE positions DROP COLUMN work_time_mode;
ALTER TABLE positions DROP COLUMN balancing_period_months;

ALTER TABLE employees RENAME COLUMN override_work_time_mode TO work_time_mode;
ALTER TABLE employees RENAME COLUMN override_balancing_period_months TO balancing_period_months;

UPDATE employees SET work_time_mode = 'rovnomerny' WHERE work_time_mode IS NULL;
UPDATE employees SET balancing_period_months = 4 WHERE balancing_period_months IS NULL;

ALTER TABLE employees ALTER COLUMN work_time_mode SET DEFAULT 'rovnomerny';
ALTER TABLE employees ALTER COLUMN work_time_mode SET NOT NULL;
ALTER TABLE employees ALTER COLUMN balancing_period_months SET DEFAULT 4;
ALTER TABLE employees ALTER COLUMN balancing_period_months SET NOT NULL;
