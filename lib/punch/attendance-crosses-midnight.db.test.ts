import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/zamestnanca/plán/terminál priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employees, legalRules, organizations, punchEvents, qrTokens, scheduledShifts, schedules, terminals, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { determineDirection, recomputeAttendanceDay } from "@/lib/punch/attendance";
import { canonicalPunchMessage, computeHmac, encryptTerminalSecret } from "@/lib/punch/hmac";
import { issueQrToken } from "@/lib/punch/qr-token";
import { zonedTimeToUtc } from "@/lib/shared/time";
import { POST as punchPost } from "@/app/api/punch/route";

/**
 * Retest pred Blokom 12 (výkazy): pri overovaní, že `night_hours` (§123 ZP)
 * funguje end-to-end, sa zistilo, že REÁLNY pípací tok NIKDY nesprávne
 * nepočítal nočnú (crossesMidnight) zmenu — `determineDirection` aj
 * `recomputeAttendanceDay` boli scoped na JEDEN lokálny kalendárny deň,
 * čo pre zmenu s príchodom a odchodom na DVOCH rôznych
 * dňoch znamenalo: ranné odpípanie odchodu sa vyhodnotilo ako NOVÝ príchod
 * (nie odchod) a `workedHours` vyšlo 0 pre OBA dni. Bug predchádzal Blok 12
 * (je z Bloku 6/7) — tento súbor ho zamyká, aby sa nevrátil.
 */

let orgId: string;
let workplaceId: string;
let scheduleYesterday: { id: string };
const TERMINAL_SECRET = "esp32-midnight-secret-abcdef123456";
let deviceId: string;

