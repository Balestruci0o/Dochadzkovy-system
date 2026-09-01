-- ============================================================================
-- Reálny beh (Playwright) odhalil TRETÍ výskyt rovnakej triedy
-- bugu ako predtým (migrácie 0017/0018): `getManagersAndOwner`
-- (lib/notifications/events.ts) číta `manager_workplaces`/`users` POD
-- IDENTITOU KONAJÚCEHO (zamestnanec podáva žiadosť → notifikácia má ísť
-- MANAŽÉROVI/ownerovi) — ale `manager_workplaces_select` (migrácia 0004:
-- `is_owner() OR user_id = current_user_id()`) a `users_select`
-- (`id = current_user_id() OR (is_owner() AND rovnaká org)`) zamestnancovi
-- (ani inému manažérovi) NEDOVOLIA vidieť CUDzie riadky — takže dopyt vráti
-- PRÁZDNY zoznam a notifikácia sa nikomu nepošle, potichu.
--
-- Rovnaké riešenie ako predtým: SECURITY DEFINER funkcia — "kto je manažér/
-- owner tejto prevádzky" je SYSTÉMOVÝ lookup (potrebný na smerovanie
-- notifikácie), nie dáta, ktoré by mal vidieť KONAJÚCI vo svojom bežnom
-- dopyte — rovnaký princíp ako `accessible_workplaces()`/`current_employee_id()`
-- (migrácia 0001), ktoré sú SECURITY DEFINER z rovnakého dôvodu.
-- ============================================================================

CREATE OR REPLACE FUNCTION workplace_managers_and_owner(p_workplace_id uuid, p_org_id uuid) RETURNS SETOF uuid AS $$
  SELECT mw.user_id FROM manager_workplaces mw WHERE mw.workplace_id = p_workplace_id
  UNION
  SELECT u.id FROM users u WHERE u.org_id = p_org_id AND u.role = 'owner' AND u.is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
