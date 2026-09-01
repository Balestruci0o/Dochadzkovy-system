import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import {
  attendanceDays,
  employeeRateHistory,
  employees,
  employeeWorkplaces,
  managerWorkplaces,
  organizations,
  punchEvents,
  terminals,
  users,
  workplaces,
} from "./schema";
import { deleteOrgCascade } from "./test-fixture";
import { eq } from "drizzle-orm";

/**
 * RLS testy pod Supabase built-in rolou "authenticated" — nie pod naším
 * vlastným "app_user".
 *
 * Prečo je to iný test než lib/db/rls.test.ts:
 * Supabase automaticky udeľuje PLNÝ CRUD grant rolám "anon" a "authenticated"
 * na KAŽDEJ tabuľke (overené: SELECT/INSERT/UPDATE/DELETE aj na audit_log,
 * terminals, qr_tokens — nezávisle od našich REVOKE príkazov pre app_user).
 * Naša vlastná rola app_user má užšie GRANTy, takže testy proti nej
 * neoverujú, že RLS *samo o sebe* drží izoláciu aj tam, kde by grant
 * dovolil čokoľvek. Tieto testy bežia pod "authenticated" — takže jediné,
 * čo bráni prístupu, sú RLS politiky, presne ako pri reálnom Supabase kliente.
 *
 * Poznámka k "anon/publishable kľúču": ten je JWT pre Supabase HTTP API
 * (PostgREST/GoTrue), nedá sa ním priamo prihlásiť cez Postgres wire
 * protokol. Skutočný ekvivalent na úrovni DB je presne toto: pripojenie,
 * ktoré urobí `SET LOCAL ROLE authenticated` (to isté, čo PostgREST robí
 * interne po overení JWT). Rola "postgres" je členom "authenticated"
 * (over. cez pg_auth_members), takže SET ROLE prejde.
 *
 * DÔLEŽITÉ ale: naše RLS politiky čítajú vlastný `app.user_id` (nie
 * Supabase `auth.uid()`), pretože appka nepoužíva Supabase Auth JWT session
 * cez PostgREST — middleware sám nastavuje `SET LOCAL app.user_id`
 * (docs/ARCHITECTURE.md, sekcia 2). Skutočný anon-key HTTP request cez PostgREST
 * by preto `app.user_id` nikdy nenastavil a videl by presne nič (fail-safe,
 * nie fail-open) — tieto testy simulujú kontext PO tom, čo appka
 * app.user_id nastaví, nie surový nenastavený anon request.
 */

const rawSql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function asAuthenticatedUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return rawSql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

let orgId: string;
let hotelId: string;
let officeId: string;
let ownerUserId: string;
let managerHotelUserId: string;
let employeeHotelUserId: string;
let janaEmployeeId: string;
let peterEmployeeId: string;
let janaAttendanceId: string;
let terminalId: string;
let punchEventId: number;

beforeAll(async () => {
  const [org] = await adminDb
    .insert(organizations)
    .values({ name: `RLS-authenticated test org ${crypto.randomUUID()}` })
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

  const [owner, managerHotel, employeeHotel, employeeOffice] = await adminDb
    .insert(users)
    .values([
      { orgId, email: "owner@rls-auth-test.local", role: "owner", fullName: "Majiteľ" },
      { orgId, email: "manager.hotel@rls-auth-test.local", role: "manager", fullName: "Manažér Hotel" },
      { orgId, email: "zamestnanec.hotel@rls-auth-test.local", role: "employee", fullName: "Zamestnanec Hotel" },
      { orgId, email: "zamestnanec.office@rls-auth-test.local", role: "employee", fullName: "Zamestnanec Office" },
    ])
    .returning();
  ownerUserId = owner.id;
  managerHotelUserId = managerHotel.id;
  employeeHotelUserId = employeeHotel.id;

  await adminDb.insert(managerWorkplaces).values([{ userId: managerHotelUserId, workplaceId: hotelId }]);

  const [jana, peter] = await adminDb
    .insert(employees)
    .values([
      { orgId, userId: employeeHotel.id, firstName: "Jana", lastName: "Hotelová", hiredOn: "2024-01-01" },
      { orgId, userId: employeeOffice.id, firstName: "Peter", lastName: "Officer", hiredOn: "2024-01-01" },
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
      name: "RLS-authenticated test terminál",
      deviceId: `rls-auth-test-${crypto.randomUUID()}`,
      secretHash: "test-hash",
    })
    .returning();
  terminalId = terminal.id;

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
  // NIKDY dočasne nevypínať trg_punch_no_delete (globálna, celotabuľková
  // zmena, nebezpečná pri súbežne bežiacich testovacích súboroch).
  await deleteOrgCascade(orgId);
  await rawSql.end();
});

