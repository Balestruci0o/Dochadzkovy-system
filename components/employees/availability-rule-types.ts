import type { availabilityRuleTypeEnum } from "@/lib/db/schema";

export type AvailabilityRuleType = (typeof availabilityRuleTypeEnum.enumValues)[number];

export const WEEKDAYS = [
  { value: 1, label: "Pondelok", short: "Po" },
  { value: 2, label: "Utorok", short: "Ut" },
  { value: 3, label: "Streda", short: "St" },
  { value: 4, label: "Štvrtok", short: "Št" },
  { value: 5, label: "Piatok", short: "Pi" },
  { value: 6, label: "Sobota", short: "So" },
  { value: 7, label: "Nedeľa", short: "Ne" },
] as const;

function weekdayShort(day: number): string {
  return WEEKDAYS.find((w) => w.value === day)?.short ?? String(day);
}

/**
 * Tvar parametrov (JSONB) je zámerne rovnaký ako v komentároch schema.sql,
 * sekcia "PRAVIDLÁ DOSTUPNOSTI" — nech sa čokoľvek, čo tieto pravidlá raz
 * vyhodnotí (Blok 9, lib/scheduler/rules.ts), nemusí uhádnuť tvar znova.
 */
export type RuleParamShape =
  | "weekdays"
  | "days"
  | "parity"
  | "dateRange"
  | "hours"
  | "shiftTemplate";

type RuleTypeConfig = {
  label: string;
  shortHelp: string;
  paramShape: RuleParamShape;
  describe: (params: Record<string, unknown>) => string;
};

export const RULE_TYPE_CONFIG: Record<AvailabilityRuleType, RuleTypeConfig> = {
  allowed_weekdays: {
    label: "Povolené dni v týždni",
    shortHelp: "Zamestnanec smie pracovať len vo vybraných dňoch.",
    paramShape: "weekdays",
    describe: (p) =>
      Array.isArray(p.days) && p.days.length
        ? `Len: ${p.days.map(weekdayShort).join(", ")}`
        : "Bez vybraných dní",
  },
  blocked_weekdays: {
    label: "Zakázané dni v týždni",
    shortHelp: "Zamestnanec nikdy nepracuje vo vybraných dňoch.",
    paramShape: "weekdays",
    describe: (p) =>
      Array.isArray(p.days) && p.days.length
        ? `Nikdy: ${p.days.map(weekdayShort).join(", ")}`
        : "Bez vybraných dní",
  },
  block_length: {
    label: "Dĺžka pracovného bloku",
    shortHelp: "Zamestnanec pracuje v blokoch presne N dní za sebou (napr. 5 dní v kuse).",
    paramShape: "days",
    describe: (p) => `${p.days ?? "?"}-dňové bloky`,
  },
  max_consecutive_days: {
    label: "Max. dní v kuse",
    shortHelp: "Najviac toľko pracovných dní za sebou bez voľna.",
    paramShape: "days",
    describe: (p) => `Max. ${p.days ?? "?"} dní v kuse`,
  },
  min_rest_days: {
    label: "Min. dní voľna po bloku",
    shortHelp: "Po odpracovanom bloku potrebuje aspoň toľko dní voľna.",
    paramShape: "days",
    describe: (p) => `Min. ${p.days ?? "?"} dní voľna po bloku`,
  },
  week_parity: {
    label: "Párne / nepárne týždne",
    shortHelp: "Zamestnanec pracuje len v párnych alebo len v nepárnych týždňoch.",
    paramShape: "parity",
    describe: (p) => (p.parity === "even" ? "Len párne týždne" : "Len nepárne týždne"),
  },
  date_range_available: {
    label: "Dostupný len v období",
    shortHelp: "Mimo tohto obdobia zamestnanec nie je k dispozícii vôbec.",
    paramShape: "dateRange",
    describe: (p) => `Dostupný ${p.from ?? "?"} – ${p.to ?? "?"}`,
  },
  date_range_blocked: {
    label: "Nedostupný v období",
    shortHelp: "Počas tohto obdobia zamestnanec nie je k dispozícii (napr. rekonštrukcia, škola).",
    paramShape: "dateRange",
    describe: (p) => `Nedostupný ${p.from ?? "?"} – ${p.to ?? "?"}`,
  },
  max_hours_per_week: {
    label: "Max. hodín týždenne",
    shortHelp: "Horný limit odpracovaných hodín za týždeň.",
    paramShape: "hours",
    describe: (p) => `Max. ${p.hours ?? "?"} h / týždeň`,
  },
  max_hours_per_month: {
    label: "Max. hodín mesačne",
    shortHelp: "Horný limit odpracovaných hodín za mesiac.",
    paramShape: "hours",
    describe: (p) => `Max. ${p.hours ?? "?"} h / mesiac`,
  },
  // Q10 — NEPOUŽÍVANÉ, zámerne vynechané z `RULE_TYPE_OPTIONS`
  // (nižšie), teda z výberu pri zakladaní nového pravidla. Zmluvný fond sa
  // odteraz nastavuje VÝHRADNE cez "Úväzok" na profile zamestnanca
  // (`employees.contract_hours_per_month`, viď `lib/scheduler/db-loader.ts`) —
  // TOTO pravidlo bolo pôvodne zamýšľané ako alternatívny zdroj tej istej
  // hodnoty (`evaluateRules` ho už dávnejšie robilo zámerne no-op, viď
  // `rules.ts`), ale generátor ho NIKDY nečítal — dve miesta na to isté by
  // len mýlili (owner by si mohol myslieť, že toto niečo robí). Konfig
  // záznam tu ostáva len pre typovú úplnosť `RULE_TYPE_CONFIG` (enum
  // hodnota v DB sa nemaže — nulová reálna existujúca dáta, no bezpečnejšie
  // nechať stĺpec/enum netknutý než riskovať migráciu bez potreby).
  min_hours_per_month: {
    label: "Min. hodín mesačne (NEPOUŽÍVANÉ — pozri Úväzok v profile zamestnanca)",
    shortHelp: "Nepoužívané pravidlo — nemá žiadny vplyv na generátor. Zmluvný fond nastav cez pole „Úväzok“ na profile zamestnanca.",
    paramShape: "hours",
    describe: (p) => `Min. ${p.hours ?? "?"} h / mesiac (nepoužívané)`,
  },
  preferred_shift: {
    label: "Preferovaná smena",
    shortHelp: "Generátor túto smenu uprednostní pri výbere (kozmetika, nie tvrdé pravidlo).",
    paramShape: "shiftTemplate",
    describe: () => "Preferovaná šablóna smeny",
  },
};

