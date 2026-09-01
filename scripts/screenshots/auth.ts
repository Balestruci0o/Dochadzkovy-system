import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Browser } from "@playwright/test";
import { ACCOUNTS, AUTH_STATE_DIR, BASE_URL, type Role } from "./config";

/**
 * Prihlási sa raz za rolu a uloží storageState na disk — volajúci potom
 * otvára nové kontexty s `storageState: authStatePath(role)` namiesto
 * opakovaného prihlasovania pred KAŽDÝM screenshotom (pomalé a krehké).
 *
 * Vyžaduje `DEV_DISABLE_2FA=true` (over v index.ts pred behom) — ak by sa
 * majiteľ presmeroval na `/2fa/overit`, táto funkcia to nahlási ako chybu
 * namiesto tichého zaseknutia (žiadne parsovanie OTP z konzoly, viď
 * SCREENSHOTS-PLAN.md).
 */
export async function loginAndSaveState(browser: Browser, role: Role): Promise<string> {
  const account = ACCOUNTS[role];
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/prihlasenie`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(account.email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(requirePassword());
  await page.locator('button[type="submit"]').first().click();

  await page.waitForURL((url) => url.pathname !== "/prihlasenie", { timeout: 15_000 });

  if (page.url().includes("/2fa/overit")) {
    await page.close();
    throw new Error(
      `Prihlásenie ${account.email} skončilo na /2fa/overit — nastav DEV_DISABLE_2FA=true v .env.local pred behom tohto skriptu (viď docs/SCREENSHOTS.md).`,
    );
  }

  await page.waitForLoadState("networkidle");

  const dir = path.resolve(AUTH_STATE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, `${role}.json`);
  await page.context().storageState({ path: statePath });
  await page.close();
  return statePath;
}

export function requirePassword(): string {
  const password = process.env.DEV_ACCOUNTS_PASSWORD;
  if (!password) {
    throw new Error("DEV_ACCOUNTS_PASSWORD nie je nastavená v .env.local — bez nej sa nedá prihlásiť na dev kontá.");
  }
  return password;
}
