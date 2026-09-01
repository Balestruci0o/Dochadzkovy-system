-- ============================================================================
-- APLIKAČNÁ DB ROLA — bez BYPASSRLS
--
-- KRITICKÉ: rola "postgres" v Supabase má rolbypassrls = true. Ak by appka
-- pripájala pod ňou, RLS politiky by sa nikdy nevyhodnocovali — dáta by
-- "unikali" ticho, bez chyby.
--
-- Appka preto pripája pod samostatnou rolou "app_user" (NOSUPERUSER,
-- NOBYPASSRLS). Heslo sa nastavuje mimo tejto migrácie (scripts/setup-app-role.mjs),
-- aby sa nedostalo do git histórie.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- Bežné tabuľky: plný CRUD (RLS politiky rozhodnú, čo appka reálne uvidí/zapíše)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
REVOKE ALL ON audit_log FROM app_user;         -- zapisuje len trigger (SECURITY DEFINER)
REVOKE UPDATE, DELETE ON punch_events FROM app_user;  -- append-only aj na úrovni práv, nielen trigger

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_user;
