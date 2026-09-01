import { and, eq } from "drizzle-orm";

/**
 * ⚠️ LEN PRE DEV. Vyberie presne 3 z existujúcich demo osôb zo `seed.ts`
 * (žiadne nové osoby) — po jednej z každej roly — a pripraví ich na
 * fotenie screenshotov do nápovede: prihlasovacie konto, plné manažérske
 * pravomoci pre manažéra (inak by mal poloprázdne Nastavenia) a na konci
 * prehľadnú tabuľku pre `NALEZY.md`.
 *
 * PREČO TOTO NEPOUŽÍVA `lib/auth/create-account-with-password.ts`: tie
 * funkcie (`createOwnerOrManagerAccountWithPassword`,
 * `createEmployeeAccountWithPassword`) INSERTujú CELKOM NOVÝ riadok do
 * `users` — sú pre "táto osoba ešte nemá žiaden účet v appke" (pozvánkový
 * tok, `npm run setup`). Naši traja cieľoví ľudia (Martin Majiteľ, Hana
 * Hotelová, Jana Nováková) majú svoj `users` riadok už priamo zo `seed.ts`
 * — chýba im len naviazaná Supabase Auth identita. Presne TOTO rieši
 * `ensureDevAccounts()` (`lib/db/dev-accounts.ts`, používa aj
 * `npm run db:seed:accounts`) — vyhľadá existujúci riadok podľa presného
 * dev emailu a doplní/obnoví mu Auth účet. Je to teda existujúca,
 * aplikovateľná cesta, len iná než tá, čo sa na prvý pohľad ponúkala —
 * `lib/auth/create-account-with-password.ts` by na tomto rovno zlyhal
 * hláškou "Tento email už patrí inému kontu v systéme.", lebo email v
 * `users` už existuje.
 */

type Target = {
  role: "owner" | "manager" | "employee";
  roleLabel: string;
  email: string;
  fullName: string;
  photoNote: string;
};

const TARGETS: Target[] = [
  {
    role: "owner",
    roleLabel: "Majiteľ",
    email: "owner@dev.local",
    fullName: "Martin Majiteľ",
    photoNote: "Vidí celú organizáciu naraz — obe prevádzky, Nastavenia so všetkými sekciami, Výkazy so mzdami, Zamestnanci naprieč prevádzkami.",
  },
  {
    role: "manager",
    roleLabel: "Manažér",
    email: "manager.hotel@dev.local",
    fullName: "Hana Hotelová",
    photoNote: "Manažér Hotela s PLNOU sadou pravomocí — Nastavenia ukážu všetky sekcie (Pozície, §ZP pravidlá, Kontá, Terminály), vo Výkazoch vidno aj upravovanie miezd.",
  },
  {
    role: "employee",
    roleLabel: "Zamestnanec",
    email: "employee.hotel@dev.local",
    fullName: "Jana Nováková",
    photoNote: "Recepcia, Hotel — má reálny mesiac dát (zmeny, pípnutia, žiadosti rôznych stavov, viď L4). Vidí len \"Moja dochádzka\"/\"Moje žiadosti\", žiadne Nastavenia.",
  },
];

const FULL_MANAGER_PERMISSIONS = {
  managePositionsShifts: true,
  manageRules: true,
  manageAccounts: true,
  viewWages: true,
  editWages: true,
  manageTerminals: true,
} as const;

function assertLocalDevEnvironment() {
  if (process.env.NODE_ENV === "production") {
    console.error("Tento skript sa odmieta spustiť s NODE_ENV=production — je LEN pre lokálny dev stack.");
    process.exit(1);
  }

  const urls = [process.env.DATABASE_URL, process.env.APP_DATABASE_URL].filter((v): v is string => !!v);
  if (urls.length === 0) {
    console.error("DATABASE_URL ani APP_DATABASE_URL nie sú nastavené — nie je čo overiť, zastavujem sa.");
    process.exit(1);
  }
  for (const raw of urls) {
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      console.error(`Nepodarilo sa rozobrať connection string na overenie hostiteľa: ${raw}`);
      process.exit(1);
      return;
    }
    if (host !== "localhost" && host !== "127.0.0.1") {
      console.error(`Databáza beží na "${host}", nie na localhoste — tento skript zakladá TRIVIÁLNE heslá, odmietam pokračovať.`);
      process.exit(1);
    }
  }
}

