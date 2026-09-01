import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako pipnutia/actions.test.ts)
import { adminDb } from "@/lib/db/admin";
import {
  attendanceDays,
  auditLog,
  employees,
  missingPunchRequests,
  organizations,
  punchCorrectionRequests,
  punchEvents,
  users,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { addDays, todayStr } from "@/lib/shared/dates";
import { zonedTimeToUtc } from "@/lib/shared/time";
import { approveCorrectionAction, approveMissingPunchAction, rejectMissingPunchAction } from "./actions";

/**
 * `approveCorrectionAction` mala rovnakú medzeru ako pôvodná
 * `directCorrectPunchAction` (pred jej opravou pri zavedení granulárnej
 * editácie): `adminDb.transaction` nikdy nenastavovalo `app.user_id`, takže
 * audit_log (audit_attendance, audit_punch_events_insert) zapisoval
 * changed_by=NULL aj pre manažérom schválenú opravu. Tento test overuje, že
 * rovnaká oprava (`setAuditActor`) funguje aj tu.
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
  const [org] = await adminDb.insert(organizations).values({ name: `Approve correction audit test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  ownerAuthUserId = crypto.randomUUID();
  await adminDb.insert(users).values({
    orgId,
    authUserId: ownerAuthUserId,
    email: `owner-${crypto.randomUUID()}@approve-audit-test.local`,
    role: "owner",
    fullName: "Test Majiteľ",
  });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("approveCorrectionAction — audit_log changed_by je manažér, nie NULL", () => {
  it("schválená žiadosť zapíše audit_log pre punch_events aj attendance_days s changed_by = owner", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Žiadajúci", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    // method: "qr_terminal" (nie "manual") — inak by ORIGINÁLNA udalosť mala
    // rovnaký method ako KOREKTÍVNA a nižšie by sa nedali spoľahlivo odlíšiť.
    await adminDb.insert(punchEvents).values({ employeeId: employee.id, workplaceId, direction: "in", method: "qr_terminal", kind: "zmena", occurredAt: zonedTimeToUtc(date, "09:20:00") });
    const [day] = await adminDb
      .insert(attendanceDays)
      .values({ employeeId: employee.id, workplaceId, date, actualStart: zonedTimeToUtc(date, "09:20:00"), status: "working" })
      .returning();
    const [request] = await adminDb
      .insert(punchCorrectionRequests)
      .values({ employeeId: employee.id, attendanceDayId: day.id, requestedStart: zonedTimeToUtc(date, "09:00:00"), reason: "Zabudol som pípnuť presne, prišiel som o 9:00." })
      .returning();

    const [ownerUser] = await adminDb.select().from(users).where(eq(users.authUserId, ownerAuthUserId));

    authState.authUserId = ownerAuthUserId;
    await approveCorrectionAction(form({ requestId: request.id }));

    const [updatedRequest] = await adminDb.select().from(punchCorrectionRequests).where(eq(punchCorrectionRequests.id, request.id));
    expect(updatedRequest.status).toBe("approved");

    const corrective = (await adminDb.select().from(punchEvents).where(and(eq(punchEvents.employeeId, employee.id), eq(punchEvents.method, "manual"))))[0];
    expect(corrective).toBeTruthy();

    const punchAudit = await adminDb.select().from(auditLog).where(and(eq(auditLog.tableName, "punch_events"), eq(auditLog.recordId, String(corrective.id))));
    expect(punchAudit).toHaveLength(1);
    expect(punchAudit[0].changedBy).toBe(ownerUser.id);

    const attendanceAudit = await adminDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "attendance_days"), eq(auditLog.recordId, day.id)))
      .orderBy(auditLog.changedAt);
    expect(attendanceAudit.at(-1)?.changedBy).toBe(ownerUser.id);
  });
});

describe("approveMissingPunchAction — schválenie žiadosti o chýbajúce pípnutie", () => {
  it("schváli žiadosť pre deň bez AKÉHOKOĽVEK predchádzajúceho attendance_days riadku — vytvorí ho, zapíše pípnutie, audit", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Chýbajúci", lastName: "Deň", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [request] = await adminDb
      .insert(missingPunchRequests)
      .values({ employeeId: employee.id, workplaceId, date, direction: "in", kind: "zmena", requestedTime: zonedTimeToUtc(date, "09:00:00"), reason: "Terminál nešiel." })
      .returning();

    const [ownerUser] = await adminDb.select().from(users).where(eq(users.authUserId, ownerAuthUserId));

    // Pred schválením neexistuje ŽIADEN attendance_days riadok pre tento deň.
    const before = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, date)));
    expect(before).toHaveLength(0);

    authState.authUserId = ownerAuthUserId;
    await approveMissingPunchAction(form({ requestId: request.id }));

    const [updatedRequest] = await adminDb.select().from(missingPunchRequests).where(eq(missingPunchRequests.id, request.id));
    expect(updatedRequest.status).toBe("approved");
    expect(updatedRequest.decidedBy).toBe(ownerUser.id);

    const [day] = await adminDb.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, date)));
    expect(day).toBeTruthy();
    expect(day.isCorrected).toBe(true);
    expect(day.correctedBy).toBe(ownerUser.id);

    const [inserted] = await adminDb.select().from(punchEvents).where(and(eq(punchEvents.employeeId, employee.id), eq(punchEvents.method, "manual")));
    expect(inserted).toBeTruthy();
    expect(inserted.occurredAt.getTime()).toBe(zonedTimeToUtc(date, "09:00:00").getTime());
    expect(inserted.correctsEventId).toBeNull(); // nová udalosť, nič neopravuje

    const punchAudit = await adminDb.select().from(auditLog).where(and(eq(auditLog.tableName, "punch_events"), eq(auditLog.recordId, String(inserted.id))));
    expect(punchAudit).toHaveLength(1);
    expect(punchAudit[0].changedBy).toBe(ownerUser.id);
  });

  it("žiadosť, čo už nie je pending, sa nedá schváliť druhý raz", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Dvakrát", lastName: "Schválený", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [request] = await adminDb
      .insert(missingPunchRequests)
      .values({ employeeId: employee.id, workplaceId, date, direction: "in", kind: "zmena", requestedTime: zonedTimeToUtc(date, "09:00:00"), reason: "test", status: "approved" })
      .returning();

    authState.authUserId = ownerAuthUserId;
    await approveMissingPunchAction(form({ requestId: request.id }));

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(0); // žiadny nový zápis, žiadosť nebola pending
  });
});

describe("rejectMissingPunchAction", () => {
  it("zamietne žiadosť, nezapíše pípnutie, uloží dôvod zamietnutia", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Zamietnutý", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    const date = addDays(todayStr(), -1);
    const [request] = await adminDb
      .insert(missingPunchRequests)
      .values({ employeeId: employee.id, workplaceId, date, direction: "in", kind: "zmena", requestedTime: zonedTimeToUtc(date, "09:00:00"), reason: "test" })
      .returning();

    authState.authUserId = ownerAuthUserId;
    await rejectMissingPunchAction(form({ requestId: request.id, decisionNote: "Nesedí s dochádzkovou knihou." }));

    const [updated] = await adminDb.select().from(missingPunchRequests).where(eq(missingPunchRequests.id, request.id));
    expect(updated.status).toBe("rejected");
    expect(updated.decisionNote).toBe("Nesedí s dochádzkovou knihou.");

    const events = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employee.id));
    expect(events).toHaveLength(0);
  });
});
