// Štátne sviatky a dni pracovného pokoja SR (zákon č. 241/1993 Z. z. v znení
// neskorších predpisov). Toto sú fixné kalendárne fakty, nie obchodné
// pravidlo, ktoré by sa malo meniť cez UI (princíp "pravidlá sú dáta" sa
// týka pravidiel ako minimálny odpočinok, nie dátumov štátnych sviatkov). Slúži
// len ako pohodlný "import" — výsledok sa vždy zapíše do tabuľky `holidays`,
// generátor nikdy nečíta tento zoznam priamo.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Gaussov algoritmus na výpočet dátumu Veľkonočnej nedele (gregoriánsky kalendár).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toYmd(date: Date): string {
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function getSkHolidaysForYear(year: number): { date: string; name: string }[] {
  const easter = easterSunday(year);

  return [
    { date: ymd(year, 1, 1), name: "Deň vzniku Slovenskej republiky" },
    { date: ymd(year, 1, 6), name: "Zjavenie Pána (Traja králi)" },
    { date: toYmd(addDays(easter, -2)), name: "Veľký piatok" },
    { date: toYmd(addDays(easter, 1)), name: "Veľkonočný pondelok" },
    { date: ymd(year, 5, 1), name: "Sviatok práce" },
    { date: ymd(year, 5, 8), name: "Deň víťazstva nad fašizmom" },
    { date: ymd(year, 7, 5), name: "Sviatok svätého Cyrila a svätého Metoda" },
    { date: ymd(year, 8, 29), name: "Výročie Slovenského národného povstania" },
    { date: ymd(year, 9, 1), name: "Deň Ústavy Slovenskej republiky" },
    { date: ymd(year, 9, 15), name: "Sedembolestná Panna Mária" },
    { date: ymd(year, 11, 1), name: "Sviatok Všetkých svätých" },
    { date: ymd(year, 11, 17), name: "Deň boja za slobodu a demokraciu" },
    { date: ymd(year, 12, 24), name: "Štedrý deň" },
    { date: ymd(year, 12, 25), name: "Prvý sviatok vianočný" },
    { date: ymd(year, 12, 26), name: "Druhý sviatok vianočný" },
  ];
}
