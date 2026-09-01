-- ============================================================================
-- Nová funkcia: pípanie prestávok, krok 1 — šablóna zmeny nesie prestávku
-- DVOMA spôsobmi: počet minút (doterajšie, default) ALEBO presný čas od–do
-- (napr. 11:00–13:00). `break_minutes` OSTÁVA a je VŽDY vyplnené (default
-- zachováva presne dnešné správanie pre existujúce riadky) — pri
-- `break_mode='presny_cas'` sa v momente priradenia/generovania prepočíta
-- naживo z `break_start_time`/`break_end_time` (viď lib/shared/break-config.ts),
-- nie je to duplicitný zdroj pravdy, len materializovaný odvodený počet minút,
-- rovnaký princíp ako `scheduled_shifts.break_minutes` je materializovaná
-- hodnota, nie živý odkaz na šablónu.
-- ============================================================================

CREATE TYPE break_config_mode AS ENUM ('minuty', 'presny_cas');

ALTER TABLE shift_templates
  ADD COLUMN break_mode break_config_mode NOT NULL DEFAULT 'minuty',
  ADD COLUMN break_start_time time,
  ADD COLUMN break_end_time time;
