-- ============================================================================
-- Režim odchodu (pípa/nepípa) — PRESNE vzor break_tracking_mode (migrácia
-- 0001 pre positions.break_tracking_mode / employees.override_break_tracking_mode):
-- default na pozícii, prepísateľný na zamestnancovi (NULL = zdedené).
--
-- "pipa" (default, dnešné správanie zachované) — odchod sa pípa cez
-- terminál/web ako doteraz. Ak nepípne, zmena ostáva OTVORENÁ (status
-- 'working') navždy, kým ju manažér neopraví — presne dnešná politika,
-- NEZMENENÉ.
--
-- "nepipa" — systém AUTO-pípne odchod na konci PLÁNOVANEJ zmeny (cron,
-- lib/punch/auto-close.ts), ak sa zamestnanec pípol na príchod a nepípol
-- odchod sám. Manuálny odchod (ak sa napriek tomu pípne) má vždy prednosť —
-- rieši sa tým, že cron nikdy neuvidí `status='working'` riadok, ktorý už má
-- `actualEnd` z reálneho pípnutia.
--
-- Toto NIE JE zásah do prestávkového dôkazu (odišiel na prestávku,
-- nevrátil sa → uzavrie sa v čase odchodu na prestávku) — ten platí PRE
-- VŠETKÝCH nezávisle od tohto nastavenia (je to dôkaz, nie hádanie).
-- "nepipa" pridáva DRUHÚ, doplnkovú podmienku
-- uzavretia, nenahrádza prvú.
-- ============================================================================

CREATE TYPE departure_mode AS ENUM ('pipa', 'nepipa');

ALTER TABLE positions
  ADD COLUMN departure_mode departure_mode NOT NULL DEFAULT 'pipa';

ALTER TABLE employees
  ADD COLUMN override_departure_mode departure_mode;
