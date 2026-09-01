-- ============================================================================
-- Oprava migrácie 0016 — `materialize_absence_request()` musí byť
-- `SECURITY DEFINER`, presne ako `audit_trigger()` (migrácia 0001) a
-- ostatné triggerové funkcie, ktoré zapisujú do tabuľky BEZ OHĽADU na to,
-- kto vyvolal pôvodný príkaz (migrácia 0002: "zapisuje len trigger
-- (SECURITY DEFINER)"). Bez toho beží funkcia ako VOLAJÚCA rola — keď
-- zamestnanec upraví VLASTNÚ pending žiadosť (req_update to dovoľuje),
-- trigger sa pokúsi INSERT/DELETE na `absences`, kde `absences_write`
-- (migrácia 0010) povoľuje zápis LEN owner/manager → RLS zamietne s "new
-- row violates row-level security policy for table absences". Reálne
-- nájdené testom (RLS Skupina D6, `lib/db/rls.test.ts`), nie teoreticky.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
