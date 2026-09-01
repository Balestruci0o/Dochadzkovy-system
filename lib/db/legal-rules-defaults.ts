import type { legalRules } from "./schema";

type LegalRuleInsert = typeof legalRules.$inferInsert;

/**
 * Predvolené §ZP pravidlá — presne podľa komentára na konci schema.sql,
 * plus `NIGHT_HOURS` (len pre výkazy, generátor rozvrhu ju nikdy nečíta).
 * Zdieľané medzi `seed.ts` (demo dáta) a `scripts/setup.ts` (skutočné
 * nasadenie) — vytiahnuté sem z pôvodného duplicitného miesta v `seed.ts`,
 * lebo dve kópie tých istých §ZP hodnôt sa časom nevyhnutne rozídu (jedna sa
 * opraví, druhá nie) a nikto to pri revízii nezachytí.
 */
export function legalRulesDefaults(orgId: string): LegalRuleInsert[] {
  return [
    {
      orgId,
      code: "MIN_REST_DAILY",
      name: "Minimálny denný odpočinok",
      params: { hours: 12 },
      isHard: true,
      lawReference: "§ 92 ZP",
    },
    {
      orgId,
      code: "MIN_REST_WEEKLY",
      name: "Nepretržitý odpočinok v týždni",
      params: { hours: 35 },
      isHard: true,
      lawReference: "§ 93 ZP",
    },
    {
      orgId,
      code: "MAX_WEEKLY_HOURS",
      name: "Max. týždenný pracovný čas",
      params: { hours: 40 },
      isHard: true,
      lawReference: "§ 85 ZP",
    },
    {
      orgId,
      code: "MAX_SHIFT_HOURS",
      name: "Max. dĺžka smeny",
      params: { hours: 12 },
      isHard: true,
      lawReference: "§ 85 ZP",
    },
    {
      orgId,
      code: "BREAK_AFTER_HOURS",
      name: "Prestávka po 6 h práce",
      params: { after_hours: 6, break_minutes: 30 },
      isHard: true,
      lawReference: "§ 91 ZP",
    },
    {
      orgId,
      code: "MAX_CONSEC_DAYS",
      name: "Max. dní v kuse",
      params: { days: 6 },
      isHard: false,
      lawReference: "§ 93 ZP",
    },
    {
      // Blok 12 — nočná práca, len pre výkazy (generátor rozvrhu túto hodnotu
      // nikdy nečíta) — "hard/soft" tu nemá zmysel (nič sa nevynucuje), true
      // len ako neutrálny default rovnako ako pri ostatných riadkoch.
      orgId,
      code: "NIGHT_HOURS",
      name: "Nočná práca",
      params: { from: "22:00:00", to: "06:00:00" },
      isHard: true,
      lawReference: "§ 123 ZP",
    },
  ];
}
