const TIMEZONE = "Europe/Bratislava";

/** Kalendárny deň (YYYY-MM-DD) v danej IANA časovej zóne pre daný okamih. */
export function localDateStr(date: Date, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date,
  );
}

/**
 * Prevedie "lokálny" dátum+čas (napr. deň zmeny + `planned_start`/`planned_end`
 * z `shift_templates`) na správny UTC okamih pre danú IANA časovú zónu —
 * korektne aj cez prechod letný/zimný čas (dvojitá konverzia cez
 * `Intl.DateTimeFormat`, žiadna ručná aritmetika s pevným offsetom, ktorá by
 * pri prechode dala o hodinu vedľa).
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone = TIMEZONE): Date {
  const naiveUtc = new Date(`${dateStr}T${timeStr}Z`);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(naiveUtc).map((p) => [p.type, p.value]));
  const asIfLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = naiveUtc.getTime() - asIfLocal;
  return new Date(naiveUtc.getTime() + offsetMs);
}
