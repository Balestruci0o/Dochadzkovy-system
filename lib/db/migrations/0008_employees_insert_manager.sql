-- ============================================================================
-- OPRAVA: rovnaký "sliepka a vajce" problém ako pri users_insert_manager
-- (0005). `emp_write` (FOR ALL, len USING) rieši UPDATE/DELETE existujúcich
-- riadkov cez EXISTS (SELECT 1 FROM employee_workplaces WHERE employee_id =
-- employees.id ...) — ale pri INSERTe nový zamestnanec ešte NEMÁ žiadny
-- employee_workplaces záznam (ten sa vytvára AŽ PO employees), takže tento
-- EXISTS je pri INSERTe vždy false a manažér nikdy nemohol založiť nového
-- zamestnanca. Overené empiricky pred touto migráciou.
--
-- Rovnako ako pri users_insert_manager: manažér smie vložiť employees riadok
-- vo VLASTNEJ organizácii — konkrétnu prevádzku priradí hneď nasledujúcim
-- INSERTom do employee_workplaces (ten už funguje správne, workplace_id je
-- pri ňom k dispozícii priamo).
-- ============================================================================

CREATE POLICY employees_insert_manager ON employees FOR INSERT WITH CHECK (
  current_user_role() = 'manager' AND org_id = current_user_org_id()
);
