/**
 * Pípanie prestávok, krok 1 — šablóna zmeny nesie prestávku buď ako počet
 * minút (`breakMode: "minuty"`, doterajšie správanie), alebo ako presný čas
 * od–do (`breakMode: "presny_cas"`, napr. 11:00–13:00).
 *
 * Táto funkcia sa volá LEN pri ULOŽENÍ šablóny (`nastavenia/zmeny/actions.ts`)
 * — `shift_templates.break_minutes` sa tak vždy MATERIALIZUJE na aktuálnu
 * efektívnu hodnotu, rovnaký princíp ako `scheduled_shifts` materializuje
 * časy zo šablóny v čase priradenia. Generátor (`db-loader.ts`) aj kalendár
 * (`kalendar/actions.ts`) preto naďalej čítajú `template.breakMinutes`
 * priamo, bez zmeny — nemusia vedieť o dvoch režimoch vôbec.
 */
export type TemplateBreakConfig = {
  breakMode: "minuty" | "presny_cas";
  breakMinutes: number;
  breakStartTime: string | null;
  breakEndTime: string | null;
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * `presny_cas` bez platného od/do (dáta v nekonzistentnom stave — nemalo by
 * nastať, keďže UI si to vynucuje, ale DB stĺpce sú nullable) padá späť na
 * `breakMinutes` — rovnaký fail-safe ako inde v projekte (chýbajúca
 * konfigurácia nikdy nesmie appku zhodiť).
 */
export function resolveTemplateBreakMinutes(config: TemplateBreakConfig): number {
  if (config.breakMode === "presny_cas" && config.breakStartTime && config.breakEndTime) {
    const diff = timeToMinutes(config.breakEndTime) - timeToMinutes(config.breakStartTime);
    if (diff > 0) return diff;
  }
  return config.breakMinutes;
}
