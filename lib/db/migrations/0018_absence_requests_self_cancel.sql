-- ============================================================================
-- Blok 10, bod 8 — "zamestnanec môže zrušiť LEN nepotvrdenú žiadosť". Reálny
-- test (Playwright, real DB) ukázal, že `req_update` (migrácia 0001) toto
-- NEDOVOLÍ: politika nemá explicitný WITH CHECK, takže Postgres znova
-- vyhodnotí ROVNAKÝ výraz z USING aj na NOVÝ riadok po UPDATE — a
-- `employee_id = current_employee_id() AND status = 'pending'` už neplatí,
-- keď sa `status` mení NA 'cancelled'. Presne ten istý mechanizmus, ktorý
-- (správne) blokuje zamestnanca pred SCHVÁLENÍM vlastnej žiadosti (RLS
-- Skupina D6, lib/db/rls.test.ts), bez explicitného WITH CHECK omylom
-- blokuje AJ legitímne zrušenie. Oprava: explicitný WITH CHECK, ktorý
-- zamestnancovi povolí NOVÝ status LEN 'pending' (bez zmeny) alebo
-- 'cancelled' — NIKDY 'approved'/'rejected' (D6 garancia ostáva nedotknutá).
-- ============================================================================

DROP POLICY IF EXISTS req_update ON absence_requests;

CREATE POLICY req_update ON absence_requests FOR UPDATE USING (
  (
    (is_owner() OR current_user_role() = 'manager')
    AND workplace_id IN (SELECT accessible_workplaces())
  )
  OR (
    employee_id = current_employee_id()
    AND status = 'pending'
  )
) WITH CHECK (
  (
    (is_owner() OR current_user_role() = 'manager')
    AND workplace_id IN (SELECT accessible_workplaces())
  )
  OR (
    employee_id = current_employee_id()
    AND status IN ('pending', 'cancelled')
  )
);
