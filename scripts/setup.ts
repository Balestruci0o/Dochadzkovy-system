import { eq } from "drizzle-orm";
import { createInterface, type Interface } from "node:readline/promises";
import { createOwnerOrManagerAccountWithPassword } from "../lib/auth/create-account-with-password";
import { validatePassword } from "../lib/auth/password";
import { legalRulesDefaults } from "../lib/db/legal-rules-defaults";
import { legalRules, organizations, workplaces } from "../lib/db/schema";

/**
 * Inštalačný skript — založí PRVÚ organizáciu, prevádzku a majiteľa pri
 * nasadení pre skutočnú firmu. `npm run db:seed` (lib/db/seed.ts) je naproti
 * tomu dev nástroj, ktorý zakladá demo dáta na vyskúšanie appky — nič z toho
 * sa sem nedá znovupoužiť, lebo tento skript sa spúšťa interaktívne a musí
 * fungovať bez existujúcej DB session (žiadny prihlásený užívateľ, pod
 * ktorého identitou by bežali RLS politiky — rovnaký dôvod ako v seed.ts,
 * preto `adminDb`, nie `db`/`withUserContext`).
 *
 * `--non-interactive` (+ `--org-name`/`--workplace-name`/`--workplace-code`/
 * `--owner-name`/`--owner-email`/`--owner-password`, voliteľne aj
 * `--ico`/`--support-name`/`--support-email`/`--support-phone`/
 * `--operating-days`/`--timezone`) existuje predovšetkým pre CI (over proti
 * čerstvej DB v `.github/workflows/ci.yml`) a pre skriptované nasadenia —
 * v bežnej praxi je interaktívny beh jednoduchší a bezpečnejší (heslo sa
 * nemusí objaviť v shell histórii/CI logu). Všetky poistky z interaktívneho
 * režimu (chýbajúce premenné, zlyhané pripojenie, chýbajúce migrácie,
 * existujúca organizácia) platia v OBOCH režimoch rovnako — sú pred
 * vetvením na interaktívny/neinteraktívny beh.
 */

const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "QR_TOKEN_SECRET",
  "TERMINAL_SECRET_ENCRYPTION_KEY",
] as const;

const DEFAULT_OPERATING_DAYS = [1, 2, 3, 4, 5, 6, 7];

function parseCliArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      i++;
    } else {
      booleans.add(name);
    }
  }
  return { flags, booleans };
}

const { flags: CLI_FLAGS, booleans: CLI_BOOLEANS } = parseCliArgs(process.argv.slice(2));
const DRY_RUN = CLI_BOOLEANS.has("dry-run");
const NON_INTERACTIVE = CLI_BOOLEANS.has("non-interactive");

async function question(rl: Interface, query: string): Promise<string> {
  return (await rl.question(query)).trim();
}

async function askYesNo(rl: Interface, query: string): Promise<boolean> {
  return (await question(rl, query)).toLowerCase() === "ano";
}

/**
 * Heslo sa nikdy nesmie objaviť v konzole ani v logu. `readline/promises`
 * nemá vstavané maskovanie a jeho interné háčiky na potlačenie echa (staré
 * `_writeToOutput`) v aktuálnych Node verziách už neexistujú (overené) —
 * preto vlastné čítanie po znakoch cez raw mód, úplne mimo `readline`
 * inštancie (tá sa počas tohto promptu zatvára, viď volanie nižšie).
 * Mimo TTY (napr. automatizovaný beh, pipe) raw mód nie je dostupný —
 * spadne späť na obyčajné (nemaskované) načítanie riadku.
 */
async function promptPassword(query: string): Promise<string> {
  process.stdout.write(query);

  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    const value = await rl.question("");
    rl.close();
    return value;
  }

  const CTRL_C = String.fromCharCode(3);
  const BACKSPACE = String.fromCharCode(8);
  const DEL = String.fromCharCode(127);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          process.stdout.write("\n");
          process.exit(1);
        }
        if (ch === DEL || ch === BACKSPACE) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

function parseOperatingDays(input: string): number[] {
  if (!input.trim()) return DEFAULT_OPERATING_DAYS;
  const days = input
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : DEFAULT_OPERATING_DAYS;
}

type SetupInput = {
  orgName: string;
  ico: string | null;
  supportName: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  workplaceName: string;
  workplaceCode: string;
  operatingDays: number[];
  timezone: string;
  ownerFullName: string;
  ownerEmail: string;
  ownerPassword: string;
};

const REQUIRED_CLI_FLAGS = ["org-name", "workplace-name", "workplace-code", "owner-name", "owner-email", "owner-password"] as const;

