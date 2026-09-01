import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/zamestnanca/plán priamo, mimo bežného app.user_id toku (rovnaká výnimka ako cron sám používa)
import { adminDb } from "@/lib/db/admin";
import {
  attendanceDays,
  employeePositionHistory,
  employees,
  notifications,
  organizations,
  positions,
  punchEvents,
  qrTokens,
  scheduledShifts,
  schedules,
  terminals,
  users,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade, testOrg } from "@/lib/db/test-fixture";
import { canonicalPunchMessage, computeHmac, encryptTerminalSecret } from "@/lib/punch/hmac";
import { issueQrToken } from "@/lib/punch/qr-token";
import { addDays, todayStr } from "@/lib/shared/dates";
import { zonedTimeToUtc } from "@/lib/shared/time";
import { POST as punchPost } from "@/app/api/punch/route";
import { runAutoClose } from "./auto-close";

/**
 * ZÁSADNÁ ZMENA POLITIKY — `runAutoClose()` už NEuzatvára
 * "obyčajné" zabudnuté odchody na plánovaný koniec zmeny/23:59 fallback.
 * Taká zmena teraz ostáva `status = 'working'` NAVŽDY, kým ju manažér ručne
 * neopraví (testy nižšie: "zostane otvorená"). Jediný prípad, ktorý sa STÁLE
 * uzatvára automaticky, je zamestnanec, čo odišiel na PRESTÁVKU a nevrátil sa
 * — vtedy máme dôkaz posledného momentu prítomnosti (posledný test v tomto
 * súbore, nezmenené správanie oproti pôvodnej prioritnej vetve).
 *
 * `runAutoClose()` nemá vstupný parameter — číta VŠETKY `status: 'working'`
 * dni v CELEJ DB naprieč organizáciami (service-role cron). Test preto
 * neoveruje agregovaný `closedCount` (v zdieľanej dev DB mohli byť aj iné
 * "working" riadky z iných behov), len KONKRÉTNY riadok tohto testu.
 */

let orgId: string;
let workplaceId: string;
let employeeId: string;
let employeeUserId: string;
let deviceId: string;
/** Druhá organizácia, založená priamo v druhom `it()` nižšie (potrebuje vlastný cleanup, viď afterAll). */
let secondOrgId: string | undefined;
const TERMINAL_SECRET = "esp32-autoclose-secret-abcdef123456";
const yesterday = addDays(todayStr(), -1);

// `testOrg()` MUSÍ byť na najvyššej úrovni súboru (registruje vlastné beforeAll/afterAll) — samostatná org pre dávkovací test nižšie, nezdieľa `secondOrgId`.
const batchOrg = testOrg("Auto-close batch");

