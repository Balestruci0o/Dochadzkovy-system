-- ============================================================================
-- Blok 13 — kontaktné údaje pre stránku "Kontakt" (podpora/majiteľ/manažér).
-- `users.phone` — owner/manager kontá nemajú `employees` riadok (tam je
-- telefón zamestnancov), takže telefón pre tieto role nemal doteraz kde
-- žiť. `organizations.support_*` — "podpora" (dodávateľ appky) nie je
-- žiadne konto v systéme vôbec, preto ide na organizáciu ako ručne
-- dopĺňané pole (Nastavenia → Kontá), nie z `users`.
-- ============================================================================

ALTER TABLE users ADD COLUMN phone text;

ALTER TABLE organizations
  ADD COLUMN support_name text,
  ADD COLUMN support_email text,
  ADD COLUMN support_phone text;
