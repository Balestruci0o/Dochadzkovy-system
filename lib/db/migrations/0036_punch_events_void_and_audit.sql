-- ============================================================================
-- Granulárna editácia jednotlivých pípnutí (manažér/owner) — dve časti:
--
-- 1. `is_void` — append-only "zmazanie" jedného pípnutia. Punch_events sa
--    NIKDY needituje/nemaže (trigger punch_events_immutable
--    nižšie to aj tak nedovolí) — zmazanie je preto NOVÁ udalosť s
--    corrects_event_id na pôvodnú, ktorá ju len anuluje BEZ náhrady (na rozdiel
--    od bežnej opravy, ktorá čas/typ NAHRÁDZA). `eventsForLocalDate` (lib/punch/
--    attendance.ts) takéto udalosti aj ich cieľ vždy vynechá z výpočtu.
--
-- 2. `audit_punch_events_insert` — punch_events doteraz nemalo AUDIT NA INSERT
--    (migrácia 0033 tam už MÁ trigger menom `audit_punch_events`, ale LEN na
--    AFTER DELETE — výhradne pre potvrdené zmazanie CELÉHO zamestnanca).
--    Preto NOVÝ, INAK POMENOVANÝ trigger — meno
--    `audit_punch_events` je už obsadené, kolidovalo by (over PRED čímkoľvek
--    ďalším: SELECT tgname FROM pg_trigger WHERE tgrelid='punch_events'::regclass).
--    LEN AFTER INSERT (UPDATE/DELETE na túto tabuľku fyzicky nemôžu prebehnúť —
--    trg_punch_no_update/no_delete ich BEFORE zablokujú skôr, než by tento AFTER
--    trigger vôbec videl). old_data je pri INSERTe vždy NULL (táto tabuľka nemá
--    "predtým"); "pôvodná hodnota" opravy sa dohľadá cez
--    new_data->>'corrects_event_id' na PREDOŠLÝ audit riadok toho istého ID —
--    dva audit riadky (pôvodné pípnutie + opravná udalosť) spolu dávajú presne
--    "kto, kedy, čo, pôvodná a nová hodnota".
-- ============================================================================

ALTER TABLE punch_events
  ADD COLUMN is_void boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TRIGGER audit_punch_events_insert AFTER INSERT ON punch_events
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
