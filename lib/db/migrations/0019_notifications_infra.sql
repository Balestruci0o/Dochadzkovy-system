-- ============================================================================
-- Notifikácie. `notifications` (RLS `notifications_own`,
-- migrácia 0004) dovoľuje zápis LEN user_id = current_user_id() — ale
-- notifikácie sa typicky vytvárajú PRE INÚ osobu, než je práve prihlásený
-- používateľ (manažér schváli žiadosť → notifikácia ide ZAMESTNANCOVI,
-- zamestnanec podá žiadosť → notifikácia ide MANAŽÉROVI). Rovnaký princíp
-- ako `materialize_absence_request()` (migrácia 0016/0017) — jediná
-- kontrolovaná SECURITY DEFINER "brána", appka sama nikdy nezapisuje
-- priamo do `notifications` pre cudzí `user_id`.
--
-- "Kedy" (KTORÁ udalosť) vs. "ako" (KTORÝM kanálom) je zámerne oddelené už
-- na úrovni kódu (lib/notifications/events.ts vs. dispatch.ts), nie len v
-- DB — táto funkcia je LEN "ako" pre in-app kanál. Email/push/SMS sú
-- ĎALŠIE, nezávislé kanály nad tou istou "kedy" vrstvou.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_notification(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text DEFAULT NULL,
  p_link text DEFAULT NULL,
  p_payload jsonb DEFAULT NULL
) RETURNS uuid AS $$
  INSERT INTO notifications (user_id, kind, title, body, link, payload)
  VALUES (p_user_id, p_kind, p_title, p_body, p_link, p_payload)
  RETURNING id;
$$ LANGUAGE sql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- Preferencie kanálov PER typ notifikácie ("kind") — bod 4 zadania:
-- in-app je VŽDY zapnuté (žiadny riadok/stĺpec preň, nedá sa vypnúť, preto
-- sa sem ani nezapisuje). Email/push/SMS majú svoj riadok len vtedy, keď si
-- ich používateľ VYPNE (opt-out model — chýbajúci riadok = zapnuté, default
-- správanie sa nemení pridaním nového kanála). `channel` je text (nie enum)
-- zámerne — pridanie 'push'/'sms' neskôr nevyžaduje migráciu enum typu.
-- ----------------------------------------------------------------------------
CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  channel text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, kind, channel)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_own ON notification_preferences FOR ALL USING (
  user_id = current_user_id()
) WITH CHECK (
  user_id = current_user_id()
);
