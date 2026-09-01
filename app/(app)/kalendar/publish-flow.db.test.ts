import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako assign-override.test.ts)
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import {
  employees,
  employeeWorkplaces,
  organizations,
  publishedShifts,
  scheduledShifts,
  shiftTemplates,
  users,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { getMyMonthCalendar } from "@/app/(app)/moj-rozvrh/data";
import { requireRole } from "@/lib/auth/session";
import { persistGenerateResult } from "@/lib/scheduler/db-writer";
import type { GenerateResult } from "@/lib/scheduler/generate";
import { publishScheduleAction } from "./actions";

/**
 * Zverejnenie rozvrhu — generovanie NESMIE ísť rovno naživo. Overuje sa celý
 * tok naraz (nie len jednotlivé funkcie izolovane): `persistGenerateResult`
 * (regenerácia vždy vracia na draft), `publishScheduleAction` (kopíruje
 * snímku do `published_shifts`), `getMyMonthCalendar` (zamestnanec číta
 * VÝHRADNE snímku) a RLS (`sched_select`/`published_shifts_select`) — ako
 * druhá, nezávislá vrstva obrany.
 */

const authState = vi.hoisted(() => ({ authUserId: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(authState.authUserId ? { "x-supabase-user-id": authState.authUserId } : {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let orgId: string;
let workplaceId: string;
let ownerAuthUserId: string;
let ownerUserId: string;
let employeeAuthUserId: string;
let employeeUserId: string;
let employeeId: string;
let otherEmployeeAuthUserId: string;
let otherEmployeeId: string;
let templateAId: string;
let templateBId: string;

const YEAR = 2029;
const MONTH = 4;
const DATE = "2029-04-10";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `publish-flow test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  workplaceId = wp.id;

  ownerAuthUserId = crypto.randomUUID();
  const [owner] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: ownerAuthUserId, email: `owner-${crypto.randomUUID()}@publishflow-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerUserId = owner.id;

  employeeAuthUserId = crypto.randomUUID();
  const [empUser] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: employeeAuthUserId, email: `emp-${crypto.randomUUID()}@publishflow-test.local`, role: "employee", fullName: "Jana Zamestnaná" })
    .returning();
  employeeUserId = empUser.id;
  const [employee] = await adminDb.insert(employees).values({ orgId, userId: employeeUserId, firstName: "Jana", lastName: "Zamestnaná", hiredOn: "2024-01-01" }).returning();
  employeeId = employee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId });

  otherEmployeeAuthUserId = crypto.randomUUID();
  const [otherUser] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: otherEmployeeAuthUserId, email: `other-${crypto.randomUUID()}@publishflow-test.local`, role: "employee", fullName: "Peter Iný" })
    .returning();
  const [otherEmployee] = await adminDb.insert(employees).values({ orgId, userId: otherUser.id, firstName: "Peter", lastName: "Iný", hiredOn: "2024-01-01" }).returning();
  otherEmployeeId = otherEmployee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId: otherEmployeeId, workplaceId });

  const [templateA] = await adminDb.insert(shiftTemplates).values({ workplaceId, name: "Ranná", code: `R-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30 }).returning();
  const [templateB] = await adminDb.insert(shiftTemplates).values({ workplaceId, name: "Poobedná", code: `P-${crypto.randomUUID().slice(0, 8)}`, startTime: "13:00:00", endTime: "21:00:00", breakMinutes: 30 }).returning();
  templateAId = templateA.id;
  templateBId = templateB.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

function makeResult(templateId: string, startTime: string, endTime: string): GenerateResult {
  return {
    assignments: [
      {
        employeeId,
        date: DATE,
        shiftTemplateId: templateId,
        startTime,
        endTime,
        crossesMidnight: false,
        breakMinutes: 30,
        source: "generated",
        candidatesConsidered: [],
      },
    ],
    gaps: [],
  };
}

describe("Zverejnenie rozvrhu — základný tok (generuj → draft → zamestnanec nič → zverejni → zamestnanec vidí)", () => {
  it("po prvom generovaní (draft) zamestnanec NEVIDÍ nič — schedules.status je 'draft'", async () => {
    const schedule = await withUserContext(ownerUserId, (tx) => persistGenerateResult(tx, workplaceId, YEAR, MONTH, makeResult(templateAId, "07:00:00", "15:00:00"), ownerUserId));
    expect(schedule.shiftsCreated).toBe(1);

    const [scheduleRow] = await adminDb.select().from((await import("@/lib/db/schema")).schedules).where(and(eq((await import("@/lib/db/schema")).schedules.workplaceId, workplaceId)));
    expect(scheduleRow.status).toBe("draft");

    authState.authUserId = employeeAuthUserId;
    const employeeUser = await requireRole("employee");
    const calendar = await getMyMonthCalendar(employeeUser, YEAR, MONTH);
    authState.authUserId = null;
    expect(calendar?.cells[DATE]).toBeUndefined(); // NIČ — návrh sa ešte nezverejnil
  });

  it("po 'Zverejniť' zamestnanec VIDÍ presne to, čo bolo v scheduled_shifts v momente kliknutia", async () => {
    authState.authUserId = ownerAuthUserId;
    await publishScheduleAction(form({ workplaceId, date: `${YEAR}-${String(MONTH).padStart(2, "0")}-01` }));
    authState.authUserId = null;

    authState.authUserId = employeeAuthUserId;
    const employeeUser = await requireRole("employee");
    const calendar = await getMyMonthCalendar(employeeUser, YEAR, MONTH);
    authState.authUserId = null;
    expect(calendar?.cells[DATE]).toMatchObject({ kind: "shift", templateName: "Ranná", startTime: "07:00:00", endTime: "15:00:00" });
  });

  it("REGENERÁCIA (iný obsah, napr. iná zmena) vracia schedules.status na 'draft' A zamestnanec ĎALEJ vidí STARÚ zverejnenú verziu, NIE nový návrh", async () => {
    const { schedules } = await import("@/lib/db/schema");
    // Pregeneruj — TERAZ s inou šablónou (Poobedná namiesto Rannej), simuluje reálnu zmenu obsahu.
    await withUserContext(ownerUserId, (tx) => persistGenerateResult(tx, workplaceId, YEAR, MONTH, makeResult(templateBId, "13:00:00", "21:00:00"), ownerUserId));

    const [scheduleRow] = await adminDb.select().from(schedules).where(eq(schedules.workplaceId, workplaceId));
    expect(scheduleRow.status).toBe("draft"); // KĽÚČOVÉ — nezostalo 'published' po regenerácii

    // scheduled_shifts (živý návrh manažéra) UŽ MÁ nový obsah.
    const [liveShift] = await adminDb.select().from(scheduledShifts).where(and(eq(scheduledShifts.employeeId, employeeId), eq(scheduledShifts.date, DATE)));
    expect(liveShift).toMatchObject({ startTime: "13:00:00", endTime: "21:00:00" });

    // Zamestnanec ale STÁLE vidí STARÚ (Rannú) — published_shifts sa regeneráciou vôbec nedotkla.
    authState.authUserId = employeeAuthUserId;
    const employeeUser = await requireRole("employee");
    const calendar = await getMyMonthCalendar(employeeUser, YEAR, MONTH);
    authState.authUserId = null;
    expect(calendar?.cells[DATE]).toMatchObject({ templateName: "Ranná", startTime: "07:00:00", endTime: "15:00:00" });
  });

  it("po OPÄTOVNOM 'Zverejniť' zamestnanec vidí NOVÝ obsah — stará snímka sa NAHRADÍ, nie akumuluje (žiadny duplicitný riadok)", async () => {
    authState.authUserId = ownerAuthUserId;
    await publishScheduleAction(form({ workplaceId, date: `${YEAR}-${String(MONTH).padStart(2, "0")}-01` }));
    authState.authUserId = null;

    const rows = await adminDb.select().from(publishedShifts).where(and(eq(publishedShifts.employeeId, employeeId), eq(publishedShifts.date, DATE)));
    expect(rows).toHaveLength(1); // AKTUALIZOVANÝ, nie druhý riadok navyše
    expect(rows[0]).toMatchObject({ startTime: "13:00:00", endTime: "21:00:00" });

    authState.authUserId = employeeAuthUserId;
    const employeeUser = await requireRole("employee");
    const calendar = await getMyMonthCalendar(employeeUser, YEAR, MONTH);
    authState.authUserId = null;
    expect(calendar?.cells[DATE]).toMatchObject({ templateName: "Poobedná", startTime: "13:00:00", endTime: "21:00:00" });
  });
});

describe("RLS — zamestnanec vidí LEN svoje smeny, LEN zverejnené (druhá vrstva obrany, nezávisle od appky)", () => {
  it("scheduled_shifts (draft): zamestnanec cez VLASTNÚ session NEVIDÍ ani VLASTNÝ draft riadok", async () => {
    const { schedules } = await import("@/lib/db/schema");
    const [scheduleRow] = await adminDb.select().from(schedules).where(eq(schedules.workplaceId, workplaceId));
    expect(scheduleRow.status).toBe("published"); // z predošlého bloku — over si predpoklad, potom regeneruj na draft
    await withUserContext(ownerUserId, (tx) => persistGenerateResult(tx, workplaceId, YEAR, MONTH, makeResult(templateAId, "07:00:00", "15:00:00"), ownerUserId));

    const rowsAsEmployee = await withUserContext(employeeUserId, (tx) => tx.select().from(scheduledShifts).where(eq(scheduledShifts.employeeId, employeeId)));
    expect(rowsAsEmployee).toHaveLength(0); // draft — RLS ho skryje, aj keď je to jeho VLASTNÝ riadok

    // Priamy dôkaz, že riadok REÁLNE existuje (adminDb, mimo RLS) — nejde o chýbajúce dáta, ale o RLS filter.
    const rowsAsAdmin = await adminDb.select().from(scheduledShifts).where(eq(scheduledShifts.employeeId, employeeId));
    expect(rowsAsAdmin.length).toBeGreaterThan(0);
  });

  it("scheduled_shifts (published): zamestnanec cez VLASTNÚ session vidí SVOJ riadok, ale NIKDY riadok INÉHO zamestnanca v tej istej prevádzke", async () => {
    authState.authUserId = ownerAuthUserId;
    await publishScheduleAction(form({ workplaceId, date: `${YEAR}-${String(MONTH).padStart(2, "0")}-01` }));
    authState.authUserId = null;

    // Iný zamestnanec dostane VLASTNÚ, priamo vloženú (adminDb) zmenu v TEJ ISTEJ prevádzke/deň.
    const { schedules } = await import("@/lib/db/schema");
    const [scheduleRow] = await adminDb.select().from(schedules).where(eq(schedules.workplaceId, workplaceId));
    await adminDb.insert(scheduledShifts).values({
      scheduleId: scheduleRow.id, employeeId: otherEmployeeId, workplaceId, date: DATE,
      startTime: "09:00:00", endTime: "17:00:00", breakMinutes: 30, crossesMidnight: false, source: "manual", locked: true,
    });

    const ownRows = await withUserContext(employeeUserId, (tx) => tx.select().from(scheduledShifts).where(eq(scheduledShifts.employeeId, employeeId)));
    expect(ownRows.length).toBeGreaterThan(0); // published, vlastné — vidí

    const teammateRows = await withUserContext(employeeUserId, (tx) => tx.select().from(scheduledShifts).where(eq(scheduledShifts.employeeId, otherEmployeeId)));
    expect(teammateRows).toHaveLength(0); // NIKDY cudzie, aj keď je to tá istá (published) prevádzka/deň
  });

  it("manažér/owner NEZMENENÝ — vidí VŠETKO (draft aj published, celý tím)", async () => {
    const rowsAsOwner = await withUserContext(ownerUserId, (tx) => tx.select().from(scheduledShifts).where(eq(scheduledShifts.workplaceId, workplaceId)));
    // owner vidí AJ vlastný zamestnancov riadok AJ toho druhého (otherEmployeeId) naraz, bez ohľadu na status.
    const employeeIds = new Set(rowsAsOwner.map((r) => r.employeeId));
    expect(employeeIds.has(employeeId)).toBe(true);
    expect(employeeIds.has(otherEmployeeId)).toBe(true);
  });
});
