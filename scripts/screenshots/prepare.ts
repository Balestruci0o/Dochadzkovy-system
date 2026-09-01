import type { Page } from "@playwright/test";
import { BASE_URL } from "./config";

/**
 * Riadok zamestnanca v tabuľkovom kalendári (`components/calendar/team-calendar.tsx`)
 * nemá stabilný selektor podľa `data-testid` ani `aria-label` — nájde sa
 * podľa viditeľného mena (odkaz na kartu zamestnanca), rovnako spoľahlivé a
 * menej krehké než CSS triedy.
 */
/**
 * `exact: true` by tu nesedelo — odkaz na kartu zamestnanca vnútri riadku
 * obsahuje aj text pozície (`PositionPill`) v tom istom `<a>`, takže jeho
 * prístupnostné meno je "Jana NovákováRecepcia", nie čisté meno. Podreťazec
 * (predvolené správanie bez `exact`) stačí — mená v demo dátach sú unikátne.
 */
function employeeRow(page: Page, employeeName: string) {
  return page.locator("tr", { has: page.getByRole("link", { name: employeeName }) });
}

/** `day` je číslo v mesiaci (1-31) — stĺpce dní nasledujú za prvým (meno) stĺpcom v tom istom poradí. */
async function clickDayCell(page: Page, employeeName: string, day: number) {
  await employeeRow(page, employeeName).locator("td").nth(day).locator("button").click();
}

/** kalendar-cell-picker — otvorené okno s ponukou zmien pre bežný deň. */
export async function openCellPicker(page: Page) {
  await clickDayCell(page, "Jana Nováková", 10);
  await page.getByText("Neprítomnosť", { exact: true }).waitFor({ state: "visible" });
}

type JanaLeaderFixture = { employeeId: string; workplaceId: string; positionId: string; day: number; dateStr: string };

/**
 * Jana má od Fázy S (kolo 3) `canBeShiftLeader: true` natrvalo v seede
 * (lib/db/seed.ts) — inak by mala Recepcia dni bez oprávneného kandidáta a
 * README kalendár by mal výstražné pruhy (`schedule_violations` sa zapisuje
 * PRI GENEROVANÍ, needitovateľná neskôr — preto to MUSÍ byť pravda už vtedy).
 *
 * Tento cieľ (`veduci-zmeny-priradenie`) potrebuje presný opak — a keďže
 * Recepcia má `minPeople: 1`, ktokoľvek je v daný deň priradený, je
 * JEDINÝ kandidát, takže ho `assignShiftLeaders` (lib/scheduler/shift-leader.ts)
 * pri generovaní VŽDY automaticky spraví vedúcim (nemá s kým súperiť) —
 * Jana je teda na VŠETKÝCH svojich dňoch už uložená ako vedúca
 * (`shift_leader_assignments`), skôr než sa jej živo vypne spôsobilosť.
 * Samotné vypnutie `canBeShiftLeader` preto NESTAČÍ — tlačidlo by ukázalo
 * "Odobrať ako vedúceho" (číta ULOŽENÉ priradenie), nie "Označiť...".
 * Treba zmazať aj jej uložené priradenie pre TEN JEDEN konkrétny deň, ktorý
 * sa použije na snímku — zvyšok mesiaca (a teda README kalendár, iný
 * cieľ) sa nedotkne.
 */
async function prepareJanaLeaderFixture(): Promise<JanaLeaderFixture> {
  const { adminDb } = await import("../../lib/db/admin");
  const { employees, users, workplaces, positions, publishedShifts } = await import("../../lib/db/schema");
  const { eq, and, asc } = await import("drizzle-orm");

  const [hotel] = await adminDb.select({ id: workplaces.id }).from(workplaces).where(eq(workplaces.code, "HOTEL")).limit(1);
  if (!hotel) throw new Error("prepareJanaLeaderFixture: prevádzka HOTEL sa nenašla.");

  const [recepcia] = await adminDb
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.workplaceId, hotel.id), eq(positions.name, "Recepcia")))
    .limit(1);
  if (!recepcia) throw new Error("prepareJanaLeaderFixture: pozícia Recepcia sa nenašla.");

  const [jana] = await adminDb
    .select({ employeeId: employees.id })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(users.email, "employee.hotel@dev.local"))
    .limit(1);
  if (!jana) throw new Error("prepareJanaLeaderFixture: employee.hotel@dev.local sa nenašiel.");

  const [shift] = await adminDb
    .select({ date: publishedShifts.date })
    .from(publishedShifts)
    .where(and(eq(publishedShifts.employeeId, jana.employeeId), eq(publishedShifts.workplaceId, hotel.id)))
    .orderBy(asc(publishedShifts.date))
    .limit(1);
  if (!shift) throw new Error("prepareJanaLeaderFixture: Jana nemá v aktuálnom mesiaci žiadnu zverejnenú zmenu.");

  return {
    employeeId: jana.employeeId,
    workplaceId: hotel.id,
    positionId: recepcia.id,
    day: Number(shift.date.slice(8, 10)),
    dateStr: shift.date,
  };
}

