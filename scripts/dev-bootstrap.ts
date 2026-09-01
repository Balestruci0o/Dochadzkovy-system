import { config } from "dotenv";
import { copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import postgres from "postgres";

/**
 * Fáza L, balík L3 — jeden príkaz od čistého klonu po bežiacu appku s demo
 * dátami, proti lokálnemu Supabase stacku (`npx supabase start`, Docker).
 *
 * ZÁMERNÁ ODCHÝLKA od `npm run setup`: tento skript nepoužíva
 * `npm run setup` (interaktívny inštalačný skript pre SKUTOČNÉ nasadenie),
 * ale rovno `npm run db:seed`. Dôvod je vecný, nie štylistický —
 * `lib/db/seed.ts` má vlastnú poistku ("V databáze už existuje
 * organizácia... odmieta sa spustiť") a `scripts/setup.ts` by túto
 * organizáciu založil ako prvý — druhý krok (`db:seed`) by preto VŽDY
 * zlyhal. `seed.ts`/`setup.ts` sú podľa vlastnej hlavičkovej dokumentácie
 * VZÁJOMNÉ ALTERNATÍVY na založenie prvej organizácie, nie krok za krokom
 * nadväzujúca dvojica. `db:seed` navyše rovno založí bohatšie demo dáta
 * (2 prevádzky, 3 pozície, 5 rolí), presne to, čo bude treba pre
 * screenshoty nápovede (balík L4). Podrobnosti: `NALEZY.md`, "L3".
 */

config({ path: ".env.local" });

const ARGS = new Set(process.argv.slice(2));
const RESET = ARGS.has("--reset");

function log(msg: string) {
  console.log(msg);
}

function step(msg: string) {
  console.log(`\n▶ ${msg}`);
}

function fail(msg: string): never {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

/**
 * Windows nemá `npx`/`npm` ako priamo spustiteľné binárky — sú to `.cmd`
 * wrappery, ktoré `spawnSync` bez `shell: true` vôbec nevie naštartovať
 * (skúšané priamo — `EINVAL`, `.cmd` prípona sama o sebe nestačí). `docker`/
 * `node` sú skutočné `.exe`, tie `shell: true` nepotrebujú, ale netreba ich
 * ani riešiť zvlášť — `shell: true` funguje pre všetky rovnako. Vyvoláva to
 * Node-ovo `DEP0190` upozornenie (neescapované argumenty pri poli + shell)
 * — neškodné pre naše pevne dané, nie užívateľom ovládané argumenty nižšie.
 */
function run(cmd: string, args: string[], label: string): void {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    fail(`${label} zlyhalo (exit ${result.status ?? "?"}).`);
  }
}

function dockerRunning(): boolean {
  const result = spawnSync("docker", ["ps"], { stdio: "pipe", shell: process.platform === "win32" });
  return result.status === 0;
}

function supabaseRunning(): boolean {
  const result = spawnSync("npx", ["supabase", "status"], { stdio: "pipe", shell: process.platform === "win32" });
  return result.status === 0;
}

async function confirmReset(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      '⚠️  --reset zastaví lokálny Supabase stack BEZ zálohy — celá databáza (vrátane\n' +
        "    čohokoľvek, čo si si v appke medzičasom nastavil/a) sa zahodí a založí sa nanovo.\n" +
        '    Toto je NEZVRATNÉ. Naozaj pokračovať? Napíš "ano": ',
    );
    return answer.trim().toLowerCase() === "ano";
  } finally {
    rl.close();
  }
}

/** Opakovaný pokus o pripojenie namiesto fixného čakania — Postgres v kontajneri
 * môže byť "bežiaci", ale ešte neprijímať spojenia (inicializácia schémy). */
