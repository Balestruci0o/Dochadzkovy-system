import { and, eq } from "drizzle-orm";
import { adminDb } from "./admin";
import { SEED_ORG } from "./seed-org";
import { organizations, users } from "./schema";
import { createSupabaseAdminClient } from "../supabase/admin";

/**
 * ⚠️ LEN PRE DEV. Vytvorí/obnoví funkčné prihlasovacie kontá (Supabase Auth +
 * users.auth_user_id) pre 5 rolí zo seed dát — nech sa dá appka rovno
 * otestovať bez prechádzania invite flow.
 *
 * Do produkcie sa toto NESMIE dostať — preto vyžaduje explicitný
 * DEV_ACCOUNTS_PASSWORD z .env.local (nikdy zadrátovaný v kóde, nikdy v gite).
 * Bez tejto premennej funkcia hodí chybu a nič nevytvorí.
 *
 * Idempotentné: opakované spustenie len obnoví heslo a aktivuje účet, nevytvára
 * duplicity (nájde existujúci auth účet podľa users.auth_user_id).
 *
 * BEZPEČNOSŤ (nájdené 2026-08-02, po incidente, kedy sa tento skript takmer
 * pokúsil premenovať SKUTOČNÝ účet majiteľa) — každý z 5 riadkov sa hľadá
 * VÝHRADNE cez presný `email = '*.dev.local'`, NIKDY cez `role`, meno
 * zamestnanca alebo `manager_workplaces` prevádzku. Dôvod: `role='owner'`
 * alebo "manažér priradený k Hotelu" nie je v tejto org jednoznačné — v
 * reálnej prevádzke pribudne aj SKUTOČNÝ owner/manažér s rovnakou rolou/
 * prevádzkou ako fiktívne dev konto, a `.limit(1)` bez `ORDER BY` môže
 * (nedeterministicky, podľa poradia v DB) vybrať TEN SKUTOČNÝ riadok —
 * presne to sa raz stalo (Supabase update síce zlyhal, takže sa nič
 * nepokazilo, ale bolo to o vlások). `seed.ts` vždy zakladá dev riadky s
 * TÝMITO presnými emailami — hľadanie podľa nich je jediný spôsob, ako
 * mať 100% istotu, že sa NIKDY nechytí cudzí (reálny) riadok.
 */
export async function ensureDevAccounts() {
  const password = process.env.DEV_ACCOUNTS_PASSWORD;
  if (!password) {
    throw new Error(
      "DEV_ACCOUNTS_PASSWORD nie je nastavená v .env.local. Toto je zámerná poistka — " +
        "dev prihlasovacie kontá sa nesmú dať vytvoriť bez explicitného hesla, a už vôbec " +
        "nie v produkcii, kde táto premenná nesmie existovať.",
    );
  }

  const ORG_NAME = SEED_ORG.name;
  const [org] = await adminDb.select().from(organizations).where(eq(organizations.name, ORG_NAME)).limit(1);
  if (!org) {
    throw new Error(`Organizácia "${ORG_NAME}" neexistuje — spusti najprv "npm run db:seed".`);
  }

  const specs = [
    { label: "owner (majiteľ) — vidí všetko", email: "owner@dev.local" },
    { label: "manager — priradený k Hotelu, s pravomocami (Fáza L)", email: "manager.hotel@dev.local" },
    { label: "manager — priradený k Office", email: "manager.office@dev.local" },
    { label: "employee — Hotel, Recepcia (Jana Nováková)", email: "employee.hotel@dev.local" },
    { label: "employee — Office, Účtovník (Peter Účtovník)", email: "employee.office@dev.local" },
    // Fáza L, balík L4 — pridané spolu s druhou Recepčnou/Chyžnou v seed.ts.
    { label: "employee — Hotel, Recepcia, vedúca zmeny (Zuzana Baranová)", email: "employee.hotel2@dev.local" },
    { label: "employee — Hotel, Chyžná (Katarína Sokolová)", email: "employee.hotel3@dev.local" },
  ] as const;

  const admin = createSupabaseAdminClient();
  const results: { label: string; email: string }[] = [];

  for (const spec of specs) {
    // Presný email, NIE role/meno/prevádzka — viď bezpečnostný komentár vyššie.
    const [row] = await adminDb
      .select()
      .from(users)
      .where(and(eq(users.orgId, org.id), eq(users.email, spec.email)))
      .limit(1);
    if (!row) {
      throw new Error(`Dev konto ${spec.email} (${spec.label}) neexistuje — spusti najprv "npm run db:seed".`);
    }
    // Poistka na TÚTO konkrétnu triedu chyby, keby sa query vyššie niekedy
    // omylom uvoľnila (napr. niekto odstráni `eq(users.email, ...)`):
    // NIKDY nezavolaj Supabase Auth update/create na riadku, ktorého email
    // nesedí presne na dev doménu, aj keby ho DB dotaz vrátil.
    if (row.email !== spec.email) {
      throw new Error(`Bezpečnostná poistka: nájdený riadok má email "${row.email}", očakávaný "${spec.email}" — zastavujem sa.`);
    }

    let authUserId = row.authUserId;
    if (authUserId) {
      const { error } = await admin.auth.admin.updateUserById(authUserId, {
        password,
        email: spec.email,
        email_confirm: true,
      });
      if (error) throw new Error(`updateUserById zlyhalo pre ${spec.label}: ${error.message}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: spec.email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser zlyhalo pre ${spec.label}: ${error?.message}`);
      authUserId = data.user.id;
    }

    await adminDb
      .update(users)
      .set({
        authUserId,
        isActive: true,
        activatedAt: row.activatedAt ?? new Date(),
      })
      .where(eq(users.id, row.id));

    results.push({ label: spec.label, email: spec.email });
  }

  return results;
}