function req(body: unknown): Request {
  return new Request("http://localhost/api/punch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function sign(devId: string, secret: string, token: string, timestamp: string) {
  return computeHmac(secret, canonicalPunchMessage(devId, token, timestamp));
}
async function freshEmployee(name: string) {
  const [row] = await adminDb.insert(employees).values({ orgId, firstName: name, lastName: "Nočný", hiredOn: "2024-01-01" }).returning();
  return row.id;
}
async function scheduleFor(year: number, month: number) {
  const [row] = await adminDb
    .insert(schedules)
    .values({ workplaceId, year, month })
    .onConflictDoUpdate({ target: [schedules.workplaceId, schedules.year, schedules.month], set: { year } })
    .returning();
  return row;
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `Crosses-midnight test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  deviceId = `esp32-midnight-${crypto.randomUUID()}`;
  await adminDb.insert(terminals).values({ workplaceId, name: "Vrátnica", deviceId, secretHash: encryptTerminalSecret(TERMINAL_SECRET), isActive: true });

  await adminDb.insert(legalRules).values({ orgId, code: "NIGHT_HOURS", name: "Nočná práca", params: { from: "22:00:00", to: "06:00:00" }, isHard: true, lawReference: "§ 123 ZP" });

  scheduleYesterday = await scheduleFor(2026, 9);
});

afterAll(async () => {
  await adminDb.delete(attendanceDays).where(eq(attendanceDays.workplaceId, workplaceId));
  await deleteOrgCascade(orgId);
});

describe("determineDirection — ranné odpípanie NOČNEJ zmeny sa vyhodnotí ako 'out' (nie nový 'in')", () => {
  it("príchod 22:00 (deň D), potom BEZ ďalších udalostí — over, že smer nasledujúceho razítka ráno (deň D+1) je 'out', attendanceDate=D", async () => {
    const empId = await freshEmployee("SmerNočný");
    await adminDb.insert(scheduledShifts).values({
      scheduleId: scheduleYesterday.id, employeeId: empId, workplaceId, date: "2026-09-10",
      startTime: "22:00:00", endTime: "06:00:00", breakMinutes: 30, crossesMidnight: true, source: "manual", locked: true,
    });

    await adminDb.insert(punchEvents).values({ employeeId: empId, workplaceId, direction: "in", method: "manual", occurredAt: zonedTimeToUtc("2026-09-10", "22:00:00") });

    const resolution = await determineDirection(adminDb, empId, workplaceId, "2026-09-11");
    expect(resolution).toEqual({ direction: "out", attendanceDate: "2026-09-10" });
  });

  it("normálny prípad (deň D+1 BEZ nočnej zmeny včera) je stále NEDOTKNUTÝ — prázdny deň → 'in', attendanceDate=dnešok", async () => {
    const empId = await freshEmployee("SmerObyčajný");
    const resolution = await determineDirection(adminDb, empId, workplaceId, "2026-09-15");
    expect(resolution).toEqual({ direction: "in", attendanceDate: "2026-09-15" });
  });
});

describe("recomputeAttendanceDay — nočná (crossesMidnight) zmena spojí razítka z DVOCH kalendárnych dní do JEDNÉHO výpočtu", () => {
  it("príchod 22:00 (D), odchod 06:00 (D+1), 30 min prestávka → workedHours 7.5 (NIE 0), nightHours 7.5, status 'done'", async () => {
    const empId = await freshEmployee("Prepočet");
    await adminDb.insert(scheduledShifts).values({
      scheduleId: scheduleYesterday.id, employeeId: empId, workplaceId, date: "2026-09-16",
      startTime: "22:00:00", endTime: "06:00:00", breakMinutes: 30, crossesMidnight: true, source: "manual", locked: true,
    });
    await adminDb.insert(punchEvents).values([
      { employeeId: empId, workplaceId, direction: "in", method: "manual", occurredAt: zonedTimeToUtc("2026-09-16", "22:00:00") },
      { employeeId: empId, workplaceId, direction: "out", method: "manual", occurredAt: zonedTimeToUtc("2026-09-17", "06:00:00") },
    ]);

    await recomputeAttendanceDay(adminDb, empId, workplaceId, "2026-09-16");

    const [day] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, empId), eq(attendanceDays.date, "2026-09-16")));
    expect(day.status).toBe("done");
    expect(Number(day.workedHours)).toBeCloseTo(7.5, 6);
    expect(Number(day.nightHours)).toBeCloseTo(7.5, 6);
    expect(day.actualEnd).not.toBeNull();
  });

  it("nočná zmena cez VÍKEND (sobota 22:00 → nedeľa 06:00) → weekendHours AJ nightHours súčasne, workedHours nie 0", async () => {
    const empId = await freshEmployee("Víkendový");
    // 2026-09-19 je sobota.
    await adminDb.insert(scheduledShifts).values({
      scheduleId: scheduleYesterday.id, employeeId: empId, workplaceId, date: "2026-09-19",
      startTime: "22:00:00", endTime: "06:00:00", breakMinutes: 30, crossesMidnight: true, source: "manual", locked: true,
    });
    await adminDb.insert(punchEvents).values([
      { employeeId: empId, workplaceId, direction: "in", method: "manual", occurredAt: zonedTimeToUtc("2026-09-19", "22:00:00") },
      { employeeId: empId, workplaceId, direction: "out", method: "manual", occurredAt: zonedTimeToUtc("2026-09-20", "06:00:00") },
    ]);

    await recomputeAttendanceDay(adminDb, empId, workplaceId, "2026-09-19");

    const [day] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, empId), eq(attendanceDays.date, "2026-09-19")));
    expect(Number(day.workedHours)).toBeCloseTo(7.5, 6);
    expect(Number(day.weekendHours)).toBeCloseTo(7.5, 6);
    expect(Number(day.nightHours)).toBeCloseTo(7.5, 6);
  });

  it("nočná zmena CEZ PRECHOD NA LETNÝ ČAS (28.→29.3.2026, posun 02:00→03:00) → 7h (NIE 8h), rovnaký DST efekt ako v Bloku 8, teraz aj cez celý DB pipeline", async () => {
    const empId = await freshEmployee("DSTový");
    const marchSchedule = await scheduleFor(2026, 3);
    await adminDb.insert(scheduledShifts).values({
      scheduleId: marchSchedule.id, employeeId: empId, workplaceId, date: "2026-03-28",
      startTime: "22:00:00", endTime: "06:00:00", breakMinutes: 0, crossesMidnight: true, source: "manual", locked: true,
    });
    await adminDb.insert(punchEvents).values([
      { employeeId: empId, workplaceId, direction: "in", method: "manual", occurredAt: zonedTimeToUtc("2026-03-28", "22:00:00") },
      { employeeId: empId, workplaceId, direction: "out", method: "manual", occurredAt: zonedTimeToUtc("2026-03-29", "06:00:00") },
    ]);

    await recomputeAttendanceDay(adminDb, empId, workplaceId, "2026-03-28");

    const [day] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, empId), eq(attendanceDays.date, "2026-03-28")));
    expect(Number(day.workedHours)).toBeCloseTo(7, 6); // DST ukrojí 1h, presne ako lib/payroll/calculate.test.ts
  });

  it("SAME-DAY zmena (nezasahuje do budúceho dňa) sa NEROZBILA — next-day dotaz sa ani nevykoná, žiadna zmena správania", async () => {
    const empId = await freshEmployee("Denný");
    await adminDb.insert(scheduledShifts).values({
      scheduleId: scheduleYesterday.id, employeeId: empId, workplaceId, date: "2026-09-21",
      startTime: "09:00:00", endTime: "17:00:00", breakMinutes: 30, crossesMidnight: false, source: "manual", locked: true,
    });
    await adminDb.insert(punchEvents).values([
      { employeeId: empId, workplaceId, direction: "in", method: "manual", occurredAt: zonedTimeToUtc("2026-09-21", "09:00:00") },
      { employeeId: empId, workplaceId, direction: "out", method: "manual", occurredAt: zonedTimeToUtc("2026-09-21", "17:00:00") },
    ]);

    await recomputeAttendanceDay(adminDb, empId, workplaceId, "2026-09-21");

    const [day] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, empId), eq(attendanceDays.date, "2026-09-21")));
    expect(Number(day.workedHours)).toBeCloseTo(7.5, 6);
    expect(Number(day.nightHours)).toBe(0);
  });
});

describe("End-to-end cez SKUTOČNÝ POST /api/punch (nie len interné funkcie) — nočná zmena, terminál", () => {
  it("príchod 22:00 (terminál) → 'in'; odchod 06:00 nasledujúci deň (terminál) → SPRÁVNE 'out' (nie mylný 'in'), attendance_days pod dňom PRÍCHODU sedí", async () => {
    const empId = await freshEmployee("Terminálový");
    await adminDb.insert(scheduledShifts).values({
      scheduleId: scheduleYesterday.id, employeeId: empId, workplaceId, date: "2026-09-23",
      startTime: "22:00:00", endTime: "06:00:00", breakMinutes: 30, crossesMidnight: true, source: "manual", locked: true,
    });

    const inToken = await issueQrToken(empId);
    await adminDb.insert(qrTokens).values({ jti: inToken.jti, employeeId: empId, expiresAt: new Date(Date.now() + 30_000) });
    const t1 = zonedTimeToUtc("2026-09-23", "22:00:00").toISOString();
    const hmac1 = sign(deviceId, TERMINAL_SECRET, inToken.token, t1);
    const res1 = await punchPost(req({ token: inToken.token, deviceId, timestamp: t1, hmac: hmac1 }));
    expect(res1.status).toBe(200);
    expect((await res1.json()).direction).toBe("in");

    const outToken = await issueQrToken(empId);
    await adminDb.insert(qrTokens).values({ jti: outToken.jti, employeeId: empId, expiresAt: new Date(Date.now() + 30_000) });
    const t2 = zonedTimeToUtc("2026-09-24", "06:00:00").toISOString();
    const hmac2 = sign(deviceId, TERMINAL_SECRET, outToken.token, t2);
    const res2 = await punchPost(req({ token: outToken.token, deviceId, timestamp: t2, hmac: hmac2 }));
    expect(res2.status).toBe(200);
    expect((await res2.json()).direction).toBe("out"); // <- toto bolo pred opravou mylne "in"

    const [day] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, empId), eq(attendanceDays.date, "2026-09-23")));
    expect(day.status).toBe("done");
    expect(Number(day.workedHours)).toBeCloseTo(7.5, 6); // <- toto bolo pred opravou 0
    expect(Number(day.nightHours)).toBeCloseTo(7.5, 6);
  }, 45_000); // 2× plný POST /api/punch — viac round-tripov než typický test, nad globálnych 30s
});
