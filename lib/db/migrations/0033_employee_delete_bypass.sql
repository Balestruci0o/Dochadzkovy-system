-- ============================================================================
-- Blok 14, bod 3 — mazanie zamestnanca aj S REÁLNYMI pípnutiami.
--
-- POZOR — toto je VEDOMÉ, dvakrát potvrdené rozhodnutie ownera (nie predvolený
-- návrh tohto tímu), ktoré ZUŽUJE pôvodnú absolútnu záruku, že "punch_events
-- sa nikdy nemaže". Owner bol upozornený, že ide o priamy rozpor s týmto
-- princípom, a napriek tomu si vyžiadal možnosť (b): zmazať zamestnanca aj
-- s pípnutiami, za e-mailovým kódom. Pôvodná absolútna záruka append-only
-- bola vedome zúžená tak, aby zodpovedala tejto novej, užšej realite.
--
-- Bypass je zámerne úzko-škálovaný na DVOCH nezávislých vrstvách naraz
-- (RLS je primárna obrana, appka je až druhá vrstva):
--   1) trigger punch_events_immutable() — povolí DELETE (nikdy UPDATE) len
--      keď current_setting('app.confirmed_employee_delete_id') sedí s
--      mazaným riadkom,
--   2) nová RLS DELETE politika na tej istej podmienke.
-- Obe musia platiť súčasne, inak cascade z `DELETE FROM employees` zlyhá.
--
-- Nastaviť `app.confirmed_employee_delete_id` smie VÝHRADNE
-- confirmDeleteEmployeeAction (lib/employees/delete-employee.ts) — a to až
-- PO overení e-mailového kódu (rovnaký vzor ako Blok 14 vyššie, migrácia
-- 0032). Žiadny iný kód v appke toto nastavenie nikdy nevolá. Nastavuje sa
-- cez `set_config(..., true)` = platí len v rámci JEDNEJ transakcie
-- (rovnaký mechanizmus ako app.user_id v lib/db/index.ts).
-- ============================================================================

CREATE OR REPLACE FUNCTION punch_events_immutable()
RETURNS trigger AS $$
DECLARE
  confirmed_employee_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    BEGIN
      confirmed_employee_id := NULLIF(current_setting('app.confirmed_employee_delete_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      confirmed_employee_id := NULL;
    END;
    IF confirmed_employee_id IS NOT NULL AND confirmed_employee_id = OLD.employee_id THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'punch_events je append-only: UPDATE/DELETE nie je povolené. Použi opravnú udalosť (corrects_event_id).';
END;
$$ LANGUAGE plpgsql;

-- Doteraz punch_events nemal ŽIADEN audit trigger (zbytočné, keď sa nedalo
-- nič zmazať/upraviť). Teraz musí každé použitie bypassu zanechať trvalý,
-- dohľadateľný záznam — changed_by = owner, ktorý zmazanie potvrdil kódom.
CREATE TRIGGER audit_punch_events AFTER DELETE ON punch_events
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ----------------------------------------------------------------------------
-- Chýbajúce DELETE politiky — tieto tabuľky doteraz NEMALI ŽIADNU DELETE
-- politiku (appka nikdy nepotrebovala z nich mazať), takže RLS by cascade z
-- `DELETE FROM employees` potichu odmietla (fail-safe = 0 zmazaných riadkov,
-- Postgres to nahlási ako porušenie FK, nie ako ticho preskočené). Rovnaká
-- úzka podmienka ako punch_events vyššie — NIE všeobecné "owner môže mazať",
-- len presne počas potvrdeného mazania TOHTO zamestnanca.
-- ----------------------------------------------------------------------------
CREATE POLICY punch_events_delete_confirmed ON punch_events FOR DELETE USING (
  is_owner() AND employee_id = NULLIF(current_setting('app.confirmed_employee_delete_id', true), '')::uuid
);

CREATE POLICY absence_requests_delete_confirmed ON absence_requests FOR DELETE USING (
  is_owner() AND employee_id = NULLIF(current_setting('app.confirmed_employee_delete_id', true), '')::uuid
);

CREATE POLICY attendance_days_delete_confirmed ON attendance_days FOR DELETE USING (
  is_owner() AND employee_id = NULLIF(current_setting('app.confirmed_employee_delete_id', true), '')::uuid
);

CREATE POLICY qr_tokens_delete_confirmed ON qr_tokens FOR DELETE USING (
  is_owner() AND employee_id = NULLIF(current_setting('app.confirmed_employee_delete_id', true), '')::uuid
);

CREATE POLICY punch_correction_requests_delete_confirmed ON punch_correction_requests FOR DELETE USING (
  is_owner() AND employee_id = NULLIF(current_setting('app.confirmed_employee_delete_id', true), '')::uuid
);