function req(body: unknown): Request {
  return new Request("http://localhost/api/punch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sign(devId: string, secret: string, token: string, timestamp: string) {
  return computeHmac(secret, canonicalPunchMessage(devId, token, timestamp));
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `Auto-close test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  const [user] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `autoclose-${crypto.randomUUID()}@test.local`, role: "employee", fullName: "Zabudlivý Zamestnanec" })
    .returning();

  const [employee] = await adminDb
    .insert(employees)
    .values({ orgId, userId: user.id, firstName: "Zabudlivý", lastName: "Zamestnanec", hiredOn: "2024-01-01" })
    .returning();
  employeeId = employee.id;
  employeeUserId = user.id;

  const [y, m] = yesterday.split("-").map(Number);
  const [schedule] = await adminDb
    .insert(schedules)
    .values({ workplaceId, year: y, month: m })
    .onConflictDoUpdate({ target: [schedules.workplaceId, schedules.year, schedules.month], set: { year: y } })
    .returning();

  // Naplánovaná zmena VČERA, 09:00–17:00, 30 min prestávka (7.5h čistých).
  await adminDb.insert(scheduledShifts).values({
    scheduleId: schedule.id,
    employeeId,
    workplaceId,
    date: yesterday,
    startTime: "09:00:00",
    endTime: "17:00:00",
    breakMinutes: 30,
    crossesMidnight: false,
    source: "manual",
    locked: true,
  });

  deviceId = `esp32-autoclose-${crypto.randomUUID()}`;
  await adminDb.insert(terminals).values({ workplaceId, name: "Vrátnica", deviceId, secretHash: encryptTerminalSecret(TERMINAL_SECRET), isActive: true });

  // Zamestnanec pípne PRÍCHOD presne podľa plánu — a odchod už nikdy nepípne.
  const { token, jti } = await issueQrToken(employeeId);
  await adminDb.insert(qrTokens).values({ jti, employeeId, expiresAt: new Date(Date.now() + 30_000) });
  const inInstant = zonedTimeToUtc(yesterday, "09:00:00");
  const timestamp = inInstant.toISOString();
  const hmac = sign(deviceId, TERMINAL_SECRET, token, timestamp);
  const res = await punchPost(req({ token, deviceId, timestamp, hmac }));
  expect(res.status).toBe(200);

  const [dayBefore] = await adminDb
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, yesterday)));
  expect(dayBefore.status).toBe("working"); // sanity — pred auto-close MUSÍ byť ešte otvorený
});

afterAll(async () => {
  // deleteOrgCascade sama zistí, že punch_events blokuje (append-only),
  // a org bezpečne NECHÁ — ale skúsi to centrálne, konzistentne
  // so zvyškom sady, nie "zámerne nič".
  await deleteOrgCascade(orgId);
  if (secondOrgId) await deleteOrgCascade(secondOrgId);
});

describe("runAutoClose — zabudnutý odchod BEZ problému s prestávkou ZOSTANE OTVORENÝ (nová politika)", () => {
  it("žiadny fallback na plannedEnd ani 23:59 — status ostáva 'working', 0h, žiadna syntetická udalosť, žiadna notifikácia", async () => {
    await runAutoClose();

    const [day] = await adminDb
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, yesterday)));

    // Stále 'working' — NIE auto_closed. Zmena beží ďalej, kým ju manažér neopraví.
    expect(day.status).toBe("working");
    expect(day.actualEnd).toBeNull();
    expect(Number(day.workedHours)).toBe(0); // otvorená zmena sa nedomýšľa, nie je to 0 z chyby — je to jednoducho ešte nedokončené

    const autoCloseEvents = await adminDb
      .select()
      .from(punchEvents)
      .where(and(eq(punchEvents.employeeId, employeeId), eq(punchEvents.method, "auto_close")));
    expect(autoCloseEvents).toHaveLength(0);

    // Scoped na KONKRÉTNEHO zamestnanca (nie globálne kind='auto_closed') —
    // zdieľaná dev DB môže mať staré 'auto_closed' notifikácie z iných behov
    // s tým istým dátumom "yesterday" (rovnaký kalendárny deň behu).
    const notifRows = await adminDb
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "auto_closed"), eq(notifications.userId, employeeUserId)));
    expect(notifRows).toHaveLength(0);
  });

  it("bežiaci deň (status 'working', ale DNES, nie minulosť) sa NEDOTKNE — auto-close je len pre PREDCHÁDZAJÚCE dni", async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `Auto-close today-guard org ${crypto.randomUUID()}` }).returning();
    secondOrgId = org.id;
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: "HOTEL" }).returning();
    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId: org.id, firstName: "Dnešný", lastName: "Pracovník", hiredOn: "2024-01-01" })
      .returning();

    const todayDeviceId = `esp32-today-${crypto.randomUUID()}`;
    await adminDb.insert(terminals).values({ workplaceId: wp.id, name: "Vrátnica", deviceId: todayDeviceId, secretHash: encryptTerminalSecret(TERMINAL_SECRET), isActive: true });

    const { token, jti } = await issueQrToken(employee.id);
    await adminDb.insert(qrTokens).values({ jti, employeeId: employee.id, expiresAt: new Date(Date.now() + 30_000) });
    const timestamp = new Date().toISOString();
    const hmac = sign(todayDeviceId, TERMINAL_SECRET, token, timestamp);
    const res = await punchPost(req({ token, deviceId: todayDeviceId, timestamp, hmac }));
    expect(res.status).toBe(200);

    await runAutoClose();

    const [day] = await adminDb
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, todayStr())));
    expect(day.status).toBe("working"); // NEDOTKNUTÉ — je to dnešok, nie minulosť

    // Tento riadok OSTÁVA 'working' zámerne (to test overuje) — bez úklonu by
    // sa hromadil presne tak, ako sa raz reálne nahromadilo 183 riadkov.
    // attendance_days nie je append-only, mazanie je bezpečné.
    await adminDb.delete(attendanceDays).where(eq(attendanceDays.id, day.id));
  });

  it("nočná (crossesMidnight) zmena bez problému s prestávkou tiež ZOSTANE OTVORENÁ — crossesMidnight už auto-close vôbec nerieši", async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `Auto-close overnight org ${crypto.randomUUID()}` }).returning();
    secondOrgId = org.id;
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: "HOTEL" }).returning();
    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId: org.id, firstName: "Nočný", lastName: "Zabudlivec", hiredOn: "2024-01-01" })
      .returning();

    // -2 dni (nie -1) — aby aj VČEREJŠOK zmeny, aj jej plánovaný koniec (deň PO nej) boli bezpečne v minulosti.
    const shiftDate = addDays(todayStr(), -2);
    const [y, m] = shiftDate.split("-").map(Number);
    const [schedule] = await adminDb
      .insert(schedules)
      .values({ workplaceId: wp.id, year: y, month: m })
      .onConflictDoUpdate({ target: [schedules.workplaceId, schedules.year, schedules.month], set: { year: y } })
      .returning();
    await adminDb.insert(scheduledShifts).values({
      scheduleId: schedule.id, employeeId: employee.id, workplaceId: wp.id, date: shiftDate,
      startTime: "22:00:00", endTime: "06:00:00", breakMinutes: 30, crossesMidnight: true, source: "manual", locked: true,
    });

    const overnightDeviceId = `esp32-overnight-${crypto.randomUUID()}`;
    await adminDb.insert(terminals).values({ workplaceId: wp.id, name: "Vrátnica", deviceId: overnightDeviceId, secretHash: encryptTerminalSecret(TERMINAL_SECRET), isActive: true });

    const { token, jti } = await issueQrToken(employee.id);
    await adminDb.insert(qrTokens).values({ jti, employeeId: employee.id, expiresAt: new Date(Date.now() + 30_000) });
    const inInstant = zonedTimeToUtc(shiftDate, "22:00:00");
    const timestamp = inInstant.toISOString();
    const hmac = sign(overnightDeviceId, TERMINAL_SECRET, token, timestamp);
    const res = await punchPost(req({ token, deviceId: overnightDeviceId, timestamp, hmac }));
    expect(res.status).toBe(200);

    await runAutoClose();

    const [day] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, shiftDate)));
    expect(day.status).toBe("working");
    expect(day.actualEnd).toBeNull();
    expect(Number(day.workedHours)).toBe(0);
  }, 45_000); // plný POST /api/punch + runAutoClose() — viac round-tripov než typický test, nad globálnych 30s
});

describe("runAutoClose — JEDINÝ prípad, ktorý sa STÁLE uzatvára: odišiel na prestávku a nevrátil sa", () => {
  it("nevrátil sa z prestávky → uzavrie sa PRESNE na odchod na prestávku (jediná zostávajúca auto-close logika)", async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `Auto-close break org ${crypto.randomUUID()}` }).returning();
    secondOrgId = org.id;
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: "HOTEL" }).returning();
    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId: org.id, firstName: "Prestávkový", lastName: "Zabudlivec", hiredOn: "2024-01-01" })
      .returning();

    // Pozícia v režime "pipa" — bez toho by "automaticky" (default) hodiny
    // rátal z config breakMinutes bez ohľadu na (ne)uzavretú prestávku a
    // tento test by neoveroval nič nové oproti scenáru bez prestávok vôbec.
    const [position] = await adminDb
      .insert(positions)
      .values({ orgId: org.id, workplaceId: wp.id, name: "Recepcia", breakTrackingMode: "pipa" })
      .returning();
    await adminDb.insert(employeePositionHistory).values({ employeeId: employee.id, positionId: position.id, validFrom: "2024-01-01" });

    const shiftDate = addDays(todayStr(), -1);
    const [y, m] = shiftDate.split("-").map(Number);
    const [schedule] = await adminDb
      .insert(schedules)
      .values({ workplaceId: wp.id, year: y, month: m })
      .onConflictDoUpdate({ target: [schedules.workplaceId, schedules.year, schedules.month], set: { year: y } })
      .returning();
    // Naplánovaná zmena 09:00-17:00 — zamestnanec odíde na prestávku o 12:00 a UŽ SA NEVRÁTI (žiadny "in").
    await adminDb.insert(scheduledShifts).values({
      scheduleId: schedule.id, employeeId: employee.id, workplaceId: wp.id, date: shiftDate,
      startTime: "09:00:00", endTime: "17:00:00", breakMinutes: 30, crossesMidnight: false, source: "manual", locked: true,
    });

    const breakDeviceId = `esp32-break-${crypto.randomUUID()}`;
    await adminDb.insert(terminals).values({ workplaceId: wp.id, name: "Vrátnica", deviceId: breakDeviceId, secretHash: encryptTerminalSecret(TERMINAL_SECRET), isActive: true });

    async function punchAt(kind: "zmena" | "prestavka", time: string) {
      const { token, jti } = await issueQrToken(employee.id, kind);
      await adminDb.insert(qrTokens).values({ jti, employeeId: employee.id, expiresAt: new Date(Date.now() + 30_000) });
      const timestamp = zonedTimeToUtc(shiftDate, time).toISOString();
      const hmac = sign(breakDeviceId, TERMINAL_SECRET, token, timestamp);
      const res = await punchPost(req({ token, deviceId: breakDeviceId, timestamp, hmac }));
      expect(res.status).toBe(200);
    }

    await punchAt("zmena", "09:00:00");
    await punchAt("prestavka", "12:00:00"); // odchod na prestávku — a nikdy sa nevráti

    const [dayBefore] = await adminDb
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, shiftDate)));
    expect(dayBefore.status).toBe("working"); // sanity — pred auto-close ešte otvorený

    await runAutoClose();

    const [day] = await adminDb
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, shiftDate)));
    expect(day.status).toBe("auto_closed");

    // actualEnd MUSÍ byť 12:00 (odchod na prestávku), NIE 17:00 (plannedEnd).
    const expectedClose = zonedTimeToUtc(shiftDate, "12:00:00");
    expect(day.actualEnd!.getTime()).toBe(expectedClose.getTime());
    expect(Number(day.workedHours)).toBeCloseTo(3, 6); // 09:00-12:00, žiadna prestávka (nestihla sa uzavrieť)

    const zmenaAutoClose = (
      await adminDb.select().from(punchEvents).where(and(eq(punchEvents.employeeId, employee.id), eq(punchEvents.method, "auto_close")))
    ).filter((e) => e.kind === "zmena");
    expect(zmenaAutoClose).toHaveLength(1);
    expect(zmenaAutoClose[0].occurredAt.getTime()).toBe(expectedClose.getTime());
  });
});

describe("runAutoClose — DÁVKOVANIE (viacero stale riadkov v JEDNOM behu, bez krížovej kontaminácie)", () => {
  /**
   * Predtým `runAutoClose()` robil JEDEN DB round-trip PER stale riadok
   * (`eventsForLocalDate` v cykle) — pri desiatkach/stovkách nahromadených
   * riadkov to boli desiatky/stovky sieťových ciest (reálne
   * nájdené: 100 nahromadených testových riadkov spôsobilo timeout).
   * Oprava: JEDEN dopyt PER DISTINCT DÁTUM, zoskupený cez Map na
   * `employeeId|workplaceId`. Tento test overuje, že zoskupovanie je
   * SPRÁVNE — nie len rýchlejšie — keď v tom istom behu (ten istý deň)
   * existuje viacero zamestnancov s ROZDIELNYM osudom (uzavrieť/neuzavrieť),
   * vrátane dvoch rôznych prevádzok.
   */
  it("v jednom behu správne rozlíši: nevrátil sa (uzavrie), vrátil sa (nechá bežať), žiadna prestávka (nechá bežať) — naprieč dvoma prevádzkami", async () => {
    const [wpA] = await adminDb.insert(workplaces).values({ orgId: batchOrg.id, name: "Hotel", code: "HOTEL" }).returning();
    const [wpB] = await adminDb.insert(workplaces).values({ orgId: batchOrg.id, name: "Office", code: "OFFICE" }).returning();

    const [empGone, empReturned, empNoBreak] = await adminDb
      .insert(employees)
      .values([
        { orgId: batchOrg.id, firstName: "Nevrátený", lastName: "A", hiredOn: "2024-01-01" },
        { orgId: batchOrg.id, firstName: "Vrátený", lastName: "B", hiredOn: "2024-01-01" },
        { orgId: batchOrg.id, firstName: "BezPrestávky", lastName: "C", hiredOn: "2024-01-01" },
      ])
      .returning();

    const date = addDays(todayStr(), -1);

    // A (Hotel) — odišiel na prestávku, NEVRÁTIL sa → MUSÍ sa uzavrieť.
    await adminDb.insert(punchEvents).values([
      { employeeId: empGone.id, workplaceId: wpA.id, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") },
      { employeeId: empGone.id, workplaceId: wpA.id, direction: "out", method: "manual", kind: "prestavka", occurredAt: zonedTimeToUtc(date, "12:00:00") },
    ]);
    // B (Office — INÁ prevádzka, rovnaký deň) — odišiel na prestávku A SA VRÁTIL → NESMIE sa uzavrieť.
    await adminDb.insert(punchEvents).values([
      { employeeId: empReturned.id, workplaceId: wpB.id, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") },
      { employeeId: empReturned.id, workplaceId: wpB.id, direction: "out", method: "manual", kind: "prestavka", occurredAt: zonedTimeToUtc(date, "12:00:00") },
      { employeeId: empReturned.id, workplaceId: wpB.id, direction: "in", method: "manual", kind: "prestavka", occurredAt: zonedTimeToUtc(date, "12:30:00") },
    ]);
    // C (Hotel) — žiadna prestávka vôbec, len zabudnutý odchod → NESMIE sa uzavrieť (politika 7f).
    await adminDb.insert(punchEvents).values([
      { employeeId: empNoBreak.id, workplaceId: wpA.id, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") },
    ]);

    await adminDb.insert(attendanceDays).values([
      { employeeId: empGone.id, workplaceId: wpA.id, date, actualStart: zonedTimeToUtc(date, "09:00:00"), status: "working" },
      { employeeId: empReturned.id, workplaceId: wpB.id, date, actualStart: zonedTimeToUtc(date, "09:00:00"), status: "working" },
      { employeeId: empNoBreak.id, workplaceId: wpA.id, date, actualStart: zonedTimeToUtc(date, "09:00:00"), status: "working" },
    ]);

    await runAutoClose();

    const [dayGone] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, empGone.id), eq(attendanceDays.date, date)));
    expect(dayGone.status).toBe("auto_closed");
    expect(dayGone.actualEnd?.getTime()).toBe(zonedTimeToUtc(date, "12:00:00").getTime());

    const [dayReturned] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, empReturned.id), eq(attendanceDays.date, date)));
    expect(dayReturned.status).toBe("working");
    expect(dayReturned.actualEnd).toBeNull();

    const [dayNoBreak] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, empNoBreak.id), eq(attendanceDays.date, date)));
    expect(dayNoBreak.status).toBe("working");
    expect(dayNoBreak.actualEnd).toBeNull();

    // attendance_days NIE JE append-only — bezpečné upratať tie, čo runAutoClose zámerne nechal 'working'.
    await adminDb.delete(attendanceDays).where(inArray(attendanceDays.id, [dayReturned.id, dayNoBreak.id]));
  });
});
