import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import { withUserContext } from "./index";
import { deleteOrgCascade } from "./test-fixture";
import {
  absenceRequests,
  attendanceDays,
  auditLog,
  coverageRequirements,
  employeeRateHistory,
  employees,
  employeeWorkplaces,
  legalRules,
  loginEvents,
  managerWorkplaces,
  notifications,
  organizations,
  positions,
  punchEvents,
  qrTokens,
  shiftTemplates,
  terminals,
  users,
  workplaces,
} from "./schema";

/**
 * RLS testy.
 *
 * Fixture je izolovaná (vlastná organizácia s náhodným UUID v ID), takže
 * testy nezávisia od dev seedu (lib/db/seed.ts) a dajú sa spúšťať opakovane.
 * Zápis fixtúr beží pod `adminDb` (rolbypassrls), lebo v tomto bode ešte
 * nie je nikto "prihlásený" — presne ako pri seed skripte.
 */

let orgId: string;
let hotelId: string;
let officeId: string;
let ownerUserId: string;
let managerHotelUserId: string;
let managerOfficeUserId: string;
let employeeHotelUserId: string;
let employeeOfficeUserId: string;
let janaEmployeeId: string;
let peterEmployeeId: string;
let janaAttendanceId: string;
let terminalId: string;
let hotelShiftTemplateId: string;
let hotelCoverageRequirementId: string;
let punchEventId: number;

beforeAll(async () => {
  const [org] = await adminDb
    .insert(organizations)
    .values({ name: `RLS test org ${crypto.randomUUID()}` })
    .returning();
  orgId = org.id;

  const [hotel, office] = await adminDb
    .insert(workplaces)
    .values([
      { orgId, name: "Hotel", code: "HOTEL" },
      { orgId, name: "Office", code: "OFFICE" },
    ])
    .returning();
  hotelId = hotel.id;
  officeId = office.id;

  const [owner, managerHotel, managerOffice, employeeHotel, employeeOffice] = await adminDb
    .insert(users)
    .values([
      { orgId, email: "owner@rls-test.local", role: "owner", fullName: "Majiteľ" },
      { orgId, email: "manager.hotel@rls-test.local", role: "manager", fullName: "Manažér Hotel" },
      { orgId, email: "manager.office@rls-test.local", role: "manager", fullName: "Manažér Office" },
      { orgId, email: "zamestnanec.hotel@rls-test.local", role: "employee", fullName: "Zamestnanec Hotel" },
      { orgId, email: "zamestnanec.office@rls-test.local", role: "employee", fullName: "Zamestnanec Office" },
    ])
    .returning();
  ownerUserId = owner.id;
  managerHotelUserId = managerHotel.id;
  managerOfficeUserId = managerOffice.id;
  employeeHotelUserId = employeeHotel.id;
  employeeOfficeUserId = employeeOffice.id;

  await adminDb.insert(managerWorkplaces).values([
    { userId: managerHotelUserId, workplaceId: hotelId },
    { userId: managerOfficeUserId, workplaceId: officeId },
  ]);

  const [hotelTemplate] = await adminDb
    .insert(shiftTemplates)
    .values({ workplaceId: hotelId, name: "Ranná", code: "R", startTime: "07:00:00", endTime: "15:00:00" })
    .returning();
  hotelShiftTemplateId = hotelTemplate.id;

  const [hotelCoverage] = await adminDb
    .insert(coverageRequirements)
    .values({ workplaceId: hotelId, minPeople: 1 })
    .returning();
  hotelCoverageRequirementId = hotelCoverage.id;

  await adminDb.insert(legalRules).values({ orgId, code: "MIN_REST_DAILY", name: "Test pravidlo", params: { hours: 11 } });

  const [jana, peter] = await adminDb
    .insert(employees)
    .values([
      { orgId, userId: employeeHotelUserId, firstName: "Jana", lastName: "Hotelová", hiredOn: "2024-01-01" },
      { orgId, userId: employeeOfficeUserId, firstName: "Peter", lastName: "Officer", hiredOn: "2024-01-01" },
    ])
    .returning();
  janaEmployeeId = jana.id;
  peterEmployeeId = peter.id;

  await adminDb.insert(employeeWorkplaces).values([
    { employeeId: janaEmployeeId, workplaceId: hotelId },
    { employeeId: peterEmployeeId, workplaceId: officeId },
  ]);

  await adminDb.insert(employeeRateHistory).values([
    { employeeId: janaEmployeeId, workplaceId: hotelId, hourlyRate: "6.5000", validFrom: "2024-01-01" },
    { employeeId: peterEmployeeId, workplaceId: officeId, hourlyRate: "9.0000", validFrom: "2024-01-01" },
  ]);

  const [janaAttendance] = await adminDb
    .insert(attendanceDays)
    .values([
      { employeeId: janaEmployeeId, workplaceId: hotelId, date: "2026-07-13" },
      { employeeId: peterEmployeeId, workplaceId: officeId, date: "2026-07-13" },
    ])
    .returning();
  janaAttendanceId = janaAttendance.id;

  const [terminal] = await adminDb
    .insert(terminals)
    .values({
      workplaceId: hotelId,
      name: "RLS test terminál",
      deviceId: `rls-test-${crypto.randomUUID()}`,
      secretHash: "test-hash",
    })
    .returning();
  terminalId = terminal.id;

  await adminDb.insert(qrTokens).values({
    jti: `rls-test-${crypto.randomUUID()}`,
    employeeId: janaEmployeeId,
    expiresAt: new Date(Date.now() + 30_000),
  });

  await adminDb.insert(positions).values({
    orgId,
    workplaceId: hotelId,
    name: "RLS test pozícia",
  });

  await adminDb.insert(notifications).values([
    { userId: employeeHotelUserId, kind: "test", title: "Pre zamestnanca hotela" },
    { userId: employeeOfficeUserId, kind: "test", title: "Pre zamestnanca office" },
  ]);

  const [punch] = await adminDb
    .insert(punchEvents)
    .values({
      employeeId: janaEmployeeId,
      workplaceId: hotelId,
      direction: "in",
      method: "qr_terminal",
      occurredAt: new Date("2026-07-13T07:00:00Z"),
      terminalId,
    })
    .returning();
  punchEventId = punch.id;
});

