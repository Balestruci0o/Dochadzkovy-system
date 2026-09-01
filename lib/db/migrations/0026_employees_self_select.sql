-- ============================================================================
-- OPRAVA (nájdené pri reálnom overení kroku 3 pípania prestávok v prehliadači,
-- nie vymyslené) — `emp_select` (0002/schema.sql) pustí owner-a a manažéra
-- podľa `employee_workplaces`, ale ZABUDOL na `current_employee_id()` OR-vetvu,
-- ktorú má KAŽDÁ ostatná "zamestnanec vidí svoje" politika (attendance_days,
-- scheduled_shifts, employee_rate_history, qr_tokens, ...). Dôsledok: žiadny
-- zamestnanec si NIKDY nevedel prečítať VLASTNÝ riadok v `employees` cez
-- bežnú (session, nie adminDb) cestu — `/punch` (GET /api/qr-token aj samotná
-- stránka) preto zakaždým spadlo na "employee not found" a ticho presmerovalo
-- na "/". Toto zostalo nepovšimnuté doteraz, lebo punch.test.ts testuje
-- POST /api/punch/(sync) priamo cez adminDb (obchádza RLS úplne) a nikdy
-- neprešlo touto konkrétnou politikou.
-- ============================================================================

DROP POLICY IF EXISTS emp_select ON employees;

CREATE POLICY emp_select ON employees FOR SELECT USING (
  is_owner()
  OR id = current_employee_id()
  OR EXISTS (
    SELECT 1 FROM employee_workplaces ew
    WHERE ew.employee_id = employees.id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  )
);