describe("RLS pod 'authenticated' rolou (nie service role, nie náš app_user)", () => {
  it("manažér hotela nevidí zamestnancov office", async () => {
    const rows = await asAuthenticatedUser(managerHotelUserId, (tx) =>
      tx`SELECT id FROM employees WHERE org_id = ${orgId}`,
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(janaEmployeeId);
    expect(ids).not.toContain(peterEmployeeId);
  });

  it("zamestnanec nevidí cudziu dochádzku", async () => {
    const cudzia = await asAuthenticatedUser(employeeHotelUserId, (tx) =>
      tx`SELECT id FROM attendance_days WHERE employee_id = ${peterEmployeeId}`,
    );
    expect(cudzia).toHaveLength(0);

    const vlastna = await asAuthenticatedUser(employeeHotelUserId, (tx) =>
      tx`SELECT id FROM attendance_days WHERE id = ${janaAttendanceId}`,
    );
    expect(vlastna).toHaveLength(1);
  });

  it("zamestnanec nevie zmeniť svoju dochádzku (UPDATE neovplyvní žiadny riadok)", async () => {
    const result = await asAuthenticatedUser(employeeHotelUserId, (tx) =>
      tx`UPDATE attendance_days SET correction_note = 'pokus zamestnanca'
         WHERE id = ${janaAttendanceId} RETURNING id`,
    );
    // att_write politika povoľuje UPDATE len owner/manager — RLS filter
    // spôsobí, že pre zamestnanca sa riadok "nenájde" (0 riadkov), nie chyba.
    expect(result).toHaveLength(0);

    const unchanged = await adminDb
      .select()
      .from(attendanceDays)
      .where(eq(attendanceDays.id, janaAttendanceId));
    expect(unchanged[0].correctionNote).toBeNull();
  });

  it("manažér nevidí sadzby cudzej prevádzky", async () => {
    const cudzia = await asAuthenticatedUser(managerHotelUserId, (tx) =>
      tx`SELECT id FROM employee_rate_history WHERE employee_id = ${peterEmployeeId}`,
    );
    expect(cudzia).toHaveLength(0);

    const vlastna = await asAuthenticatedUser(managerHotelUserId, (tx) =>
      tx`SELECT id FROM employee_rate_history WHERE employee_id = ${janaEmployeeId}`,
    );
    expect(vlastna).toHaveLength(1);
  });

  describe("razítka sú append-only — dve nezávislé vrstvy obrany", () => {
    it("UPDATE pod 'authenticated' (bez bypassu) neovplyvní žiadny riadok — RLS nemá pre punch_events žiadnu UPDATE politiku", async () => {
      // punch_events má v schema.sql len SELECT politiku ("zápis ide cez
      // service role, nie cez klienta") — žiadna rola bez RLS bypassu
      // (vrátane ownera) nemá povolenie UPDATE, takže RLS filter nájde
      // 0 riadkov a trigger sa vôbec nespustí. Toto je prvá vrstva obrany.
      const result = await asAuthenticatedUser(ownerUserId, (tx) =>
        tx`UPDATE punch_events SET direction = 'out' WHERE id = ${punchEventId} RETURNING id`,
      );
      expect(result).toHaveLength(0);

      const unchanged = await adminDb
        .select()
        .from(punchEvents)
        .where(eq(punchEvents.id, punchEventId));
      expect(unchanged[0].direction).toBe("in");
    });

    it("UPDATE pod rolou, ktorá RLS obchádza (service role), hodí append-only výnimku — druhá vrstva obrany", async () => {
      // Toto je presne cesta z docs/ARCHITECTURE.md (punch endpoint, cron) —
      // service-role/admin pripojenie RLS obchádza, takže by sa k riadku
      // reálne dostalo. Tu zasiahne trigger punch_events_immutable().
      await expect(
        adminDb.update(punchEvents).set({ direction: "out" }).where(eq(punchEvents.id, punchEventId)),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Error &&
          /append-only/.test(String((err as { cause?: unknown }).cause ?? err.message)),
      );
    });
  });
});
