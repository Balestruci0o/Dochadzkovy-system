-- ============================================================================
-- Blok 11, krok 2 — email kanál cez existujúci `notify()` (bod 2 zadania:
-- rovnaká "kedy" logika, žiadna nová cesta). Tri SECURITY DEFINER funkcie,
-- rovnaký dôvod ako `create_notification`/`workplace_managers_and_owner`
-- (migrácie 0019/0020) — appka koná POD IDENTITOU niekoho iného, než je
-- príjemca, takže `notifications_own`/`notification_preferences_own` RLS
-- (len `user_id = current_user_id()`) by zablokovali:
--   1. čítanie príjemcovho emailu (`users.email`),
--   2. čítanie jeho preferencie kanála,
--   3. zápis `email_sent_at` PO odoslaní.
--
-- `create_notification` sa MENÍ (návratový typ) — DROP + znova CREATE,
-- Postgres nedovolí zmeniť návratový typ cez CREATE OR REPLACE.
-- ============================================================================

DROP FUNCTION IF EXISTS create_notification(uuid, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION create_notification(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text DEFAULT NULL,
  p_link text DEFAULT NULL,
  p_payload jsonb DEFAULT NULL
) RETURNS TABLE(notification_id uuid, recipient_email text) AS $$
  WITH inserted AS (
    INSERT INTO notifications (user_id, kind, title, body, link, payload)
    VALUES (p_user_id, p_kind, p_title, p_body, p_link, p_payload)
    RETURNING id
  )
  SELECT inserted.id, u.email FROM inserted JOIN users u ON u.id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Opt-out model (migrácia 0019) — chýbajúci riadok = kanál zapnutý.
CREATE OR REPLACE FUNCTION is_channel_enabled(p_user_id uuid, p_kind text, p_channel text) RETURNS boolean AS $$
  SELECT COALESCE(
    (SELECT enabled FROM notification_preferences WHERE user_id = p_user_id AND kind = p_kind AND channel = p_channel),
    true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION mark_notification_email_sent(p_notification_id uuid) RETURNS void AS $$
  UPDATE notifications SET email_sent_at = now() WHERE id = p_notification_id;
$$ LANGUAGE sql SECURITY DEFINER;