/** Q10 — `min_hours_per_month` sa zámerne vynecháva z výberu, viď komentár pri jeho `RULE_TYPE_CONFIG` zázname vyššie. */
const HIDDEN_FROM_PICKER: ReadonlySet<AvailabilityRuleType> = new Set(["min_hours_per_month"]);

export const RULE_TYPE_OPTIONS = Object.entries(RULE_TYPE_CONFIG)
  .filter(([value]) => !HIDDEN_FROM_PICKER.has(value as AvailabilityRuleType))
  .map(([value, cfg]) => ({
    value: value as AvailabilityRuleType,
    label: cfg.label,
  }));

export type ParamValidation = { valid: true } | { valid: false; error: string };

/** Serverová validácia — musí súhlasiť s tým, čo formulár vie zostaviť. */
export function validateRuleParams(
  type: AvailabilityRuleType,
  params: Record<string, unknown>,
): ParamValidation {
  const shape = RULE_TYPE_CONFIG[type].paramShape;
  switch (shape) {
    case "weekdays": {
      const days = params.days;
      if (!Array.isArray(days) || days.length === 0 || !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) {
        return { valid: false, error: "Vyber aspoň jeden deň (Po–Ne)." };
      }
      return { valid: true };
    }
    case "days": {
      const days = params.days;
      if (typeof days !== "number" || !Number.isInteger(days) || days < 1) {
        return { valid: false, error: "Zadaj kladný počet dní." };
      }
      return { valid: true };
    }
    case "parity": {
      if (params.parity !== "even" && params.parity !== "odd") {
        return { valid: false, error: "Vyber párne alebo nepárne týždne." };
      }
      return { valid: true };
    }
    case "dateRange": {
      const { from, to } = params;
      if (typeof from !== "string" || typeof to !== "string" || !from || !to) {
        return { valid: false, error: "Zadaj obe dátumy (od – do)." };
      }
      if (from > to) {
        return { valid: false, error: "Dátum 'od' musí byť pred dátumom 'do'." };
      }
      return { valid: true };
    }
    case "hours": {
      const hours = params.hours;
      if (typeof hours !== "number" || hours <= 0) {
        return { valid: false, error: "Zadaj kladný počet hodín." };
      }
      return { valid: true };
    }
    case "shiftTemplate": {
      if (typeof params.shift_template_id !== "string" || !params.shift_template_id) {
        return { valid: false, error: "Vyber šablónu smeny." };
      }
      return { valid: true };
    }
    default:
      return { valid: false, error: "Neznámy typ pravidla." };
  }
}

export function describeRuleParams(type: AvailabilityRuleType, params: Record<string, unknown>): string {
  return RULE_TYPE_CONFIG[type].describe(params);
}
