import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako publish-flow.test.ts)
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { employees, employeeWorkplaces, organizations, punchEvents, schedules, scheduledShifts, shiftTemplates, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { determineDirection } from "@/lib/punch/attendance";
import { getMyAttendance } from "@/app/(app)/moja-dochadzka/data";
import type { CurrentUser } from "@/lib/auth/session";
import { DEFAULT_MANAGER_PERMISSIONS } from "@/lib/auth/manager-permissions";
import { addDays } from "@/lib/shared/dates";
import { localDateStr } from "@/lib/shared/time";

/**
 * Zverejnenie rozvrhu — priamo overuje obavu z code review: nová `sched_select`
 * RLS politika (employee: len vlastné + len published) mohla spôsobiť, že
 * `determineDirection`'s "crossesMidnight" lookup pod VLASTNOU RLS session
 * zamestnanca (volané z `moja-dochadzka/data.ts` len na POPISOK tlačidla,
 * NIE na skutočný zápis) nič nenašiel, keď bol mesiac DRAFT — aj keď smena
 * reálne existovala, čo viedlo k ZLÉMU smeru na tlačidle (Skutočne
 * zreprodukované pred opravou: `direction: 'in'` namiesto `'out'`).
 * Opravené — `determineDirection` teraz na TENTO konkrétny lookup používa
 * `adminDb` (viď komentár v `lib/punch/attendance.ts`), takže popisok
 * tlačidla sedí so skutočným zápisom bez ohľadu na RLS/draft stav.
 */

let orgId: string;
let workplaceId: string;
let employeeId: string;
let employeeUser: CurrentUser;
let today: string;
let yesterday: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `attendance-rls-gap test ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  workplaceId = wp.id;

  const authUserId = crypto.randomUUID();
  const [user] = await adminDb
    .insert(users)
    .values({ orgId, authUserId, email: `emp-${crypto.randomUUID()}@rls-gap-test.local`, role: "employee", fullName: "Nočná Zmena" })
    .returning();
  employeeUser = { id: user.id, authUserId, orgId, role: "employee", fullName: "Nočná Zmena", email: user.email ?? "", permissions: { ...DEFAULT_MANAGER_PERMISSIONS } };

  const [employee] = await adminDb.insert(employees).values({ orgId, userId: user.id, firstName: "Nočná", lastName: "Zmena", hiredOn: "2024-01-01" }).returning();
  employeeId = employee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId, isPrimary: true });

  const [template] = await adminDb
    .insert(shiftTemplates)
    .values({ workplaceId, name: "Nočná", code: `N-${crypto.randomUUID().slice(0, 8)}`, startTime: "22:00:00", endTime: "06:00:00", crossesMidnight: true, breakMinutes: 30 })
    .returning();

  today = localDateStr(new Date());
  yesterday = addDays(today, -1);

  // Mesiac je DRAFT (napr. manažér práve pregeneroval) — presne scenár z review.
  const d = new Date(`${yesterday}T00:00:00Z`);
  const [schedule] = await adminDb
    .insert(schedules)
    .values({ workplaceId, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, status: "draft" })
    .returning();

  await adminDb.insert(scheduledShifts).values({
    scheduleId: schedule.id,
    employeeId,
    workplaceId,
    date: yesterday,
    shiftTemplateId: template.id,
    startTime: "22:00:00",
    endTime: "06:00:00",
    breakMinutes: 30,
    crossesMidnight: true,
    source: "manual",
    locked: true,
  });

  // Zamestnanec včera VEČER pípol príchod na nočnú — dnes ešte NEPÍPOL odchod.
  await adminDb.insert(punchEvents).values({
    employeeId,
    workplaceId,
    direction: "in",
    method: "web",
    kind: "zmena",
    occurredAt: new Date(`${yesterday}T21:58:00Z`),
  });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("determineDirection pod RLS employee session — draft mesiac s nočnou zmenou", () => {
  it("PRAVDA (adminDb, plná viditeľnosť): ďalšie pípnutie MÁ byť 'out' (odchod z nočnej)", async () => {
    const truth = await adminDb.transaction((tx) => determineDirection(tx, employeeId, workplaceId, today, "zmena"));
    expect(truth.direction).toBe("out");
    expect(truth.attendanceDate).toBe(yesterday);
  });

  it("POD VLASTNOU RLS session zamestnanca (rovnaká funkcia, rovnaké vstupy) — MUSÍ sedieť s pravdou, aj keď je mesiac draft", async () => {
    const underRls = await withUserContext(employeeUser.id, (tx) => determineDirection(tx, employeeId, workplaceId, today, "zmena"));
    expect(underRls.direction).toBe("out");
    expect(underRls.attendanceDate).toBe(yesterday);
  });

  it("getMyAttendance (skutočná funkcia za /moja-dochadzka tlačidlom) — MUSÍ ukázať 'out' (Pípnuť odchod), nie 'in'", async () => {
    const attendance = await getMyAttendance(employeeUser);
    const state = attendance?.punchState.find((s) => s.workplaceId === workplaceId);
    expect(state?.nextZmenaDirection).toBe("out");
  });

  it("skutočný ZÁPIS (adminDb transakcia, presne ako /api/punch/web/route.ts) zostáva SPRÁVNY bez ohľadu na RLS", async () => {
    const writePathResult = await adminDb.transaction((tx) => determineDirection(tx, employeeId, workplaceId, today, "zmena"));
    expect(writePathResult.direction).toBe("out"); // /api/punch/web vždy používa adminDb — toto sa RLS netýka
  });
});
