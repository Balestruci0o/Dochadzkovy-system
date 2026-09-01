/**
 * Meno a IČO organizácie zakladanej pri dev/demo seede — TOTO NIE JE
 * branding (viď lib/branding/config.ts pre to). Je to riadok v databáze
 * (`organizations`), ktorý si `seed.ts` aj `dev-accounts.ts` musia zdieľať
 * (`dev-accounts.ts` dohľadáva organizáciu presne podľa tohto mena) — preto
 * je hodnota na jednom mieste ako konštanta, nie zapísaná ako reťazec
 * dvakrát v dvoch súboroch, kde by sa mohla časom rozísť.
 */
export const SEED_ORG = {
  name: process.env.SEED_ORG_NAME || "Demo firma",
  ico: process.env.SEED_ORG_ICO || "00000000",
};
