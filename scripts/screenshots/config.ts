import type { Page } from "@playwright/test";
import { devices } from "@playwright/test";

export const BASE_URL = process.env.SCREENSHOTS_BASE_URL ?? "http://localhost:3000";

export const ACCOUNTS = {
  owner: { email: "owner@dev.local", label: "Martin Majiteľ" },
  manager: { email: "manager.hotel@dev.local", label: "Hana Hotelová" },
  employee: { email: "employee.hotel@dev.local", label: "Jana Nováková" },
} as const;

export type Role = keyof typeof ACCOUNTS;

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

/**
 * iPhone 13 preset s deviceScaleFactor NÚTENE na 2 — zadanie žiada presne
 * "iPhone 13 preset, deviceScaleFactor 2", ale samotný Playwright preset má
 * deviceScaleFactor 3 (skutočná hodnota zariadenia) — prepisujeme, nech je
 * konzistentné s desktopom (obe @2x, nie raz @2x a raz @3x).
 */
export const MOBILE_CONTEXT = {
  ...devices["iPhone 13"],
  deviceScaleFactor: 2,
};

export const HELP_SCREENSHOTS_DIR = "public/help/screenshots";
export const README_SCREENSHOTS_DIR = "docs/screenshots";

export const AUTH_STATE_DIR = "scripts/screenshots/.auth";

/**
 * Zmrazenie hodín stránky (Playwright `clock`) — stabilizuje KLIENTSKY
 * počítané relatívne časy (napr. `timeAgo()` v NotificationBell). Server
 * (Next.js dev proces) beží mimo prehliadača a jeho `new Date()` (dnešný
 * deň v Prehľad dňa, mesačné defaulty vo Výkazoch/Kalendári...) sa TAKTO
 * zmraziť nedá — to je vlastný proces, nie stránka. Preto sa tento skript
 * spolieha na to, že sa spúšťa TESNE po reseede (demo dáta v
 * `lib/db/seed-schedule.ts` sú relatívne k "dnes" pri seede) — viď
 * docs/SCREENSHOTS.md.
 */
export async function freezeClock(page: Page, at: Date) {
  await page.clock.install({ time: at });
}

export function fixedCaptureMoment(): Date {
  const now = new Date();
  now.setHours(11, 0, 0, 0);
  return now;
}
