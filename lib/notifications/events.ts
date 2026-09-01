import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { employees, scheduledShifts } from "@/lib/db/schema";
import { notify } from "./dispatch";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * "KEDY" vrstva: JEDNA funkcia na jednu udalosť,
 * rozhoduje LEN o tom, KTO sa má dozvedieť a AKÝM textom — nikdy o tom,
 * KTORÝM kanálom (to je `notify()`/`dispatch.ts`). Volajú sa z existujúcich
 * server actions PRESNE v momente, keď sa daná vec reálne stane (žiadne
 * cron/polling na zisťovanie "čo sa zmenilo").
 */

/**
 * Manažéri s prístupom k tejto prevádzke + owner organizácie — spoločný
 * príjemcovia pre "niečo treba schváliť/vyriešiť". Cez `workplace_managers_and_owner()`
 * (migrácia 0020, SECURITY DEFINER) — bežná RLS-scoped `tx.select` by tu
 * nefungovala, keď udalosť spúšťa ZAMESTNANEC (alebo iný manažér): ani
 * `manager_workplaces_select`, ani `users_select` mu nedovolia vidieť CUDZIE
 * riadky (reálne nájdené Playwright behom — ticho 0 príjemcov, žiadna chyba).
 */
async function getManagersAndOwner(tx: Db, workplaceId: string, orgId: string): Promise<string[]> {
  const result = await tx.execute<{ workplace_managers_and_owner: string }>(
    sql`SELECT workplace_managers_and_owner(${workplaceId}::uuid, ${orgId}::uuid)`,
  );
  return result.map((r) => r.workplace_managers_and_owner);
}

export async function notifyAbsenceRequestSubmitted(
  tx: Db,
  params: { orgId: string; workplaceId: string; employeeName: string; kindLabel: string; dateFrom: string; dateTo: string },
): Promise<void> {
  const recipients = await getManagersAndOwner(tx, params.workplaceId, params.orgId);
  const period = params.dateFrom === params.dateTo ? params.dateFrom : `${params.dateFrom} – ${params.dateTo}`;
  for (const userId of recipients) {
    await notify(tx, {
      userId,
      kind: "absence_request_submitted",
      title: `Nová žiadosť o ${params.kindLabel.toLowerCase()}`,
      body: `${params.employeeName}, ${period}`,
      link: "/ziadosti",
    });
  }
}

export async function notifyAbsenceRequestDecided(
  tx: Db,
  params: { employeeUserId: string; approved: boolean; kindLabel: string; dateFrom: string; dateTo: string; decisionNote: string | null },
): Promise<void> {
  const period = params.dateFrom === params.dateTo ? params.dateFrom : `${params.dateFrom} – ${params.dateTo}`;
  await notify(tx, {
    userId: params.employeeUserId,
    kind: params.approved ? "absence_request_approved" : "absence_request_rejected",
    title: params.approved ? `Žiadosť o ${params.kindLabel.toLowerCase()} schválená` : `Žiadosť o ${params.kindLabel.toLowerCase()} zamietnutá`,
    body: params.approved ? period : `${period}${params.decisionNote ? ` — dôvod: ${params.decisionNote}` : ""}`,
    link: "/moje-ziadosti",
    // Štruktúrované dáta pre EMAIL šablónu (`absenceDecisionEmailHtml`) — in-app
    // zobrazenie vyššie (title/body) sa toho nedotýka, len "ako" vrstva (dispatch.ts) ich číta.
    payload: { approved: params.approved, kindLabel: params.kindLabel, period, decisionNote: params.decisionNote },
  });
}

export async function notifyScheduleGapDetected(
  tx: Db,
  params: { orgId: string; workplaceId: string; workplaceName: string; year: number; month: number; gapCount: number },
): Promise<void> {
  if (params.gapCount === 0) return;
  const recipients = await getManagersAndOwner(tx, params.workplaceId, params.orgId);
  for (const userId of recipients) {
    await notify(tx, {
      userId,
      kind: "schedule_gap_detected",
      title: `${params.gapCount} ${params.gapCount === 1 ? "diera" : "diery/dier"} v rozvrhu — ${params.workplaceName}`,
      body: `${params.month}/${params.year}`,
      link: "/kalendar",
    });
  }
}

/**
 * Blok 13, bod 3 — manažéri/owner sa o novom/pregenerovanom rozvrhu dozvedia
 * HNEĎ po vygenerovaní (nie až po "Zverejniť", to je pre zamestnancov —
 * `notifySchedulePublished` nižšie). Rovnaký príjemcovský okruh ako
 * `notifyScheduleGapDetected` — volá sa VŽDY (nielen keď sú diery), "rozvrh
 * je pripravený na kontrolu" platí aj pri 0 dierach.
 */
export async function notifyScheduleGenerated(
  tx: Db,
  params: { orgId: string; workplaceId: string; workplaceName: string; year: number; month: number; shiftsCreated: number; gapCount: number },
): Promise<void> {
  const recipients = await getManagersAndOwner(tx, params.workplaceId, params.orgId);
  const title = `Rozvrh pripravený na kontrolu — ${params.workplaceName}`;
  const body =
    params.gapCount > 0
      ? `${params.month}/${params.year} · ${params.shiftsCreated} smien · ${params.gapCount} ${params.gapCount === 1 ? "diera" : "diery/dier"} na doriešenie`
      : `${params.month}/${params.year} · ${params.shiftsCreated} smien · pokrytie kompletné`;
  for (const userId of recipients) {
    await notify(tx, { userId, kind: "schedule_generated", title, body, link: "/kalendar" });
  }
}

