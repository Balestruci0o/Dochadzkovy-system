-- ============================================================================
-- Blok 7 (Pípanie) — `qr_tokens` malo RLS zapnuté a ÚPLNE odobraté práva pre
-- app_user (0004_full_rls_coverage.sql, skupina D: "len service role").
-- To bolo správne pre STAV vtedy (nič si token nepýtalo), ale teraz appka
-- potrebuje bežnú, prihlásenú funkciu: zamestnanec si cez GET /api/qr-token
-- vypýta rotujúci token pre /punch. To je jeho VLASTNÁ akcia (nie terminál),
-- ide teda cez normálnu Supabase session, nie cez adminDb.
--
-- `used_at`/`used_by_terminal` (označenie ako použitý) naďalej zapisuje LEN
-- punch endpoint cez adminDb (žiadny app.user_id — terminál sa autentifikuje
-- HMAC podpisom, nie session). Preto len INSERT + SELECT vlastného riadku,
-- žiadny UPDATE/DELETE pre app_user.
-- ============================================================================

GRANT SELECT, INSERT ON qr_tokens TO app_user;

CREATE POLICY qr_tokens_select_own ON qr_tokens FOR SELECT USING (
  employee_id = current_employee_id()
);

CREATE POLICY qr_tokens_insert_own ON qr_tokens FOR INSERT WITH CHECK (
  employee_id = current_employee_id()
);
