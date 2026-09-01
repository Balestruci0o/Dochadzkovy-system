import { and, eq, gte, sql } from "drizzle-orm";
// eslint-disable-next-line no-restricted-imports -- terminál sa autentifikuje HMAC podpisom, nie Supabase session — žiadny app.user_id neexistuje (rovnaká výnimka ako route.ts)
import { adminDb } from "@/lib/db/admin";
import { punchEvents } from "@/lib/db/schema";

/**
 * Rate limiting na POST /api/punch. Rovnaký DB-based vzor
 * ako `lib/auth/rate-limit.ts` (login_events) — žiadny Upstash/Redis.
 *
 * Kombinované, NIE podľa `device_id`: jeden terminál pípa naraz veľa rôznych
 * ľudí (zdieľané rovnako ako IP budovy), takže limit per-terminál by chránil
 * pred zaplavením zariadenia, ale nie pred jedným človekom, čo spamuje
 * vlastné razítka cez ten istý terminál — a naopak by mohol počas špičky
 * (viacero ľudí naraz na jednom termináli) zbytočne blokovať cudzie, úplne
 * legitímne razítka.
 *
 * - `employee_id` — tesný limit, chráni pred spamom razítok jedného človeka.
 * - `ip` — veľmi voľný strop (jeden terminál/budova = jedna IP pre veľa
 *   ľudí), len ako poistka proti celkovému zahlteniu, nie proti jednotlivcovi.
 *
 * Počíta LEN úspešné razítka (`punch_events`), nie zamietnuté pokusy: bez
 * platného tajomstva terminálu sa HMAC podpis neuhádne (256-bit kľúč), takže
 * tu nejde o uhádnutie ako pri hesle, ale o obmedzenie toho, ako často môže
 * prejsť legitímne vyzerajúce razítko. Zámerne LEN pre POST /api/punch
 * (online cesta) — /api/punch/sync legitímne posiela dávku desiatok razítok
 * naraz po výpadku WiFi, ten istý limit by ju ticho zahodil.
 */

const EMPLOYEE_WINDOW_SECONDS = 60;
const MAX_PUNCHES_PER_EMPLOYEE = 20;

const IP_WINDOW_SECONDS = 60;
const MAX_PUNCHES_PER_IP = 300;

export type PunchRateLimitResult = { allowed: true } | { allowed: false; reason: string };

export async function checkPunchRateLimit(employeeId: string | null, ip: string | null): Promise<PunchRateLimitResult> {
  const [byEmployee, byIp] = await Promise.all([
    employeeId
      ? adminDb
          .select({ count: sql<number>`count(*)` })
          .from(punchEvents)
          .where(
            and(
              eq(punchEvents.employeeId, employeeId),
              gte(punchEvents.receivedAt, new Date(Date.now() - EMPLOYEE_WINDOW_SECONDS * 1000)),
            ),
          )
      : Promise.resolve([{ count: 0 }]),
    ip
      ? adminDb
          .select({ count: sql<number>`count(*)` })
          .from(punchEvents)
          .where(
            and(eq(punchEvents.ip, ip), gte(punchEvents.receivedAt, new Date(Date.now() - IP_WINDOW_SECONDS * 1000))),
          )
      : Promise.resolve([{ count: 0 }]),
  ]);

  if (employeeId && Number(byEmployee[0].count) >= MAX_PUNCHES_PER_EMPLOYEE) {
    return { allowed: false, reason: "Príliš veľa razítok za posledné 2 minúty. Skús to o chvíľu." };
  }

  if (ip && Number(byIp[0].count) >= MAX_PUNCHES_PER_IP) {
    return { allowed: false, reason: "Príliš veľa razítok z tejto siete. Skús to o chvíľu." };
  }

  return { allowed: true };
}
