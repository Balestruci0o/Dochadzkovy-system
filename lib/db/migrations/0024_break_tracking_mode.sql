-- ============================================================================
-- Nová funkcia: pípanie prestávok, krok 2 — kto si prestávky reálne PÍPA vs.
-- komu sa vždy odpočíta AUTOMATICKY zo šablóny/priradenia. Rovnaký vzor ako
-- work_time_mode (0012_*): default žije na `positions.break_tracking_mode`,
-- zamestnanec ho smie prepísať cez `employees.override_break_tracking_mode`
-- (NULL = zdedené z pozície). `automaticky` default zachováva PRESNE dnešné
-- správanie pre existujúce riadky — žiadna tichá zmena výpočtu hodín.
-- ============================================================================

CREATE TYPE break_tracking_mode AS ENUM ('automaticky', 'pipa');

ALTER TABLE positions
  ADD COLUMN break_tracking_mode break_tracking_mode NOT NULL DEFAULT 'automaticky';

ALTER TABLE employees
  ADD COLUMN override_break_tracking_mode break_tracking_mode;
