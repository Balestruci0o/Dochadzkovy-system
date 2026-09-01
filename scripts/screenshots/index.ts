import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { loginAndSaveState } from "./auth";
import { captureFullPage, waitForReady } from "./capture";
import { BASE_URL, DESKTOP_VIEWPORT, MOBILE_CONTEXT, fixedCaptureMoment, freezeClock, type Role } from "./config";
import { nextMonthCalendarUrl } from "./prepare";
import { outputDir, resolvePath, TARGETS, type ScreenshotTarget, type WorkplaceIds } from "./targets";

type CliArgs = { only?: string; role?: Role; desktopOnly: boolean; mobileOnly: boolean };

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { desktopOnly: false, mobileOnly: false };
  for (const arg of argv) {
    if (arg.startsWith("--only=")) args.only = arg.slice("--only=".length);
    else if (arg.startsWith("--role=")) args.role = arg.slice("--role=".length) as Role;
    else if (arg === "--desktop-only") args.desktopOnly = true;
    else if (arg === "--mobile-only") args.mobileOnly = true;
  }
  return args;
}

function assertLocalDevEnvironment() {
  if (process.env.NODE_ENV === "production") {
    console.error("Tento skript sa odmieta spustiť s NODE_ENV=production — je LEN pre lokálny dev stack.");
    process.exit(1);
  }
  const urls = [process.env.DATABASE_URL, process.env.APP_DATABASE_URL].filter((v): v is string => !!v);
  for (const raw of urls) {
    const host = new URL(raw).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      console.error(`Databáza beží na "${host}", nie na localhoste — odmietam pokračovať.`);
      process.exit(1);
    }
  }
}

async function main() {
  assertLocalDevEnvironment();

  if (process.env.DEV_DISABLE_2FA !== "true") {
    console.error(
      "DEV_DISABLE_2FA nie je 'true' v .env.local — bez toho sa majiteľ zasekne na /2fa/overit. " +
        "Odkomentuj DEV_DISABLE_2FA=true, spusti znova a po skončení ho zase zakomentuj (viď docs/SCREENSHOTS.md).",
    );
    process.exit(1);
  }

  const cli = parseCliArgs(process.argv.slice(2));

  const { adminDb } = await import("../../lib/db/admin");
  const { workplaces } = await import("../../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [hotel] = await adminDb.select({ id: workplaces.id }).from(workplaces).where(eq(workplaces.code, "HOTEL")).limit(1);
  const [office] = await adminDb.select({ id: workplaces.id }).from(workplaces).where(eq(workplaces.code, "OFFICE")).limit(1);
  if (!hotel || !office) {
    console.error('Prevádzka s kódom "HOTEL"/"OFFICE" neexistuje — spusti najprv "npm run dev:bootstrap".');
    process.exit(1);
  }
  const workplaceIds: WorkplaceIds = { HOTEL: hotel.id, OFFICE: office.id };

  let targets = TARGETS.map((t) =>
    t.key === "kalendar-po-generovani" ? { ...t, path: nextMonthCalendarUrl().replace(BASE_URL, "") } : t,
  );
  if (cli.only) targets = targets.filter((t) => t.key === cli.only);
  if (cli.role) targets = targets.filter((t) => t.role === cli.role);
  if (targets.length === 0) {
    console.error(`Žiadny cieľ nezodpovedá filtru (--only=${cli.only ?? ""} --role=${cli.role ?? ""}).`);
    process.exit(1);
  }

  for (const dir of [outputDir("help"), outputDir("readme")]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const browser = await chromium.launch();
  const captureMoment = fixedCaptureMoment();
  console.log(`Ustálený čas stránky: ${captureMoment.toISOString()} (11:00 miestneho času, deň behu seedu).\n`);

  const roles = [...new Set(targets.map((t) => t.role))] as Role[];
  const statePaths = new Map<Role, string>();
  for (const role of roles) {
    console.log(`Prihlasujem sa ako ${role}...`);
    statePaths.set(role, await loginAndSaveState(browser, role));
  }

  const failures: { key: string; resolution: string; error: string }[] = [];
  let successCount = 0;

  for (const target of targets) {
    const resolutions: ("desktop" | "mobile")[] = [];
    const wantsDesktop = !target.mobileOnly && !cli.mobileOnly;
    const wantsMobile = !target.desktopOnly && !cli.desktopOnly;
    if (wantsDesktop) resolutions.push("desktop");
    if (wantsMobile) resolutions.push("mobile");

    for (const resolution of resolutions) {
      const label = `${target.key} (${target.category}, ${resolution})`;
      try {
        await captureOne(browser, target, resolution, statePaths.get(target.role)!, workplaceIds, captureMoment);
        console.log(`OK    ${label}`);
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`ZLYHALO ${label}: ${message}`);
        failures.push({ key: target.key, resolution, error: message });
      }
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Hotovo: ${successCount} úspešných, ${failures.length} zlyhaných.`);
  if (failures.length > 0) {
    console.log("\nZlyhania:");
    for (const f of failures) console.log(`  - ${f.key} (${f.resolution}): ${f.error}`);
    process.exit(1);
  }
  process.exit(0);
}

async function captureOne(
  browser: import("@playwright/test").Browser,
  target: ScreenshotTarget,
  resolution: "desktop" | "mobile",
  storageStatePath: string,
  workplaceIds: WorkplaceIds,
  captureMoment: Date,
) {
  const contextOptions =
    resolution === "desktop"
      ? { viewport: DESKTOP_VIEWPORT, deviceScaleFactor: 2, storageState: storageStatePath }
      : { ...MOBILE_CONTEXT, storageState: storageStatePath };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  try {
    await freezeClock(page, captureMoment);
    await page.goto(resolvePath(target, workplaceIds), { waitUntil: "networkidle" });
    await waitForReady(page, target.readyText);
    if (target.prepareState) await target.prepareState(page);

    // "-mobile" prípona len vtedy, keď pre TENTO kľúč existuje aj desktop
    // variant — inak by vznikol zbytočne kostrbatý názov (napr. cieľ, ktorý
    // je mobileOnly, nepotrebuje príponu na odlíšenie od niečoho, čo ani
    // nevznikne).
    const needsSuffix = resolution === "mobile" && !target.mobileOnly;
    const outPath = path.join(outputDir(target.category), `${target.key}${needsSuffix ? "-mobile" : ""}.png`);
    try {
      await captureFullPage(page, outPath);
    } finally {
      // AJ pri zlyhanom screenshote — inak dočasná zmena z prepareState
      // (napr. Janina spôsobilosť viesť zmenu) zostane v DB obrátená.
      if (target.cleanupState) await target.cleanupState(page);
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("Skript zlyhal:", err);
  process.exit(1);
});