/** Neinteraktívny zber — chýbajúci POVINNÝ údaj = rovno chyba, nie otázka. */
async function collectNonInteractive(): Promise<SetupInput> {
  const missingFlags = REQUIRED_CLI_FLAGS.filter((name) => !CLI_FLAGS.get(name));
  if (missingFlags.length > 0) {
    console.error("Chýbajú povinné parametre pre --non-interactive:");
    for (const name of missingFlags) console.error(`  --${name}`);
    process.exit(1);
  }

  const orgName = CLI_FLAGS.get("org-name")!;
  const workplaceName = CLI_FLAGS.get("workplace-name")!;
  const workplaceCode = CLI_FLAGS.get("workplace-code")!.toUpperCase();
  const ownerFullName = CLI_FLAGS.get("owner-name")!;
  const ownerEmail = CLI_FLAGS.get("owner-email")!;
  const ownerPassword = CLI_FLAGS.get("owner-password")!;

  if (!ownerEmail.includes("@")) {
    console.error("--owner-email nie je platný email.");
    process.exit(1);
  }

  const check = await validatePassword(ownerPassword);
  if (!check.valid) {
    console.error(`--owner-password: ${check.error}`);
    process.exit(1);
  }

  return {
    orgName,
    ico: CLI_FLAGS.get("ico") ?? null,
    supportName: CLI_FLAGS.get("support-name") ?? null,
    supportEmail: CLI_FLAGS.get("support-email") ?? null,
    supportPhone: CLI_FLAGS.get("support-phone") ?? null,
    workplaceName,
    workplaceCode,
    operatingDays: parseOperatingDays(CLI_FLAGS.get("operating-days") ?? ""),
    timezone: CLI_FLAGS.get("timezone") || "Europe/Bratislava",
    ownerFullName,
    ownerEmail,
    ownerPassword,
  };
}

async function collectInteractive(): Promise<SetupInput> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let orgName = "";
  while (!orgName) {
    orgName = await question(rl, "Názov organizácie: ");
    if (!orgName) console.log("Názov je povinný.");
  }

  const ico = (await question(rl, "IČO (Enter = preskočiť): ")) || null;

  console.log("\nKontakt na podporu — sem patrí DODÁVATEĽ systému, nie zamestnanec firmy.");
  console.log("Zobrazuje sa používateľom appky na stránke Kontakt.");
  const supportName = (await question(rl, "  Meno (Enter = preskočiť): ")) || null;
  const supportEmail = (await question(rl, "  Email (Enter = preskočiť): ")) || null;
  const supportPhone = (await question(rl, "  Telefón (Enter = preskočiť): ")) || null;

  console.log("\nPrvá prevádzka");
  let workplaceName = "";
  while (!workplaceName) {
    workplaceName = await question(rl, "  Názov prevádzky: ");
    if (!workplaceName) console.log("  Názov je povinný.");
  }
  let workplaceCode = "";
  while (!workplaceCode) {
    workplaceCode = (await question(rl, "  Kód prevádzky, napr. HOTEL: ")).toUpperCase();
    if (!workplaceCode) console.log("  Kód je povinný.");
  }
  const operatingDays = parseOperatingDays(
    await question(rl, "  Prevádzkové dni, 1=pondelok..7=nedeľa, čiarkou oddelené (Enter = všetky): "),
  );
  const timezone = (await question(rl, "  Časové pásmo (Enter = Europe/Bratislava): ")) || "Europe/Bratislava";

  console.log("\nMajiteľ — prvé prihlasovacie konto (rola owner)");
  let ownerFullName = "";
  while (!ownerFullName) {
    ownerFullName = await question(rl, "  Celé meno: ");
    if (!ownerFullName) console.log("  Meno je povinné.");
  }
  let ownerEmail = "";
  while (!ownerEmail.includes("@")) {
    ownerEmail = await question(rl, "  Email: ");
    if (!ownerEmail.includes("@")) console.log("  Zadaj platný email.");
  }

  // readline sa zatvára pred heslom — promptPassword prepína stdin do raw
  // módu a otvorená readline inštancia by si o rovnaký stdin súperila.
  rl.close();

  let ownerPassword = "";
  for (;;) {
    const pw1 = await promptPassword("  Heslo (min. 12 znakov): ");
    const check = await validatePassword(pw1);
    if (!check.valid) {
      console.log(`  ${check.error} Skús znova.`);
      continue;
    }
    const pw2 = await promptPassword("  Zopakuj heslo: ");
    if (pw1 !== pw2) {
      console.log("  Heslá sa nezhodujú. Skús znova.");
      continue;
    }
    ownerPassword = pw1;
    break;
  }

  return {
    orgName,
    ico,
    supportName,
    supportEmail,
    supportPhone,
    workplaceName,
    workplaceCode,
    operatingDays,
    timezone,
    ownerFullName,
    ownerEmail,
    ownerPassword,
  };
}