async function waitForPostgres(databaseUrl: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    const sql = postgres(databaseUrl, { prepare: false, connect_timeout: 3, max: 1 });
    try {
      await sql`SELECT 1`;
      await sql.end({ timeout: 1 });
      return;
    } catch (err) {
      lastError = err;
      await sql.end({ timeout: 1 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`Postgres neodpovedal do ${timeoutMs / 1000}s: ${lastError instanceof Error ? lastError.message : lastError}`);
}

async function organizationExists(databaseUrl: string): Promise<boolean> {
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    const rows = await sql`SELECT 1 FROM organizations LIMIT 1`;
    return rows.length > 0;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function main() {
  step("Preflight");

  if (!dockerRunning()) {
    fail(
      "Docker nebeží (alebo nie je nainštalovaný). Spusti Docker Desktop a skús znova — " +
        "bez neho sa lokálny Supabase stack nedá naštartovať.",
    );
  }
  log("Docker beží.");

  if (!existsSync(".env.local")) {
    if (!existsSync(".env.development.example")) {
      fail(".env.local ani .env.development.example neexistujú — nie je z čoho vytvoriť konfiguráciu.");
    }
    copyFileSync(".env.development.example", ".env.local");
    log(".env.local neexistoval — skopírovaný z .env.development.example.");
    config({ path: ".env.local" });
  } else {
    log(".env.local existuje.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail("DATABASE_URL nie je nastavená v .env.local.");
  }

  if (RESET) {
    step("--reset");
    const confirmed = await confirmReset();
    if (!confirmed) {
      log("Zrušené — databáza sa nezahodila.");
      process.exit(0);
    }
    run("npx", ["supabase", "stop", "--no-backup"], "npx supabase stop --no-backup");
  }

  step("Supabase stack (Docker)");
  if (supabaseRunning()) {
    log("Stack už beží, preskakujem `supabase start`.");
  } else {
    log("Spúšťam `npx supabase start` (prvý beh sťahuje niekoľko GB obrazov, môže to chvíľu trvať)…");
    run("npx", ["supabase", "start"], "npx supabase start");
  }

  step("Čakám, kým Postgres naozaj prijíma spojenia");
  await waitForPostgres(databaseUrl);
  log("Postgres pripravený.");

  step("Migrácie (npm run db:migrate)");
  run("npm", ["run", "db:migrate"], "npm run db:migrate");

  step("Heslo pre rolu app_user");
  run("node", ["scripts/setup-app-role-password.mjs"], "node scripts/setup-app-role-password.mjs");

  step("Demo dáta (npm run db:seed)");
  if (await organizationExists(databaseUrl)) {
    log('V databáze už existuje organizácia — preskakujem `db:seed` (nie je čo zakladať znova).');
  } else {
    if (!process.env.DEV_ACCOUNTS_PASSWORD) {
      log(
        "POZOR: DEV_ACCOUNTS_PASSWORD nie je nastavená v .env.local — demo dáta sa založia, " +
          "ale žiadne z 5 kont sa nebude dať prihlásiť (žiadne heslo). Pozri .env.development.example.",
      );
    }
    run("npm", ["run", "db:seed"], "npm run db:seed");
  }

  const ownerPassword = process.env.DEV_ACCOUNTS_PASSWORD;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const studioUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? process.env.NEXT_PUBLIC_SUPABASE_URL.replace(":54321", ":54323")
    : "http://127.0.0.1:54323";
  const mailpitUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? process.env.NEXT_PUBLIC_SUPABASE_URL.replace(":54321", ":54324")
    : "http://127.0.0.1:54324";

  console.log("\n" + "=".repeat(70));
  console.log("Hotovo. Appku spustíš cez `npm run dev`, potom otvor:\n");
  console.log(`  Appka:   ${appUrl}`);
  console.log(`  Studio:  ${studioUrl}  (Supabase Studio — správa databázy)`);
  console.log(`  Mailpit: ${mailpitUrl}  (lokálny SMTP catcher)`);
  console.log("");
  if (ownerPassword) {
    console.log("  Prihlásenie (majiteľ):");
    console.log("    email:  owner@dev.local");
    console.log(`    heslo:  ${ownerPassword}`);
    console.log("");
    console.log(
      "  2FA je pri prihlásení ownera zapnuté (rovnaký tok ako v produkcii). " +
        "Email-OTP kód sa NEPOSIELA do Mailpitu — appka bez RESEND_API_KEY email\n" +
        "  len VYPÍŠE do TOHTO terminálu (tam, kde bude bežať `npm run dev`) — pozri " +
        "výstup s hlavičkou „[email:stub]“.",
    );
  } else {
    console.log(
      "  DEV_ACCOUNTS_PASSWORD nebola nastavená, takže žiadne z demo kont nemá heslo —\n" +
        "  nastav ju v .env.local a spusti `npm run db:seed:accounts`.",
    );
  }
  console.log("\n  Zastavenie stacku:  npm run dev:stop");
  console.log("  Stav stacku:        npm run dev:status");
  console.log("  Čistý reštart:      npm run dev:bootstrap -- --reset");
  console.log("=".repeat(70));
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
