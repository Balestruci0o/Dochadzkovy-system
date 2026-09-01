-- ============================================================================
-- "Zmluvný fond" bol doteraz TÝŽDENNÝ
-- (contract_hours_per_week), generátor ho vždy prepočítaval na mesačný za
-- behu (× priemerný počet týždňov v mesiaci, 365.25/7/12 = 4.348125),
-- orientačne, klient túto konverziu nepotvrdil. Klient sa teraz rozhodol:
-- pole sa premenúva a odteraz uchováva hodnotu PRIAMO MESAČNE — stĺpec sa
-- premenúva a existujúce hodnoty prevádzame TÝM ISTÝM, už používaným
-- faktorom, aby sa efektívny mesačný cieľ existujúcich zamestnancov v
-- generátore nezmenil (žiadna tichá zmena správania pre už zadané dáta).
-- Fallback na `legal_rules.MAX_WEEKLY_HOURS` (týždenný §ZP koncept) naďalej
-- konvertuje týmto faktorom — mení sa len zdroj zamestnancovej VLASTNEJ
-- hodnoty, nie fallback.
-- ============================================================================

ALTER TABLE employees RENAME COLUMN contract_hours_per_week TO contract_hours_per_month;

UPDATE employees
SET contract_hours_per_month = ROUND(contract_hours_per_month * 4.348125, 2)
WHERE contract_hours_per_month IS NOT NULL;