async function main() {
  // Poistka 1 — povinné premenné prostredia, PRED akýmkoľvek importom, ktorý
  // by mohol vyhodiť menej zrozumiteľnú chybu (napr. lib/db/admin.ts sám
  // zlyhá pri importe, ak DATABASE_URL chýba). Preto dynamický import nižšie.
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error("Chýbajú povinné premenné prostredia:");
    for (const name of missing) console.error(`  - ${name}`);
    console.error("\nOver .env.example a doplň ich do .env.local.");
    process.exit(1);
  }

  const { adminDb } = await import("../lib/db/admin");

  // Poistka 2 (pripojenie) + 3 (migrácie) + 4 (žiadna existujúca organizácia)
  // — jeden dopyt vybaví všetky tri, viď rozlíšenie chýb nižšie.
  let existing: { id: string; name: string }[];
  try {
    existing = await adminDb.select({ id: organizations.id, name: organizations.name }).from(organizations).limit(1);
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    if (cause?.code === "42P01") {
      console.error('Tabuľka "organizations" neexistuje. Spusti najprv "npm run db:migrate".');
    } else {
      console.error("Nepodarilo sa pripojiť do databázy. Skontroluj DATABASE_URL v .env.local.");
      const detail = [cause?.code, cause?.message || (err as Error).message].filter(Boolean).join(": ");
      console.error(`  Detail: ${detail}`);
    }
    process.exit(1);
  }

  if (existing.length > 0) {
    console.error(`V databáze už existuje organizácia "${existing[0].name}".`);
    console.error("Tento skript sa odmieta spustiť nad živými dátami — bez výnimky, bez prepínača na obídenie.");
    process.exit(1);
  }

  console.log(
    "Založenie novej organizácie" +
      (NON_INTERACTIVE ? " (--non-interactive)" : "") +
      (DRY_RUN ? " (--dry-run, nič sa nezapíše)" : "") +
      "\n",
  );

  const input = NON_INTERACTIVE ? await collectNonInteractive() : await collectInteractive();
  const { orgName, ico, supportName, supportEmail, supportPhone, workplaceName, workplaceCode, operatingDays, timezone, ownerFullName, ownerEmail, ownerPassword } = input;

  console.log("\n" + "=".repeat(60));
  console.log("Súhrn — založí sa:");
  console.log(`  Organizácia: ${orgName}${ico ? ` (IČO ${ico})` : ""}`);
  if (supportName || supportEmail || supportPhone) {
    console.log(`  Kontakt na podporu: ${[supportName, supportEmail, supportPhone].filter(Boolean).join(", ")}`);
  }
  console.log(`  Prevádzka: ${workplaceName} (${workplaceCode}), dni ${operatingDays.join(",")}, ${timezone}`);
  console.log(`  Majiteľ: ${ownerFullName} <${ownerEmail}>`);
  console.log("=".repeat(60) + "\n");

  if (DRY_RUN) {
    console.log("--dry-run: nič sa nezapísalo.");
    process.exit(0);
  }

  if (!NON_INTERACTIVE) {
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const confirmed = await askYesNo(rl2, "Pokračovať a založiť? (ano/nie): ");
    rl2.close();
    if (!confirmed) {
      console.log("Zrušené, nič sa nezapísalo.");
      process.exit(0);
    }
  }

  let orgId: string;
  try {
    orgId = await adminDb.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: orgName, ico, supportName, supportEmail, supportPhone })
        .returning();
      await tx.insert(workplaces).values({
        orgId: org.id,
        name: workplaceName,
        code: workplaceCode,
        operatingDays,
        timezone,
      });
      await tx.insert(legalRules).values(legalRulesDefaults(org.id));
      return org.id;
    });
  } catch (err) {
    console.error("Nepodarilo sa založiť organizáciu:", (err as Error).message);
    process.exit(1);
  }

  const outcome = await adminDb.transaction((tx) =>
    createOwnerOrManagerAccountWithPassword(tx, {
      orgId,
      email: ownerEmail,
      fullName: ownerFullName,
      phone: null,
      role: "owner",
      workplaceIds: [],
      password: ownerPassword,
    }),
  );

  if (!outcome.ok) {
    console.error(`\nNepodarilo sa založiť konto majiteľa: ${outcome.message}`);
    console.error("Upratujem po sebe — mažem práve založenú organizáciu (kaskádovo aj prevádzku a §ZP pravidlá)...");
    try {
      await adminDb.delete(organizations).where(eq(organizations.id, orgId));
      console.error("Upratané, v databáze nezostali žiadne čiastočné dáta.");
    } catch (cleanupErr) {
      console.error(
        `Upratovanie ZLYHALO — v databáze zostala organizácia "${orgName}" (${orgId}) bez majiteľa. Zmaž ju ručne alebo skús skript znova po vyriešení príčiny.`,
      );
      console.error(`  Detail: ${(cleanupErr as Error).message}`);
    }
    process.exit(1);
  }

  console.log(`\nHotovo. Organizácia "${orgName}" je založená.\n`);
  console.log("Ďalšie kroky:");
  console.log("  1. Nastav značku v .env.local (NEXT_PUBLIC_BRAND_*) — viď BRANDING.md");
  console.log("  2. npm run build");
  console.log(`  3. Prihlás sa ako ${ownerEmail} na ${process.env.NEXT_PUBLIC_APP_URL ?? "<NEXT_PUBLIC_APP_URL>"}/prihlasenie`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Inštalačný skript zlyhal:", err);
  process.exit(1);
});