afterAll(async () => {
  // NIKDY dočasne nevypínať trg_punch_no_delete (bola to
  // GLOBÁLNA, celotabuľková zmena viditeľná pre všetky súbežne bežiace testy;
  // presne to spôsobilo, že tento súbor raz "ukradol" append-only ochranu
  // inému súbežnému testu). `deleteOrgCascade` sa o neceskadujúce FK postará
  // sama (introspekciou) — a keď narazí na append-only trigger, bezpečne sa
  // vzdá (org ostane, s viditeľným console.warn), namiesto obchádzania.
  await deleteOrgCascade(orgId);
});

describe("RLS: zamestnanci", () => {
  it("manažér hotela nevidí zamestnancov office", async () => {
    const rows = await withUserContext(managerHotelUserId, (tx) =>
      tx.select().from(employees).where(eq(employees.orgId, orgId)),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(janaEmployeeId);
    expect(ids).not.toContain(peterEmployeeId);
  });
});

describe("RLS: dochádzka", () => {
  it("zamestnanec nevidí cudziu dochádzku", async () => {
    const rows = await withUserContext(employeeHotelUserId, (tx) =>
      tx.select().from(attendanceDays).where(eq(attendanceDays.employeeId, peterEmployeeId)),
    );
    expect(rows).toHaveLength(0);

    const own = await withUserContext(employeeHotelUserId, (tx) =>
      tx.select().from(attendanceDays).where(eq(attendanceDays.id, janaAttendanceId)),
    );
    expect(own).toHaveLength(1);
  });

  it("zamestnanec nevie zmeniť svoju dochádzku", async () => {
    const result = await withUserContext(employeeHotelUserId, (tx) =>
      tx
        .update(attendanceDays)
        .set({ correctionNote: "pokus zamestnanca o zmenu" })
        .where(eq(attendanceDays.id, janaAttendanceId))
        .returning(),
    );
    // RLS politika att_write povoľuje UPDATE len owner/manager — zamestnancovi
    // sa riadok "nenájde", takže update ovplyvní 0 riadkov (nie chyba).
    expect(result).toHaveLength(0);

    const unchanged = await adminDb
      .select()
      .from(attendanceDays)
      .where(eq(attendanceDays.id, janaAttendanceId));
    expect(unchanged[0].correctionNote).toBeNull();
  });
});

describe("RLS: mzdové sadzby", () => {
  it("manažér nevidí sadzby cudzej prevádzky", async () => {
    const rows = await withUserContext(managerHotelUserId, (tx) =>
      tx.select().from(employeeRateHistory).where(eq(employeeRateHistory.employeeId, peterEmployeeId)),
    );
    expect(rows).toHaveLength(0);

    const own = await withUserContext(managerHotelUserId, (tx) =>
      tx.select().from(employeeRateHistory).where(eq(employeeRateHistory.employeeId, janaEmployeeId)),
    );
    expect(own).toHaveLength(1);
  });
});

describe("RLS: razítka sú append-only", () => {
  it("pokus o UPDATE punch_events hodí výnimku", async () => {
    await expect(
      adminDb
        .update(punchEvents)
        .set({ direction: "out" })
        .where(eq(punchEvents.id, punchEventId)),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        /append-only/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );
  });

  it("pokus o DELETE punch_events hodí výnimku", async () => {
    await expect(
      adminDb.delete(punchEvents).where(eq(punchEvents.id, punchEventId)),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        /append-only/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );
  });
});

describe("RLS: A) číselníky — číta každý prihlásený, mení len owner", () => {
  it("zamestnanec vidí pozície, ale nemôže ich zapisovať", async () => {
    const rows = await withUserContext(employeeHotelUserId, (tx) =>
      tx.select().from(positions).where(eq(positions.orgId, orgId)),
    );
    expect(rows.length).toBeGreaterThan(0);

    // INSERT, ktorý neprejde WITH CHECK, Postgres nezahodí potichu (na rozdiel
    // od UPDATE/DELETE) — hodí "new row violates row-level security policy".
    await expect(
      withUserContext(employeeHotelUserId, (tx) =>
        tx.insert(positions).values({ orgId, workplaceId: hotelId, name: "Pokus zamestnanca" }),
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );
  });

  it("owner môže zapisovať do číselníkov", async () => {
    const write = await withUserContext(ownerUserId, (tx) =>
      tx
        .insert(positions)
        .values({ orgId, workplaceId: hotelId, name: "Pozícia od ownera" })
        .returning(),
    );
    expect(write).toHaveLength(1);
  });
});

describe("RLS: B) odvodené od prístupu k prevádzke", () => {
  it("zamestnanec vidí len employee_workplaces vlastnej prevádzky", async () => {
    const rows = await withUserContext(employeeHotelUserId, (tx) =>
      tx.select().from(employeeWorkplaces),
    );
    const employeeIds = rows.map((r) => r.employeeId);
    expect(employeeIds).toContain(janaEmployeeId);
    expect(employeeIds).not.toContain(peterEmployeeId);
  });

  it("manažér office nevidí employee_workplaces hotela", async () => {
    const rows = await withUserContext(managerOfficeUserId, (tx) =>
      tx.select().from(employeeWorkplaces).where(eq(employeeWorkplaces.workplaceId, hotelId)),
    );
    expect(rows).toHaveLength(0);
  });

  // Nájdené pri stavaní DB-loading vrstvy generátora:
  // shift_templates_select/coverage_requirements_select boli scope-nuté len
  // na organizáciu (migrácia 0009), nie na prevádzku ako employees — manažér
  // Office videl Hotelove šablóny zmien a potreby pokrytia. Opravené
  // migráciou 0012 na accessible_workplaces(), rovnako ako employees.
  it("manažér office nevidí shift_templates ani coverage_requirements hotela (migrácia 0012)", async () => {
    const templates = await withUserContext(managerOfficeUserId, (tx) =>
      tx.select().from(shiftTemplates).where(eq(shiftTemplates.workplaceId, hotelId)),
    );
    expect(templates).toHaveLength(0);

    const coverage = await withUserContext(managerOfficeUserId, (tx) =>
      tx.select().from(coverageRequirements).where(eq(coverageRequirements.workplaceId, hotelId)),
    );
    expect(coverage).toHaveLength(0);
  });

  it("manažér hotela NAĎALEJ vidí VLASTNÉ shift_templates a coverage_requirements (oprava nezobrala prístup vlastníkom)", async () => {
    const templates = await withUserContext(managerHotelUserId, (tx) =>
      tx.select().from(shiftTemplates).where(eq(shiftTemplates.id, hotelShiftTemplateId)),
    );
    expect(templates).toHaveLength(1);

    const coverage = await withUserContext(managerHotelUserId, (tx) =>
      tx.select().from(coverageRequirements).where(eq(coverageRequirements.id, hotelCoverageRequirementId)),
    );
    expect(coverage).toHaveLength(1);
  });

  it("legal_rules ZOSTÁVA org-wide zdieľané (zámerne nezmenené — firemné, nie prevádzkovo špecifické, nie o prevádzke Hotel/Office)", async () => {
    const rows = await withUserContext(managerOfficeUserId, (tx) => tx.select().from(legalRules).where(eq(legalRules.orgId, orgId)));
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("RLS: C) len vlastný riadok", () => {
  it("zamestnanec vidí len svoje notifikácie", async () => {
    const rows = await withUserContext(employeeHotelUserId, (tx) => tx.select().from(notifications));
    expect(rows.every((r) => r.userId === employeeHotelUserId)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("zamestnanec vidí v users len seba, owner vidí celú organizáciu", async () => {
    const selfView = await withUserContext(employeeHotelUserId, (tx) => tx.select().from(users));
    expect(selfView.map((r) => r.id)).toEqual([employeeHotelUserId]);

    const ownerView = await withUserContext(ownerUserId, (tx) =>
      tx.select().from(users).where(eq(users.orgId, orgId)),
    );
    const ownerViewIds = ownerView.map((r) => r.id);
    expect(ownerViewIds).toContain(employeeHotelUserId);
    expect(ownerViewIds).toContain(managerHotelUserId);
    expect(ownerViewIds).toContain(employeeOfficeUserId);
  });
});

describe("RLS: users_self_update — vlastný riadok, len 2 povolené stĺpce", () => {
  it("zamestnanec si smie nastaviť last_login_at/activated_at na vlastnom riadku", async () => {
    const now = new Date();
    const result = await withUserContext(employeeHotelUserId, (tx) =>
      tx
        .update(users)
        .set({ lastLoginAt: now })
        .where(eq(users.id, employeeHotelUserId))
        .returning(),
    );
    expect(result).toHaveLength(1);
    expect(result[0].lastLoginAt?.getTime()).toBe(now.getTime());
  });

  it("zamestnanec si NEMÔŽE zmeniť vlastnú role — WITH CHECK to zamietne", async () => {
    await expect(
      withUserContext(employeeHotelUserId, (tx) =>
        tx.update(users).set({ role: "owner" }).where(eq(users.id, employeeHotelUserId)),
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );

    const unchanged = await adminDb.select().from(users).where(eq(users.id, employeeHotelUserId));
    expect(unchanged[0].role).toBe("employee");
  });

  it("zamestnanec si NEMÔŽE zmeniť vlastnú org_id ani is_active", async () => {
    await expect(
      withUserContext(employeeHotelUserId, (tx) =>
        tx.update(users).set({ isActive: false }).where(eq(users.id, employeeHotelUserId)),
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );
  });

  it("zamestnanec nevie zmeniť cudzí riadok (aj keby menil len povolený stĺpec)", async () => {
    const result = await withUserContext(employeeHotelUserId, (tx) =>
      tx
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, employeeOfficeUserId))
        .returning(),
    );
    expect(result).toHaveLength(0);
  });
});

describe("RLS: users_select_manager / users_insert_manager", () => {
  it("manažér hotela vidí users riadok zamestnanca vo svojej prevádzke", async () => {
    const rows = await withUserContext(managerHotelUserId, (tx) =>
      tx.select().from(users).where(eq(users.id, employeeHotelUserId)),
    );
    expect(rows).toHaveLength(1);
  });

  it("manažér hotela nevidí users riadok zamestnanca z office ani iného manažéra", async () => {
    const office = await withUserContext(managerHotelUserId, (tx) =>
      tx.select().from(users).where(eq(users.id, employeeOfficeUserId)),
    );
    expect(office).toHaveLength(0);

    const otherManager = await withUserContext(managerHotelUserId, (tx) =>
      tx.select().from(users).where(eq(users.id, managerOfficeUserId)),
    );
    expect(otherManager).toHaveLength(0);
  });

  it("manažér smie založiť nového zamestnanca vo svojej organizácii", async () => {
    // Bez .returning(): nový zamestnanec ešte nemá employee_workplaces
    // záznam, takže users_select_manager ho manažérovi (zatiaľ) nesprístupní
    // — a Postgres vyžaduje SELECT viditeľnosť aj pre RETURNING po INSERTe.
    // Presne to isté (bez .returning()) robí aj app/pozvat/actions.ts.
    const newEmail = `novy-zamestnanec-${crypto.randomUUID()}@rls-test.local`;
    await withUserContext(managerHotelUserId, (tx) =>
      tx.insert(users).values({
        orgId,
        email: newEmail,
        role: "employee",
        fullName: "Nový Zamestnanec",
      }),
    );

    const [created] = await adminDb.select().from(users).where(eq(users.email, newEmail));
    expect(created.role).toBe("employee");

    await adminDb.delete(users).where(eq(users.id, created.id));
  });

  it("manažér NEMÔŽE založiť users riadok s rolou manager/owner/accountant", async () => {
    await expect(
      withUserContext(managerHotelUserId, (tx) =>
        tx.insert(users).values({
          orgId,
          email: `pokus-manazer-${crypto.randomUUID()}@rls-test.local`,
          role: "manager",
          fullName: "Pokus o manažéra",
        }),
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );
  });
});

describe("RLS: D) žiadny prístup pre bežné role — len service role", () => {
  it("qr_tokens: zamestnanec vidí LEN svoj vlastný token (Blok 7 — GET /api/qr-token cez session)", async () => {
    const janaView = await withUserContext(employeeHotelUserId, (tx) => tx.select().from(qrTokens));
    expect(janaView.some((t) => t.employeeId === janaEmployeeId)).toBe(true);

    const peterView = await withUserContext(employeeOfficeUserId, (tx) => tx.select().from(qrTokens));
    expect(peterView.some((t) => t.employeeId === janaEmployeeId)).toBe(false);

    // owner nemá vlastný employees riadok → current_employee_id() je NULL → nevidí nič
    // (nie chyba — punch endpoint aj tak číta výhradne cez adminDb, toto nie je jeho cesta)
    const ownerView = await withUserContext(ownerUserId, (tx) => tx.select().from(qrTokens));
    expect(ownerView).toHaveLength(0);
  });

  it("qr_tokens: zamestnanec NEMÔŽE zapísať token pre iného zamestnanca", async () => {
    await expect(
      withUserContext(employeeOfficeUserId, (tx) =>
        tx.insert(qrTokens).values({
          jti: `rls-test-forged-${crypto.randomUUID()}`,
          employeeId: janaEmployeeId,
          expiresAt: new Date(Date.now() + 30_000),
        }),
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error && /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );
  });

  it("terminals: owner vo vlastnej organizácii VIDÍ (Blok 5 — samoobslužná správa), manažér nie", async () => {
    const ownerView = await withUserContext(ownerUserId, (tx) => tx.select().from(terminals));
    expect(ownerView.some((t) => t.id === terminalId)).toBe(true);

    const managerView = await withUserContext(managerHotelUserId, (tx) => tx.select().from(terminals));
    expect(managerView).toHaveLength(0);
  });

  it("audit_log vidí len owner, manažér ani zamestnanec nevidia nič (História zmien — /audit)", async () => {
    const managerView = await withUserContext(managerHotelUserId, (tx) => tx.select().from(auditLog));
    expect(managerView).toHaveLength(0);

    const employeeView = await withUserContext(employeeOfficeUserId, (tx) => tx.select().from(auditLog));
    expect(employeeView).toHaveLength(0);

    const ownerView = await withUserContext(ownerUserId, (tx) => tx.select().from(auditLog));
    expect(ownerView.length).toBeGreaterThan(0);
  });

  it("login_events vidí len owner", async () => {
    const managerView = await withUserContext(managerHotelUserId, (tx) => tx.select().from(loginEvents));
    expect(managerView).toHaveLength(0);
  });
});

/**
 * Skupina D (bezpečnosť end-to-end), scenár D6 — zamestnanec nedokáže
 * schváliť VLASTNÚ budúcu žiadosť. Blok 10 (schvaľovací UI/workflow) je už
 * postavené (`app/(app)/ziadosti`, `app/(app)/moje-ziadosti`) — táto
 * primárna DB/RLS vrstva (`req_update` politika) zostáva posledná/primárna
 * obrana aj tak (RLS je primárna obrana, appka je druhá vrstva).
 */
describe("RLS: E) Skupina D6 — zamestnanec nedokáže schváliť vlastnú žiadosť", () => {
  it("zamestnanec SMIE upraviť vlastnú PENDING žiadosť (napr. dôvod), ale NIE prepnúť jej vlastný status na 'approved'", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({
        employeeId: janaEmployeeId,
        workplaceId: hotelId,
        kind: "dovolenka",
        dateFrom: "2027-09-01",
        dateTo: "2027-09-05",
        reason: "Skupina D6 — self-approve pokus",
        status: "pending",
        requestedBy: employeeHotelUserId,
      })
      .returning();

    // Kontrolný prípad: zamestnanec SMIE upraviť VLASTNÚ pending žiadosť
    // (napr. opraviť dôvod) — req_update to explicitne povoľuje.
    const editResult = await withUserContext(employeeHotelUserId, (tx) =>
      tx.update(absenceRequests).set({ reason: "Opravený dôvod" }).where(eq(absenceRequests.id, req.id)).returning(),
    );
    expect(editResult).toHaveLength(1);
    expect(editResult[0].reason).toBe("Opravený dôvod");

    // Skutočný test: zamestnanec sa POKÚSI schváliť VLASTNÚ žiadosť sám sebe.
    // `req_update` (migrácia 0001) nemá explicitný WITH CHECK — Postgres preto
    // POUŽIJE ROVNAKÝ výraz z USING aj na kontrolu NOVÉHO riadku po update
    // (`employee_id = current_employee_id() AND status = 'pending'`). Keďže
    // nová hodnota status='approved' už nespĺňa `status = 'pending'`, RLS
    // update TVRDO ZAMIETNE — nie ticho (0 riadkov), ale explicitnou chybou
    // "new row violates row-level security policy" (Postgres 42501), presne
    // rovnaký tvar ako ostatné RLS zamietnutia v tomto súbore (qr_tokens vyššie).
    await expect(
      withUserContext(employeeHotelUserId, (tx) =>
        tx
          .update(absenceRequests)
          .set({ status: "approved", decidedBy: employeeHotelUserId, decidedAt: new Date() })
          .where(eq(absenceRequests.id, req.id))
          .returning(),
      ),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof Error && /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );

    const [afterAttempt] = await adminDb.select().from(absenceRequests).where(eq(absenceRequests.id, req.id));
    expect(afterAttempt.status).toBe("pending");
    expect(afterAttempt.decidedBy).toBeNull();

    // Manažér prevádzky (skutočná cesta schválenia) SCHVÁLIŤ VIE.
    const managerApprove = await withUserContext(managerHotelUserId, (tx) =>
      tx
        .update(absenceRequests)
        .set({ status: "approved", decidedBy: managerHotelUserId, decidedAt: new Date() })
        .where(eq(absenceRequests.id, req.id))
        .returning(),
    );
    expect(managerApprove).toHaveLength(1);
    expect(managerApprove[0].status).toBe("approved");

    await adminDb.delete(absenceRequests).where(eq(absenceRequests.id, req.id));
  });

  it("zamestnanec SMIE zrušiť VLASTNÚ pending žiadosť (migrácia 0018) — bez toho ju rovnaký mechanizmus, čo blokuje self-approve, blokoval aj tu", async () => {
    const [req] = await adminDb
      .insert(absenceRequests)
      .values({
        employeeId: janaEmployeeId,
        workplaceId: hotelId,
        kind: "dovolenka",
        dateFrom: "2027-10-01",
        dateTo: "2027-10-02",
        reason: "Skupina D6 — self-cancel",
        status: "pending",
        requestedBy: employeeHotelUserId,
      })
      .returning();

    // Skutočný nález (real Playwright/DB beh): req_update pred migráciou 0018
    // nemal WITH CHECK, takže Postgres reused USING aj na nový riadok —
    // `status = 'pending'` po zmene na 'cancelled' už neplatilo a update padal
    // presne rovnako, ako self-approve vyššie. Migrácia 0018 pridala explicitný
    // WITH CHECK, ktorý zamestnancovi povolí NOVÝ status len 'pending'/'cancelled'.
    const cancelResult = await withUserContext(employeeHotelUserId, (tx) =>
      tx.update(absenceRequests).set({ status: "cancelled" }).where(eq(absenceRequests.id, req.id)).returning(),
    );
    expect(cancelResult).toHaveLength(1);
    expect(cancelResult[0].status).toBe("cancelled");

    // D6 garancia OSTÁVA nedotknutá — self-cancel nesmie otvoriť dvere self-approve.
    const [freshPending] = await adminDb
      .insert(absenceRequests)
      .values({ employeeId: janaEmployeeId, workplaceId: hotelId, kind: "dovolenka", dateFrom: "2027-10-10", dateTo: "2027-10-11", reason: "Ešte jedna", status: "pending", requestedBy: employeeHotelUserId })
      .returning();
    await expect(
      withUserContext(employeeHotelUserId, (tx) =>
        tx.update(absenceRequests).set({ status: "approved" }).where(eq(absenceRequests.id, freshPending.id)).returning(),
      ),
    ).rejects.toSatisfy((err: unknown) => err instanceof Error && /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)));

    await adminDb.delete(absenceRequests).where(eq(absenceRequests.id, req.id));
    await adminDb.delete(absenceRequests).where(eq(absenceRequests.id, freshPending.id));
  });
});
