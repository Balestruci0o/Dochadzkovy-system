-- ============================================================================
-- Nastavenia → Kontá: zmazanie PRIHLASOVACIEHO konta (owner-only, potvrdené
-- kódom z mailu, rovnaký mechanizmus ako Blok 14). ZÁMERNE soft-delete, nie
-- fyzický DELETE FROM users — `punch_events.created_by` (a viaceré ďalšie
-- created_by/decided_by/... stĺpce) ukazujú na `users.id` BEZ cascade/set
-- null (default NO ACTION), takže fyzický DELETE by zlyhal na FK pre takmer
-- každé reálne používané konto. Aj keby sa to obišlo (napr. ON DELETE SET
-- NULL na tej FK), `punch_events_immutable()` (append-only trigger)
-- by aj tak zablokoval samotné SET NULL — FK akcie
-- STÁLE spúšťajú bežné triggery na cieľovej tabuľke. Soft-delete namiesto
-- toho: `users` riadok OSTÁVA (kotva pre históriu — "kto to schválil/pípol"
-- zostáva čitateľné), len sa mu vynuluje prihlasovacia identita.
--
-- `email` sa musí dať vynulovať (uvoľní adresu pre budúcu novú pozvánku na
-- to isté meno) → NOT NULL sa ruší.
-- ============================================================================

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN deleted_at timestamp with time zone;

ALTER TYPE destructive_action_target ADD VALUE 'user_account';

-- Audit LEN na prechod "nezmazaný → zmazaný" — bežný `AFTER UPDATE` bez WHEN
-- by chytil aj last_login_at pri KAŽDOM prihlásení (app/(auth)/prihlasenie/
-- actions.ts), čo by audit_log zaplavilo šumom bez akejkoľvek výpovednej
-- hodnoty. `users` dovtedy nemalo VÔBEC žiadny audit trigger.
CREATE TRIGGER audit_users_delete AFTER UPDATE ON users
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION audit_trigger();
