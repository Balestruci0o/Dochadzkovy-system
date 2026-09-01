import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako kalendar/actions.test.ts)
import { adminDb } from "@/lib/db/admin";
import {
  attendanceDays,
  auditLog,
  employeePositionHistory,
  employees,
  employeeWorkplaces,
  managerWorkplaces,
  organizations,
  positions,
  punchEvents,
  users,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { eventsForLocalDate } from "@/lib/punch/attendance";
import { addDays, todayStr } from "@/lib/shared/dates";
import { zonedTimeToUtc } from "@/lib/shared/time";
import { addMissingPunchAction, deletePunchEventAction, directCorrectPunchAction, editPunchEventAction } from "./actions";

/**
 * Manažér/owner opraví príchod/odchod/prestávku PRIAMO (bez žiadosti a
 * schvaľovania zamestnanca) — nová funkcia, mirroring `dnes/actions.test.ts`
 * vzoru pre `approveCorrectionAction` (ten súbor bohužiaľ neexistuje — toto
 * je prvé automatické pokrytie tejto rodiny akcií, nielen tejto novej).
 *
 * Append-only — vždy NOVÁ `punch_events` udalosť s
 * `corrects_event_id`, pôvodná zostáva. `auth` mockovaný rovnako ako
 * `kalendar/actions.test.ts` (`next/headers` vráti overené
 * `x-supabase-user-id`, presne ako middleware.ts za normálnych okolností).
 */

const authState = vi.hoisted(() => ({ authUserId: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(authState.authUserId ? { "x-supabase-user-id": authState.authUserId } : {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let orgId: string;
let workplaceId: string;
let ownerAuthUserId: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `Direct correction test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  ownerAuthUserId = crypto.randomUUID();
  await adminDb.insert(users).values({
    orgId,
    authUserId: ownerAuthUserId,
    email: `owner-${crypto.randomUUID()}@direct-correction-test.local`,
    role: "owner",
    fullName: "Test Majiteľ",
  });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("directCorrectPunchAction — príchod/odchod (zmena)", () => {
  it("opraví príchod aj odchod, zapíše korektívne udalosti s corrects_event_id, prepočíta hodiny, nastaví isCorrected/correctedBy", async () => {
    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId, firstName: "Nesprávne", lastName: "Pípnutý", hiredOn: "2024-01-01" })
      .returning();

    const date = addDays(todayStr(), -1);
    const [originalIn] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:15:00") })
      .returning();
    const [originalOut] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "16:45:00") })
      .returning();
    const [day] = await adminDb
      .insert(attendanceDays)
      .values({ employeeId: employee.id, workplaceId, date, actualStart: originalIn.occurredAt, actualEnd: originalOut.occurredAt, status: "done" })
      .returning();

    authState.authUserId = ownerAuthUserId;
    const result = await directCorrectPunchAction(
      {},
      form({ attendanceDayId: day.id, requestedStart: "09:00", requestedEnd: "17:00", reason: "Terminál mal poruchu, čas podľa knihy." }),
    );
    expect(result.success).toBe(true);

    const [updated] = await adminDb.select().from(attendanceDays).where(eq(attendanceDays.id, day.id));
    expect(updated.isCorrected).toBe(true);
    expect(updated.correctedBy).not.toBeNull();
    expect(updated.correctionNote).toBe("Terminál mal poruchu, čas podľa knihy.");
    expect(Number(updated.workedHours)).toBeCloseTo(8, 6); // 09:00-17:00, žiadna prestávka nakonfigurovaná

    const events = await adminDb.select().from(punchEvents).where(and(eq(punchEvents.employeeId, employee.id), eq(punchEvents.method, "manual")));
    const correctiveIn = events.find((e) => e.correctsEventId === originalIn.id);
    const correctiveOut = events.find((e) => e.correctsEventId === originalOut.id);
    expect(correctiveIn).toBeTruthy();
    expect(correctiveOut).toBeTruthy();
    expect(correctiveIn!.occurredAt.getTime()).toBe(zonedTimeToUtc(date, "09:00:00").getTime());
    expect(correctiveOut!.occurredAt.getTime()).toBe(zonedTimeToUtc(date, "17:00:00").getTime());
    expect(correctiveIn!.createdBy).not.toBeNull();

    // Pôvodné udalosti OSTÁVAJÚ (append-only) — nezmazané, nezmenené.
    const [stillOriginalIn] = await adminDb.select().from(punchEvents).where(eq(punchEvents.id, originalIn.id));
    expect(stillOriginalIn.occurredAt.getTime()).toBe(zonedTimeToUtc(date, "09:15:00").getTime());
  });

  it("uzamknutý deň (is_locked) sa NEDÁ opraviť", async () => {
    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId, firstName: "Uzamknutý", lastName: "Deň", hiredOn: "2024-01-01" })
      .returning();
    const date = addDays(todayStr(), -1);
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "done", isLocked: true }).returning();

    authState.authUserId = ownerAuthUserId;
    const result = await directCorrectPunchAction({}, form({ attendanceDayId: day.id, requestedStart: "09:00", reason: "test" }));
    expect(result.error).toMatch(/uzamknutý/i);

    const [unchanged] = await adminDb.select().from(attendanceDays).where(eq(attendanceDays.id, day.id));
    expect(unchanged.isCorrected).toBe(false);
  });

  it("bez vyplneného dôvodu vráti chybu, nezapíše nič", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Bez", lastName: "Dôvodu", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "done" }).returning();

    authState.authUserId = ownerAuthUserId;
    const result = await directCorrectPunchAction({}, form({ attendanceDayId: day.id, requestedStart: "09:00", reason: "" }));
    expect(result.error).toMatch(/dôvod/i);
  });

  it("bez vyplneného ani jedného času vráti chybu", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Prázdny", lastName: "Formulár", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "done" }).returning();

    authState.authUserId = ownerAuthUserId;
    const result = await directCorrectPunchAction({}, form({ attendanceDayId: day.id, reason: "test" }));
    expect(result.error).toMatch(/aspoň jeden čas/i);
  });
});

describe("directCorrectPunchAction — prestávka (pípanie prestávok)", () => {
  it("'pipa' pozícia: opraví prestávku (odchod aj návrat), hodiny odrátajú SKUTOČNÚ opravenú dĺžku prestávky", async () => {
    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia", breakTrackingMode: "pipa" }).returning();
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Prestávkový", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeePositionHistory).values({ employeeId: employee.id, positionId: position.id, validFrom: "2024-01-01" });

    const date = addDays(todayStr(), -1);
    await adminDb.insert(punchEvents).values([
      { employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") },
      { employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "17:00:00") },
    ]);
    const [breakOut] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "prestavka", occurredAt: zonedTimeToUtc(date, "12:00:00") })
      .returning();
    const [breakIn] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "prestavka", occurredAt: zonedTimeToUtc(date, "12:15:00") }) // reálne len 15 min, mal to byť 30
      .returning();
    const [day] = await adminDb
      .insert(attendanceDays)
      .values({ employeeId: employee.id, workplaceId, date, actualStart: zonedTimeToUtc(date, "09:00:00"), actualEnd: zonedTimeToUtc(date, "17:00:00"), status: "done" })
      .returning();

    authState.authUserId = ownerAuthUserId;
    const result = await directCorrectPunchAction(
      {},
      form({ attendanceDayId: day.id, requestedBreakStart: "12:00", requestedBreakEnd: "12:30", reason: "Reálne bola prestávka 30 min, terminál zaznamenal zle." }),
    );
    expect(result.success).toBe(true);

    const [updated] = await adminDb.select().from(attendanceDays).where(eq(attendanceDays.id, day.id));
    expect(Number(updated.workedHours)).toBeCloseTo(7.5, 6); // 09:00-17:00 (8h) - 30 min opravená prestávka

    const correctiveBreakOut = (await adminDb.select().from(punchEvents).where(eq(punchEvents.correctsEventId, breakOut.id)))[0];
    const correctiveBreakIn = (await adminDb.select().from(punchEvents).where(eq(punchEvents.correctsEventId, breakIn.id)))[0];
    expect(correctiveBreakOut?.kind).toBe("prestavka");
    expect(correctiveBreakIn?.kind).toBe("prestavka");
  });

  it("'automaticky' pozícia: prestávka sa NEDÁ opraviť pípnutím — jasná chyba, žiadny zápis", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Automatický", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    // Žiadna pozícia/breakTrackingMode override → default "automaticky" (resolveBreakTrackingMode).
    const date = addDays(todayStr(), -1);
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "done" }).returning();

    authState.authUserId = ownerAuthUserId;
    const result = await directCorrectPunchAction(
      {},
      form({ attendanceDayId: day.id, requestedBreakStart: "12:00", requestedBreakEnd: "12:30", reason: "test" }),
    );
    expect(result.error).toMatch(/automaticky zo šablóny/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(0);
  });
});

describe("editPunchEventAction — granulárna oprava JEDNÉHO pípnutia", () => {
  it("opraví čas jedného pípnutia (rovnaký smer/typ) — jedna korektívna udalosť, pôvodná ostáva, hodiny sa prepočítajú", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Jeden", lastName: "Punkt", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [originalIn] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:20:00") })
      .returning();
    await adminDb.insert(punchEvents).values({ employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "17:00:00") });
    const [day] = await adminDb
      .insert(attendanceDays)
      .values({ employeeId: employee.id, workplaceId, date, actualStart: zonedTimeToUtc(date, "09:20:00"), actualEnd: zonedTimeToUtc(date, "17:00:00"), status: "done" })
      .returning();

    authState.authUserId = ownerAuthUserId;
    const result = await editPunchEventAction(
      {},
      form({ attendanceDayId: day.id, eventId: String(originalIn.id), newTime: "09:00", newKind: "zmena", newDirection: "in", reason: "Meškanie termi nálu, reálne prišiel o 9:00." }),
    );
    expect(result.success).toBe(true);

    const [updated] = await adminDb.select().from(attendanceDays).where(eq(attendanceDays.id, day.id));
    expect(Number(updated.workedHours)).toBeCloseTo(8, 6); // 09:00-17:00

    const corrective = (await adminDb.select().from(punchEvents).where(eq(punchEvents.correctsEventId, originalIn.id)))[0];
    expect(corrective).toBeTruthy();
    expect(corrective.isVoid).toBe(false);
    expect(corrective.occurredAt.getTime()).toBe(zonedTimeToUtc(date, "09:00:00").getTime());
    expect(corrective.createdBy).not.toBeNull();

    // Pôvodná udalosť OSTÁVA nezmenená (append-only).
    const [stillOriginal] = await adminDb.select().from(punchEvents).where(eq(punchEvents.id, originalIn.id));
    expect(stillOriginal.occurredAt.getTime()).toBe(zonedTimeToUtc(date, "09:20:00").getTime());
    expect(stillOriginal.isVoid).toBe(false);
  });

  it("zmení TYP pípnutia (prestávka → smena) — anuluje pôvodnú V JEJ KIND (is_void), vloží novú SAMOSTATNÚ udalosť v novom kind; eventsForLocalDate správne prestane vidieť pôvodnú aj pre pôvodný kind", async () => {
    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia-typ", breakTrackingMode: "pipa" }).returning();
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Zlý", lastName: "Typ", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeePositionHistory).values({ employeeId: employee.id, positionId: position.id, validFrom: "2024-01-01" });

    const date = addDays(todayStr(), -1);
    await adminDb.insert(punchEvents).values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") });
    // Omylom napípnuté ako "prestavka" namiesto skutočného odchodu ("zmena"/"out").
    const [misKinded] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "prestavka", occurredAt: zonedTimeToUtc(date, "17:00:00") })
      .returning();
    const [day] = await adminDb
      .insert(attendanceDays)
      .values({ employeeId: employee.id, workplaceId, date, actualStart: zonedTimeToUtc(date, "09:00:00"), status: "working" })
      .returning();

    authState.authUserId = ownerAuthUserId;
    const result = await editPunchEventAction(
      {},
      form({ attendanceDayId: day.id, eventId: String(misKinded.id), newTime: "17:00", newKind: "zmena", newDirection: "out", reason: "Omylom pípnuté ako prestávka namiesto odchodu." }),
    );
    expect(result.success).toBe(true);

    const [updated] = await adminDb.select().from(attendanceDays).where(eq(attendanceDays.id, day.id));
    expect(updated.status).toBe("done");
    expect(Number(updated.workedHours)).toBeCloseTo(8, 6); // 09:00-17:00, žiadna prestávka (mis-kinded event bol anulovaný, nie skutočná prestávka)

    // Pôvodná (prestavka) je anulovaná JEJ VLASTNÝM kind — inak by ju dopyt na "prestavka" nevidel ako nahradenú.
    const voidMarker = (await adminDb.select().from(punchEvents).where(eq(punchEvents.correctsEventId, misKinded.id)))[0];
    expect(voidMarker.kind).toBe("prestavka");
    expect(voidMarker.isVoid).toBe(true);

    // eventsForLocalDate pre kind="prestavka" už nevidí VÔBEC ŽIADNU udalosť (pôvodná aj anulačná sú vynechané).
    const prestavkaEvents = await eventsForLocalDate(adminDb, employee.id, workplaceId, date, "prestavka");
    expect(prestavkaEvents).toHaveLength(0);

    // Nová, samostatná "zmena"/"out" udalosť existuje a je efektívna.
    const zmenaEvents = await eventsForLocalDate(adminDb, employee.id, workplaceId, date, "zmena");
    expect(zmenaEvents.map((e) => e.direction)).toEqual(["in", "out"]);
    expect(zmenaEvents[1].occurredAt.getTime()).toBe(zonedTimeToUtc(date, "17:00:00").getTime());
  });

  it("úprava BEZ ZMENY (rovnaký smer/typ/čas) vráti chybu 'Nič sa nezmenilo', nezapíše nič", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Beze", lastName: "Zmeny", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [original] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") })
      .returning();
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "working" }).returning();

    authState.authUserId = ownerAuthUserId;
    const result = await editPunchEventAction(
      {},
      form({ attendanceDayId: day.id, eventId: String(original.id), newTime: "09:00", newKind: "zmena", newDirection: "in", reason: "test" }),
    );
    expect(result.error).toMatch(/nič sa nezmenilo/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(1); // len pôvodná, žiadna nová
  });

  it("opakovaná úprava TOHO ISTÉHO (už opraveného) pípnutia zo zastaranej UI je odmietnutá (idempotencia)", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Dvakrát", lastName: "Opravený", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [original] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:20:00") })
      .returning();
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "working" }).returning();

    authState.authUserId = ownerAuthUserId;
    const first = await editPunchEventAction(
      {},
      form({ attendanceDayId: day.id, eventId: String(original.id), newTime: "09:00", newKind: "zmena", newDirection: "in", reason: "prvá oprava" }),
    );
    expect(first.success).toBe(true);

    // Druhý pokus na TEN ISTÝ (už nahradený) pôvodný eventId — musí byť odmietnutý.
    const second = await editPunchEventAction(
      {},
      form({ attendanceDayId: day.id, eventId: String(original.id), newTime: "08:30", newKind: "zmena", newDirection: "in", reason: "druhá oprava" }),
    );
    expect(second.error).toMatch(/už bolo upravené/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(2); // pôvodná + JEDNA korekcia, druhý pokus nič nepridal
  });

  it("uzamknutý deň — granulárna oprava sa NEDÁ vykonať", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Uzamknutý2", lastName: "Bod", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [original] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") })
      .returning();
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "working", isLocked: true }).returning();

    authState.authUserId = ownerAuthUserId;
    const result = await editPunchEventAction(
      {},
      form({ attendanceDayId: day.id, eventId: String(original.id), newTime: "08:00", newKind: "zmena", newDirection: "in", reason: "test" }),
    );
    expect(result.error).toMatch(/uzamknutý/i);
  });
});

describe("deletePunchEventAction — zmazanie JEDNÉHO pípnutia (append-only: anulácia BEZ náhrady)", () => {
  it("zmaže omylom vytvorené duplicitné pípnutie — pôvodná udalosť ostáva v DB (append-only), ale prestane sa počítať", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Duplicitný", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    await adminDb.insert(punchEvents).values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") });
    // Duplicitné "out" omylom napípnuté hneď za príchodom (napr. dvakrát klikol).
    const [duplicateOut] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:01:00") })
      .returning();
    await adminDb.insert(punchEvents).values({ employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "17:00:00") });
    const [day] = await adminDb
      .insert(attendanceDays)
      .values({ employeeId: employee.id, workplaceId, date, actualStart: zonedTimeToUtc(date, "09:00:00"), actualEnd: zonedTimeToUtc(date, "17:00:00"), status: "done" })
      .returning();

    authState.authUserId = ownerAuthUserId;
    const result = await deletePunchEventAction(
      {},
      form({ attendanceDayId: day.id, eventId: String(duplicateOut.id), reason: "Omylom dvakrát kliknuté na termináli." }),
    );
    expect(result.success).toBe(true);

    // Pôvodný duplicitný riadok OSTÁVA v DB (append-only) — nezmazaný, nezmenený.
    const [stillThere] = await adminDb.select().from(punchEvents).where(eq(punchEvents.id, duplicateOut.id));
    expect(stillThere).toBeTruthy();
    expect(stillThere.occurredAt.getTime()).toBe(zonedTimeToUtc(date, "09:01:00").getTime());
    expect(stillThere.isVoid).toBe(false); // pôvodná udalosť sama osebe sa NEEDITUJE

    // Anulačná udalosť existuje, ukazuje na pôvodnú, is_void=true.
    const voidMarker = (await adminDb.select().from(punchEvents).where(eq(punchEvents.correctsEventId, duplicateOut.id)))[0];
    expect(voidMarker.isVoid).toBe(true);
    expect(voidMarker.createdBy).not.toBeNull();

    // eventsForLocalDate už duplicitný pár vôbec nevidí — zostáva len skutočný in/out.
    const effective = await eventsForLocalDate(adminDb, employee.id, workplaceId, date, "zmena");
    expect(effective.map((e) => `${e.direction}@${e.occurredAt.toISOString()}`)).toEqual([
      `in@${zonedTimeToUtc(date, "09:00:00").toISOString()}`,
      `out@${zonedTimeToUtc(date, "17:00:00").toISOString()}`,
    ]);

    const [updated] = await adminDb.select().from(attendanceDays).where(eq(attendanceDays.id, day.id));
    expect(Number(updated.workedHours)).toBeCloseTo(8, 6); // 09:00-17:00, duplicitný pár nemal žiadny vplyv
  });

  it("bez dôvodu vráti chybu, nič nezapíše", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Bez2", lastName: "Dôvodu", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [original] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") })
      .returning();
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "working" }).returning();

    authState.authUserId = ownerAuthUserId;
    const result = await deletePunchEventAction({}, form({ attendanceDayId: day.id, eventId: String(original.id), reason: "" }));
    expect(result.error).toMatch(/dôvod/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(1);
  });

  it("eventId, čo nepatrí danému attendanceDayId (iný zamestnanec), je odmietnutý", async () => {
    const [employeeA] = await adminDb.insert(employees).values({ orgId, firstName: "Áčko", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    const [employeeB] = await adminDb.insert(employees).values({ orgId, firstName: "Béčko", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [eventB] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employeeB.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:00:00") })
      .returning();
    const [dayA] = await adminDb.insert(attendanceDays).values({ employeeId: employeeA.id, workplaceId, date, status: "working" }).returning();

    authState.authUserId = ownerAuthUserId;
    // Skúša zmazať B-čkovu udalosť cez A-čkov attendanceDayId.
    const result = await deletePunchEventAction({}, form({ attendanceDayId: dayA.id, eventId: String(eventB.id), reason: "test" }));
    expect(result.error).toMatch(/nenájdené/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employeeB.id));
    expect(events).toHaveLength(1); // B-čkova udalosť nedotknutá
  });
});

describe("Audit log — punch_events aj attendance_days korekcie majú changed_by = manažér (nie NULL)", () => {
  it("editPunchEventAction zapíše audit_log riadok pre punch_events s changed_by = owner", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Auditovaný", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [original] = await adminDb
      .insert(punchEvents)
      .values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:20:00") })
      .returning();
    const [day] = await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "working" }).returning();

    const [ownerUser] = await adminDb.select().from(users).where(eq(users.authUserId, ownerAuthUserId));

    authState.authUserId = ownerAuthUserId;
    const result = await editPunchEventAction(
      {},
      form({ attendanceDayId: day.id, eventId: String(original.id), newTime: "09:00", newKind: "zmena", newDirection: "in", reason: "audit test" }),
    );
    expect(result.success).toBe(true);

    const corrective = (await adminDb.select().from(punchEvents).where(eq(punchEvents.correctsEventId, original.id)))[0];

    const punchAudit = await adminDb.select().from(auditLog).where(and(eq(auditLog.tableName, "punch_events"), eq(auditLog.recordId, String(corrective.id))));
    expect(punchAudit).toHaveLength(1);
    expect(punchAudit[0].changedBy).toBe(ownerUser.id); // nie NULL — set_config('app.user_id', ...) v transakcii zafungoval
    expect(punchAudit[0].action).toBe("INSERT");

    const attendanceAudit = await adminDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "attendance_days"), eq(auditLog.recordId, day.id)))
      .orderBy(auditLog.changedAt);
    const lastAttendanceAudit = attendanceAudit.at(-1);
    expect(lastAttendanceAudit?.changedBy).toBe(ownerUser.id);
  });
});

describe("addMissingPunchAction — manažér/owner pridá pípnutie PRIAMO, bez žiadosti zamestnanca", () => {
  it("pridá pípnutie pre deň BEZ AKÉHOKOĽVEK predchádzajúceho attendance_days riadku — vytvorí deň, zapíše pípnutie, audit", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Terminál", lastName: "Nešiel", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    const date = addDays(todayStr(), -1);

    const before = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, date)));
    expect(before).toHaveLength(0);

    const [ownerUser] = await adminDb.select().from(users).where(eq(users.authUserId, ownerAuthUserId));

    authState.authUserId = ownerAuthUserId;
    const result = await addMissingPunchAction(
      {},
      form({ employeeId: employee.id, workplaceId, date, direction: "in", kind: "zmena", time: "09:00", reason: "Terminál nešiel, zamestnanec potvrdil čas dodatočne." }),
    );
    expect(result.success).toBe(true);

    const [day] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, date)));
    expect(day).toBeTruthy();
    expect(day.isCorrected).toBe(true);
    expect(day.correctedBy).toBe(ownerUser.id);

    const [inserted] = await adminDb.select().from(punchEvents).where(and(eq(punchEvents.employeeId, employee.id), eq(punchEvents.method, "manual")));
    expect(inserted).toBeTruthy();
    expect(inserted.occurredAt.getTime()).toBe(zonedTimeToUtc(date, "09:00:00").getTime());
    expect(inserted.correctsEventId).toBeNull();

    const punchAudit = await adminDb.select().from(auditLog).where(and(eq(auditLog.tableName, "punch_events"), eq(auditLog.recordId, String(inserted.id))));
    expect(punchAudit).toHaveLength(1);
    expect(punchAudit[0].changedBy).toBe(ownerUser.id);
  });

  it("existujúci UZAMKNUTÝ deň sa nedá takto obísť", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Uzamknutý3", lastName: "Priamo", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    const date = addDays(todayStr(), -1);
    await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date, status: "done", isLocked: true });

    authState.authUserId = ownerAuthUserId;
    const result = await addMissingPunchAction({}, form({ employeeId: employee.id, workplaceId, date, direction: "in", kind: "zmena", time: "09:00", reason: "test" }));
    expect(result.error).toMatch(/uzamknutý/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(0);
  });

  it("zamestnanec, čo NEPATRÍ do danej prevádzky, je odmietnutý", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Nepatriaci", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    // Zámerne BEZ employeeWorkplaces záznamu pre `workplaceId`.
    const date = addDays(todayStr(), -1);

    authState.authUserId = ownerAuthUserId;
    const result = await addMissingPunchAction({}, form({ employeeId: employee.id, workplaceId, date, direction: "in", kind: "zmena", time: "09:00", reason: "test" }));
    expect(result.error).toMatch(/nenájdený alebo nemáš prístup/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(0);
  });

  it("'automaticky' pozícia + kind=prestavka je odmietnuté (prestávka sa počíta zo šablóny, nie pípnutím)", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Automatická2", lastName: "Prestávka", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    const date = addDays(todayStr(), -1);

    authState.authUserId = ownerAuthUserId;
    const result = await addMissingPunchAction({}, form({ employeeId: employee.id, workplaceId, date, direction: "out", kind: "prestavka", time: "12:00", reason: "test" }));
    expect(result.error).toMatch(/automaticky zo šablóny/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(0);
  });

  it("manažér BEZ prístupu k prevádzke zamestnanca je odmietnutý (RLS cez employee_workplaces_select)", async () => {
    const [otherWorkplace] = await adminDb.insert(workplaces).values({ orgId, name: "Office", code: "OFFICE" }).returning();
    const managerAuthUserId = crypto.randomUUID();
    await adminDb.insert(users).values({ orgId, authUserId: managerAuthUserId, email: `manager-${crypto.randomUUID()}@direct-add-test.local`, role: "manager", fullName: "Manažér Office" });
    const [managerUser] = await adminDb.select().from(users).where(eq(users.authUserId, managerAuthUserId));
    await adminDb.insert(managerWorkplaces).values({ userId: managerUser.id, workplaceId: otherWorkplace.id }); // NIE `workplaceId` (Hotel)

    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Hotelový", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId }); // Hotel, nie Office

    const date = addDays(todayStr(), -1);
    authState.authUserId = managerAuthUserId;
    const result = await addMissingPunchAction({}, form({ employeeId: employee.id, workplaceId, date, direction: "in", kind: "zmena", time: "09:00", reason: "test" }));
    expect(result.error).toMatch(/nenájdený alebo nemáš prístup/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(0);
  });

  it("bez vyplneného dôvodu vráti chybu, nič nezapíše", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Bez3", lastName: "Dôvodu", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    const date = addDays(todayStr(), -1);

    authState.authUserId = ownerAuthUserId;
    const result = await addMissingPunchAction({}, form({ employeeId: employee.id, workplaceId, date, direction: "in", kind: "zmena", time: "09:00", reason: "" }));
    expect(result.error).toMatch(/dôvod/i);

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(0);
  });

  it("dátum v budúcnosti je odmietnutý", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Budúci", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    const future = addDays(todayStr(), 1);

    authState.authUserId = ownerAuthUserId;
    const result = await addMissingPunchAction({}, form({ employeeId: employee.id, workplaceId, date: future, direction: "in", kind: "zmena", time: "09:00", reason: "test" }));
    expect(result.error).toMatch(/budúcnosti/i);
  });
});
