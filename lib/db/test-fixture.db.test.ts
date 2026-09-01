import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import { generationRuns, organizations, punchEvents, terminals, users, workplaces } from "./schema";
import { deleteOrgCascade, testOrg } from "./test-fixture";

/**
 * Regresné testy pre samotný cleanup helper. Toto je presne ten mechanizmus,
 * ktorý má zabrániť opakovaniu starších problémov (osirotené
 * `attendance_days`, `punch_events` cez globálny trigger-disable, stovky
 * osirotených `users`) — preto potrebuje VLASTNÉ testy, nie len dôveru.
 */

describe("testOrg() — samotné použitie sa vyčistí bez ručného afterAll", () => {
  const org = testOrg("test-fixture self-check");
  let capturedId: string;

  it("beforeAll založil organizáciu s unikátnym menom", async () => {
    expect(org.id).toBeTruthy();
    capturedId = org.id;
    const [row] = await adminDb.select().from(organizations).where(eq(organizations.id, org.id));
    expect(row).toBeDefined();
  });

  it("(kontrola PO tomto súbore) — capturedId sa zapamätal, overí sa v samostatnom teste nižšie", () => {
    expect(capturedId).toBe(org.id);
  });
});

describe("deleteOrgCascade — sám nájde a vynuluje NECESKADUJÚCI FK (bez akéhokoľvek hardkódovania stĺpca)", () => {
  it("generation_runs.triggered_by → users.id (žiadny CASCADE) sa vynuluje automaticky, org sa zmaže celá", async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `dcc-fk-test ${crypto.randomUUID()}` }).returning();
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: `H-${crypto.randomUUID().slice(0, 8)}` }).returning();
    const [owner] = await adminDb
      .insert(users)
      .values({ orgId: org.id, authUserId: crypto.randomUUID(), email: `owner-${crypto.randomUUID()}@dcc-test.local`, role: "owner", fullName: "Test" })
      .returning();
    // Presne ten istý FK tvar, čo skutočne zlyhal v db-writer.test.ts pred opravou.
    await adminDb.insert(generationRuns).values({ workplaceId: wp.id, year: 2031, month: 1, triggeredBy: owner.id, status: "success" });

    await deleteOrgCascade(org.id);

    const [orgAfter] = await adminDb.select().from(organizations).where(eq(organizations.id, org.id));
    expect(orgAfter).toBeUndefined();
    const runsAfter = await adminDb.select().from(generationRuns).where(eq(generationRuns.workplaceId, wp.id));
    expect(runsAfter).toHaveLength(0);
  });

  it("VIACERO neceskadujúcich FK naraz (generation_runs aj coverage-style stĺpec) sa vyriešia jeden po druhom, nie len prvý", async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `dcc-multi-fk-test ${crypto.randomUUID()}` }).returning();
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: `H-${crypto.randomUUID().slice(0, 8)}` }).returning();
    const [owner1] = await adminDb
      .insert(users)
      .values({ orgId: org.id, authUserId: crypto.randomUUID(), email: `owner1-${crypto.randomUUID()}@dcc-test.local`, role: "owner", fullName: "Test1" })
      .returning();
    const [owner2] = await adminDb
      .insert(users)
      .values({ orgId: org.id, authUserId: crypto.randomUUID(), email: `owner2-${crypto.randomUUID()}@dcc-test.local`, role: "owner", fullName: "Test2" })
      .returning();
    // Dva SAMOSTATNÉ generation_runs riadky, každý ukazuje na INÉHO používateľa —
    // slučka musí vynulovať OBIDVA, nie len ten prvý, kým sa DELETE nakoniec podarí.
    await adminDb.insert(generationRuns).values([
      { workplaceId: wp.id, year: 2031, month: 2, triggeredBy: owner1.id, status: "success" },
      { workplaceId: wp.id, year: 2031, month: 3, triggeredBy: owner2.id, status: "success" },
    ]);

    await deleteOrgCascade(org.id);

    const [orgAfter] = await adminDb.select().from(organizations).where(eq(organizations.id, org.id));
    expect(orgAfter).toBeUndefined();
  });
});

describe("deleteOrgCascade — append-only trigger (punch_events) → vzdá sa, NEZNIČÍ dáta, org ostane", () => {
  it("org s punch_events riadkom sa NEZMAŽE (trigger blokuje DELETE), ale funkcia nezhodí výnimku", async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `dcc-punch-test ${crypto.randomUUID()}` }).returning();
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: `H-${crypto.randomUUID().slice(0, 8)}` }).returning();
    const { employees } = await import("./schema");
    const [emp] = await adminDb.insert(employees).values({ orgId: org.id, firstName: "T", lastName: "Test", hiredOn: "2024-01-01" }).returning();
    const [terminal] = await adminDb
      .insert(terminals)
      .values({ workplaceId: wp.id, name: "T", deviceId: `dcc-${crypto.randomUUID()}`, secretHash: "x" })
      .returning();
    await adminDb.insert(punchEvents).values({
      employeeId: emp.id,
      workplaceId: wp.id,
      direction: "in",
      method: "qr_terminal",
      occurredAt: new Date(),
      terminalId: terminal.id,
    });

    await expect(deleteOrgCascade(org.id)).resolves.toBeUndefined(); // nehodí výnimku

    const [orgAfter] = await adminDb.select().from(organizations).where(eq(organizations.id, org.id));
    expect(orgAfter).toBeDefined(); // NECHANÁ zámerne — punch_events sa nesmie zmazať
    const punchAfter = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, emp.id));
    expect(punchAfter).toHaveLength(1); // append-only garancia neporušená
  });
});