/** Vráti Janinu spôsobilosť späť na `true` — viď komentár pri `prepareJanaLeaderFixture`. */
export async function restoreShiftLeaderEligibility() {
  const { adminDb } = await import("../../lib/db/admin");
  const { employees, users } = await import("../../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const [row] = await adminDb
    .select({ employeeId: employees.id })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(users.email, "employee.hotel@dev.local"))
    .limit(1);
  if (row) await adminDb.update(employees).set({ canBeShiftLeader: true }).where(eq(employees.id, row.employeeId));
}

/**
 * veduci-zmeny-priradenie — pripraví presne JEDEN deň, kde Jana má zmenu,
 * NIE JE (živo) spôsobilá a NIE JE (uložene) vedúca, potom klikne na
 * "Označiť ako vedúceho zmeny" — vráti upozornenie + tlačidlo "AJ TAK"
 * (`ShiftLeaderToggle`, `components/calendar/cell-picker.tsx`) — presne to
 * má byť na obrázku. Neklikne sa na "AJ TAK" — obrázok má zachytiť LEN
 * upozornenie, nič sa naozaj nepriradí.
 */
export async function openShiftLeaderWarning(page: Page) {
  const { adminDb } = await import("../../lib/db/admin");
  const { employees, shiftLeaderAssignments } = await import("../../lib/db/schema");
  const { eq, and } = await import("drizzle-orm");

  const fixture = await prepareJanaLeaderFixture();
  await adminDb.update(employees).set({ canBeShiftLeader: false }).where(eq(employees.id, fixture.employeeId));
  await adminDb
    .delete(shiftLeaderAssignments)
    .where(
      and(
        eq(shiftLeaderAssignments.workplaceId, fixture.workplaceId),
        eq(shiftLeaderAssignments.positionId, fixture.positionId),
        eq(shiftLeaderAssignments.date, fixture.dateStr),
      ),
    );

  // "Označiť" vs. "Odobrať" (`isCurrentLeader`) je vypočítané zo servera
  // PRI NAČÍTANÍ STRÁNKY (RSC props), nie živo na klientovi — stránka bola
  // už načítaná PRED týmito zápismi (`waitForReady` v `index.ts` beží pred
  // `prepareState`), takže by ukazovala STARÝ stav. `reload()` vynúti nové
  // server-side vykreslenie, ktoré už vidí čerstvo zmazané priradenie.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Kalendár smien").first().waitFor({ state: "visible" });

  await clickDayCell(page, "Jana Nováková", fixture.day);
  await page.getByRole("button", { name: /^Označiť ako vedúceho zmeny/ }).click();
  await page.getByRole("button", { name: /AJ TAK$/ }).waitFor({ state: "visible", timeout: 5_000 });
}

/** Kalendár budúceho mesiaca — seed ho necháva vygenerovaný, ale NEzverejnený. */
export function nextMonthCalendarUrl(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${BASE_URL}/kalendar?workplace={workplace}&y=${next.getFullYear()}&m=${next.getMonth() + 1}`;
}

function openFormButton(label: string) {
  return async (page: Page) => {
    await page.getByRole("button", { name: label, exact: true }).click();
  };
}

export const openNewAccountForm = openFormButton("Nové konto");
export const openNewPositionForm = openFormButton("Nová pozícia");
export const openNewShiftTemplateForm = openFormButton("Nová šablóna");
export const openNewCoverageForm = openFormButton("Nové pravidlo");
export const openNewClosureForm = openFormButton("Pridať zatvorenie");
export const openNewTerminalForm = openFormButton("Nový terminál");
