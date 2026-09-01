import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { absenceRequests, absences, employees, organizations, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { loadGenerateInput } from "@/lib/scheduler/db-loader";

/**
 * DB trigger `materialize_absence_request` (migrácia 0016) materializuje
 * `absence_requests` → `absences` (generátor číta LEN `absences`, nikdy
 * žiadosti — schema.sql). Kľúčové: NEPOTVRDENÁ žiadosť UŽ materializuje
 * (is_confirmed=false), nie až po schválení — inak by generátor o nej
 * nevedel skôr.
 */

let orgId: string;
let workplaceId: string;
let employeeId: string;
let ownerId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `absence-materialize test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;
  const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Testovací", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
  employeeId = employee.id;
  const [owner] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `owner-${crypto.randomUUID()}@absence-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerId = owner.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

async function absencesFor(reqId: string) {
  return adminDb.select().from(absences).where(eq(absences.requestId, reqId)).orderBy(absences.date);
}

describe("materialize_absence_request trigger (Blok 10, migrácia 0016)", () => {
  it("INSERT (status='pending') → 1 riadok/deň, is_confirmed=false — NEPOTVRDENÁ žiadosť UŽ blokuje generátor", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "dovolenka", dateFrom: "2027-06-01", dateTo: "2027-06-03", reason: "Dovolenka", status: "pending" })
      .returning();

    const rows = await absencesFor(req.id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.date)).toEqual(["2027-06-01", "2027-06-02", "2027-06-03"]);
    expect(rows.every((r) => r.isConfirmed === false)).toBe(true);
    expect(rows.every((r) => r.kind === "dovolenka")).toBe(true);
  });

  it("UPDATE pending → approved: is_confirmed sa zmení na true pre VŠETKY dni", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "dovolenka", dateFrom: "2027-06-10", dateTo: "2027-06-11", reason: "Dovolenka", status: "pending" })
      .returning();
    expect((await absencesFor(req.id)).every((r) => !r.isConfirmed)).toBe(true);

    await adminDb.update(absenceRequests).set({ status: "approved" }).where(eq(absenceRequests.id, req.id));

    const rows = await absencesFor(req.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.isConfirmed === true)).toBe(true);
  });

  it("UPDATE pending → rejected: materializované riadky ZMIZNÚ (žiadosť samotná v absence_requests ZOSTÁVA, audit trail)", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "pn", dateFrom: "2027-06-15", dateTo: "2027-06-16", reason: "PN", status: "pending" })
      .returning();
    expect(await absencesFor(req.id)).toHaveLength(2);

    await adminDb.update(absenceRequests).set({ status: "rejected", decisionNote: "Nedostatočné pokrytie v tomto termíne." }).where(eq(absenceRequests.id, req.id));

    expect(await absencesFor(req.id)).toHaveLength(0);
    const [stillThere] = await adminDb.select().from(absenceRequests).where(eq(absenceRequests.id, req.id));
    expect(stillThere.status).toBe("rejected");
  });

  it("UPDATE pending → cancelled: rovnako zmiznú materializované riadky", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "dovolenka", dateFrom: "2027-06-20", dateTo: "2027-06-20", reason: "Zrušené", status: "pending" })
      .returning();
    expect(await absencesFor(req.id)).toHaveLength(1);

    await adminDb.update(absenceRequests).set({ status: "cancelled" }).where(eq(absenceRequests.id, req.id));

    expect(await absencesFor(req.id)).toHaveLength(0);
  });

  it("manažér zadá žiadosť ZA zamestnanca rovno ako 'approved' (PN prichádza spätne) → materializuje sa PRIAMO confirmed, žiadny medzikrok", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "pn", dateFrom: "2027-06-25", dateTo: "2027-06-25", reason: "Spätná PN", status: "approved" })
      .returning();

    const rows = await absencesFor(req.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].isConfirmed).toBe(true);
  });

  it("úprava dátumov VISIACEJ (pending) žiadosti → celý rozsah sa prehodí (staré dni zmiznú, nové sa objavia)", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "dovolenka", dateFrom: "2027-07-01", dateTo: "2027-07-02", reason: "Pôvodný termín", status: "pending" })
      .returning();
    expect((await absencesFor(req.id)).map((r) => r.date)).toEqual(["2027-07-01", "2027-07-02"]);

    await adminDb.update(absenceRequests).set({ dateFrom: "2027-07-10", dateTo: "2027-07-12" }).where(eq(absenceRequests.id, req.id));

    const rows = await absencesFor(req.id);
    expect(rows.map((r) => r.date)).toEqual(["2027-07-10", "2027-07-11", "2027-07-12"]);
  });

  it("paragraf na hodiny (is_partial_day + hours) → materializovaný riadok nesie hours, nie celý deň", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "paragraf", dateFrom: "2027-07-20", dateTo: "2027-07-20", isPartialDay: true, hours: "4", reason: "Lekár", status: "pending" })
      .returning();

    const rows = await absencesFor(req.id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].hours)).toBe(4);
    expect(rows[0].kind).toBe("paragraf");
  });

  it("kolízia s existujúcou absenciou v ten istý deň (iný zdroj) → ON CONFLICT DO NOTHING, nepadne, existujúci riadok sa nedotkne", async () => {
    // Manuálny zápis (mimo žiadosti) na 2027-08-01, presne ako assignAbsenceAction robí dnes.
    await adminDb.insert(absences).values({ employeeId, workplaceId, date: "2027-08-01", kind: "dovolenka", isConfirmed: true });

    const [req] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "pn", dateFrom: "2027-08-01", dateTo: "2027-08-02", reason: "Kolízia", status: "pending" })
      .returning();

    // Žiadosť samotná existuje a je viditeľná, aj keď sa pre 1.8. nič nepresadilo.
    const [stillThere] = await adminDb.select().from(absenceRequests).where(eq(absenceRequests.id, req.id));
    expect(stillThere).toBeDefined();

    const [aug1] = await adminDb.select().from(absences).where(and(eq(absences.employeeId, employeeId), eq(absences.date, "2027-08-01")));
    expect(aug1.kind).toBe("dovolenka"); // pôvodný manuálny zápis prežil, nebol prepísaný
    expect(aug1.isConfirmed).toBe(true);

    const [aug2] = await adminDb.select().from(absences).where(and(eq(absences.employeeId, employeeId), eq(absences.date, "2027-08-02")));
    expect(aug2.kind).toBe("pn"); // nekolidujúci deň sa materializoval normálne
  });

  it("integrácia s generátorom: PENDING žiadosť (nikto ju ešte neschválil) UŽ blokuje loadGenerateInput/generateSchedule", async () => {
    await adminDb
      .insert(absenceRequests)
      .values({ employeeId, workplaceId, kind: "dovolenka", dateFrom: "2027-09-10", dateTo: "2027-09-10", reason: "Ešte neschválené", status: "pending" });

    const { input } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2027, 9));
    const relevantAbsences = input.absences.filter((a) => a.employeeId === employeeId && a.date === "2027-09-10");
    expect(relevantAbsences).toHaveLength(1); // generátor VIDÍ túto absenciu, hoci ešte nebola schválená
  });
});
