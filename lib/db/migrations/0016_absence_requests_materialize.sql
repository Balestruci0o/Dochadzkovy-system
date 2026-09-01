-- ============================================================================
-- Žiadosti o neprítomnosť. `absence_requests` (žiadosť,
-- workflow) a `absences` (materializovaný stav, ČO GENERÁTOR ČÍTA — schema.sql:
-- "Generátor číta TOTO, nie žiadosti") existovali oddelene, ale nič ich
-- nespájalo. Pravidlo "Nepotvrdená žiadosť UŽ blokuje generátor" —
-- materializácia preto musí prebehnúť UŽ PRI PODANÍ (is_confirmed=false), nie
-- až pri schválení. `absences_write` RLS (migrácia 0010) dovoľuje zápis len
-- owner/manager, nie zamestnancovi priamo — riešenie je DB TRIGGER na
-- `absence_requests` (rovnaký princíp ako existujúci append-only trigger a
-- audit log — nepridávaj audit z kódu, už tam je) —
-- beží nezávisle od toho, KTO požiadal (zamestnanec/manažér), appka sa
-- `absences` vôbec nedotýka priamo pre tento tok.
--
-- Správanie:
--   status='pending'  → 1 riadok/deň v [date_from, date_to], is_confirmed=false
--   status='approved' → rovnaké riadky, is_confirmed=true (manažér zadá ZA
--                        zamestnanca rovno ako 'approved' → vzniknú confirmed
--                        rovno pri INSERTe, žiadny medzikrok)
--   status='rejected'/'cancelled' → materializované riadky zmiznú
--   UPDATE kým je pending/approved (napr. zamestnanec upraví dátum vlastnej
--     visiacej žiadosti) → celý rozsah sa prehodí (delete + znova insert)
--
-- ON CONFLICT (employee_id, date) DO NOTHING: ak ten deň už absencia
-- existuje (z INÉHO zdroja — manuálny zápis v kalendári, iná žiadosť), NOVÝ
-- riadok sa pre TEN deň potichu nezapíše (žiadosť samotná zostáva viditeľná
-- v `absence_requests`, len sa jej materializácia pre kolidujúci deň
-- nepresadí) — známe, vedomé zjednodušenie.
-- ============================================================================

CREATE OR REPLACE FUNCTION materialize_absence_request() RETURNS TRIGGER AS $$
DECLARE
  d DATE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IN ('rejected', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM absences WHERE request_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('pending', 'approved') THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM absences WHERE request_id = NEW.id;
    END IF;

    d := NEW.date_from;
    WHILE d <= NEW.date_to LOOP
      INSERT INTO absences (employee_id, workplace_id, request_id, date, kind, hours, is_confirmed)
      VALUES (NEW.employee_id, NEW.workplace_id, NEW.id, d, NEW.kind, NEW.hours, NEW.status = 'approved')
      ON CONFLICT (employee_id, date) DO NOTHING;
      d := d + 1;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER absence_requests_materialize
AFTER INSERT OR UPDATE ON absence_requests
FOR EACH ROW EXECUTE FUNCTION materialize_absence_request();
