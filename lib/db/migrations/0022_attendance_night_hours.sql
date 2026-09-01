-- ============================================================================
-- Blok 12 (výkazy) — nočná práca (§123 ZP, 22:00-06:00) potrebná pre výkaz,
-- ale doteraz sa nikde nepočítala ani neukladala. PREKRÝVA sa s
-- weekend_hours/holiday_hours (nočná zmena v sobotu je oboje súčasne), nie
-- samostatná exkluzívna kategória — rovnaký vzor stĺpca ako tie dve.
--
-- Hranica "22:00-06:00" je DÁTA, nie kód — nový
-- legal_rules kód NIGHT_HOURS (viď lib/db/seed.ts), nie zadrátovaná konštanta.
-- Default 0 zachováva presne dnešné hodnoty pre všetky existujúce riadky.
-- ============================================================================

ALTER TABLE attendance_days
  ADD COLUMN night_hours numeric(6, 3) NOT NULL DEFAULT 0;