async function main() {
  assertLocalDevEnvironment();

  const password = process.env.DEV_ACCOUNTS_PASSWORD;
  if (!password) {
    console.error(
      "DEV_ACCOUNTS_PASSWORD nie je nastavená v .env.local — rovnaká poistka ako v lib/db/dev-accounts.ts, " +
        "bez nej sa dev kontá nesmú založiť.",
    );
    process.exit(1);
  }

  const { ensureDevAccounts } = await import("../lib/db/dev-accounts");
  const { adminDb } = await import("../lib/db/admin");
  const { organizations, users, managerPermissions } = await import("../lib/db/schema");
  const { SEED_ORG } = await import("../lib/db/seed-org");

  console.log("Zakladám/obnovujem Supabase Auth identitu pre všetky dev kontá zo seedu (ensureDevAccounts)...\n");
  await ensureDevAccounts();

  const [org] = await adminDb.select().from(organizations).where(eq(organizations.name, SEED_ORG.name)).limit(1);
  if (!org) {
    throw new Error(`Organizácia "${SEED_ORG.name}" neexistuje — spusti najprv "npm run db:seed".`);
  }

  const rows = new Map<string, { id: string; fullName: string; role: string }>();

  // Presný email, nie rola/meno — rovnaká bezpečnostná poistka ako
  // v ensureDevAccounts (viď komentár v lib/db/dev-accounts.ts).
  for (const target of TARGETS) {
    const [row] = await adminDb
      .select({ id: users.id, fullName: users.fullName, role: users.role, email: users.email })
      .from(users)
      .where(and(eq(users.orgId, org.id), eq(users.email, target.email)))
      .limit(1);
    if (!row || row.email !== target.email) {
      throw new Error(`Konto ${target.email} sa nenašlo po ensureDevAccounts() — nemalo by sa stať.`);
    }
    rows.set(target.email, { id: row.id, fullName: row.fullName, role: row.role });
  }

  const managerRow = rows.get("manager.hotel@dev.local")!;
  const ownerRow = rows.get("owner@dev.local")!;

  console.log("Nastavujem manažérovi PLNÚ sadu granulárnych pravomocí...");
  await adminDb
    .insert(managerPermissions)
    .values({ userId: managerRow.id, ...FULL_MANAGER_PERMISSIONS, updatedBy: ownerRow.id })
    .onConflictDoUpdate({
      target: managerPermissions.userId,
      set: { ...FULL_MANAGER_PERMISSIONS, updatedAt: new Date(), updatedBy: ownerRow.id },
    });

  console.log("\n" + "=".repeat(78));
  console.log("Tri kontá pripravené na fotenie (heslo je pre všetky rovnaké):\n");
  console.log(`  Heslo: ${password}\n`);
  console.log(
    TARGETS.map((t) => `  ${t.roleLabel.padEnd(12)} ${t.fullName.padEnd(18)} ${t.email}`).join("\n"),
  );
  console.log("=".repeat(78));

  console.log(
    "\n2FA (email-OTP): vyžadované LEN pre majiteľa (owner) — manažér a " +
      "zamestnanec ho nemajú vôbec (lib/auth/mfa.ts, resolvePostAuthRedirect).\n" +
      "Kód sa NEODOSIELA na email (RESEND_API_KEY je v lokálnom vývoji prázdna) " +
      "— objaví sa v termináli, kde beží `npm run dev`, pod hlavičkou\n" +
      '"[email:stub]" (lib/email/resend.ts). Sleduj TEN terminál, nie Mailpit ' +
      "(appka posiela maily vlastnou cestou cez Resend, nie cez Supabase Auth natívne).\n" +
      "Alternatíva na deň fotenia, ak 2FA prekáža: odkomentuj DEV_DISABLE_2FA=true " +
      "v .env.local (tvrdo ignorované v produkcii).",
  );

  console.log("\nTabuľka pre NALEZY.md:\n");
  console.log("| Rola | Meno | Email | Heslo | Čo sa dá odfotiť |");
  console.log("|---|---|---|---|---|");
  for (const t of TARGETS) {
    console.log(`| ${t.roleLabel} | ${t.fullName} | \`${t.email}\` | \`${password}\` | ${t.photoNote} |`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Skript zlyhal:", err);
  process.exit(1);
});