/** Zamestnanci s aspoň 1 zmenou v tomto rozvrhu (nie celá prevádzka natvrdo — kto tam reálne pracuje). */
export async function notifySchedulePublished(
  tx: Db,
  params: { scheduleId: string; workplaceName: string; year: number; month: number },
): Promise<void> {
  const rows = await tx
    .selectDistinct({ userId: employees.userId })
    .from(scheduledShifts)
    .innerJoin(employees, eq(employees.id, scheduledShifts.employeeId))
    .where(eq(scheduledShifts.scheduleId, params.scheduleId));

  for (const r of rows) {
    if (!r.userId) continue; // zamestnanec bez vlastného účtu (žiadny users.id priradený) — nemá kam poslať in-app notifikáciu
    await notify(tx, {
      userId: r.userId,
      kind: "schedule_published",
      title: "Nový rozvrh zverejnený",
      body: `${params.workplaceName} — ${params.month}/${params.year}`,
      link: "/moj-rozvrh",
      payload: { workplaceName: params.workplaceName, year: params.year, month: params.month },
    });
  }
}

/**
 * Q3 — "obsaď aj tak" (`assignShiftAction`, `confirmOverride=true`)
 * sa už zapisuje do `schedule_violations`, ale dovtedy sa o tom nikto okrem
 * toho, kto to spravil, nedozvedel inak než ručným prezretím zoznamu upozornení
 * v kalendári. Notifikácia ide RÁMEC celej prevádzky (manažéri + owner) —
 * rovnaký príjemcovský okruh ako `schedule_gap_detected` — a NEVYNECHÁVA
 * konajúceho: `notifyScheduleGapDetected` má rovnaký precedens (manažér, čo
 * spustí generátor, sa tiež dozvie o vlastných dierach), takže owner má
 * vždy prehľad bez ohľadu na to, kto presne override urobil.
 */
export async function notifyManualOverrideApplied(
  tx: Db,
  params: {
    orgId: string;
    workplaceId: string;
    workplaceName: string;
    employeeName: string;
    date: string;
    managerName: string;
    violations: { code: string; message: string; isHard: boolean }[];
  },
): Promise<void> {
  const recipients = await getManagersAndOwner(tx, params.workplaceId, params.orgId);
  const hardCount = params.violations.filter((v) => v.isHard).length;
  const title = `Manuálny override pravidla — ${params.workplaceName}`;
  const body = `${params.managerName} priradil ${params.employeeName} na ${params.date} napriek porušeniu (${hardCount > 0 ? `${hardCount} tvrdé` : "mäkké"}): ${params.violations.map((v) => v.message).join("; ")}`;
  for (const userId of recipients) {
    await notify(tx, { userId, kind: "manual_override_applied", title, body, link: "/kalendar" });
  }
}

export async function notifyPunchCorrectionRequested(
  tx: Db,
  params: { orgId: string; workplaceId: string; employeeName: string; date: string },
): Promise<void> {
  const recipients = await getManagersAndOwner(tx, params.workplaceId, params.orgId);
  for (const userId of recipients) {
    await notify(tx, {
      userId,
      kind: "punch_correction_requested",
      title: "Žiadosť o opravu razítka",
      body: `${params.employeeName}, ${params.date}`,
      link: "/dnes",
    });
  }
}

export async function notifyPunchCorrectionResolved(
  tx: Db,
  params: { employeeUserId: string; approved: boolean; date: string },
): Promise<void> {
  await notify(tx, {
    userId: params.employeeUserId,
    kind: "punch_correction_resolved",
    title: params.approved ? "Oprava razítka schválená" : "Oprava razítka zamietnutá",
    body: params.date,
    link: "/moja-dochadzka",
  });
}

/**
 * Manažér/owner opravil dochádzku PRIAMO, bez toho, aby si o to zamestnanec
 * požiadal (na rozdiel od `notifyPunchCorrectionResolved`, ktorá reaguje na
 * VLASTNÚ žiadosť zamestnanca) — iný text, nech si to zamestnanec nesplete
 * so schválením žiadosti, ktorú nikdy nepodal.
 */
export async function notifyPunchCorrectedByManager(
  tx: Db,
  params: { employeeUserId: string; date: string },
): Promise<void> {
  await notify(tx, {
    userId: params.employeeUserId,
    kind: "punch_corrected_by_manager",
    title: "Manažér opravil tvoju dochádzku",
    body: params.date,
    link: "/moja-dochadzka",
  });
}

/** "Chýba mi pípnutie" — zamestnanec nahlásil úplne chýbajúci záznam (terminál nešiel/appka spadla). */
export async function notifyMissingPunchRequested(
  tx: Db,
  params: { orgId: string; workplaceId: string; employeeName: string; date: string },
): Promise<void> {
  const recipients = await getManagersAndOwner(tx, params.workplaceId, params.orgId);
  for (const userId of recipients) {
    await notify(tx, {
      userId,
      kind: "missing_punch_requested",
      title: "Žiadosť o pridanie chýbajúceho pípnutia",
      body: `${params.employeeName}, ${params.date}`,
      link: "/dnes",
    });
  }
}

export async function notifyMissingPunchResolved(
  tx: Db,
  params: { employeeUserId: string; approved: boolean; date: string },
): Promise<void> {
  await notify(tx, {
    userId: params.employeeUserId,
    kind: "missing_punch_resolved",
    title: params.approved ? "Chýbajúce pípnutie pridané" : "Žiadosť o chýbajúce pípnutie zamietnutá",
    body: params.date,
    link: "/moja-dochadzka",
  });
}
