import { shiftEndMinutes, shiftStartMinutes, type AssignedShift } from "./rules";
import { addDays, isoWeekday } from "@/lib/shared/dates";

/**
 * Blok 9c Piece 4 (🔍) — MIN_REST_WEEKLY: nepretržitý 35h
 * odpočinok v týždni. Zámerne MIMO `evaluateRules` — nedá sa vyhodnotiť
 * z jedného kandidátneho dňa, len z CELÉHO zloženého týždňa (koľko dní má
 * zamestnanec priradených sa dozvieme až po tom, čo je celý týždeň
 * poskladaný). Beží preto ako POST-PASS na konci `generateSchedule`, nie
 * ako súčasť `evaluateRules`/`scoreCandidate`.
 */

export type WeekBounds = { weekStart: string; weekEnd: string };

/** Pondelok–nedeľa týždňa, do ktorého `date` patrí. */
export function isoWeekBounds(date: string): WeekBounds {
  const weekStart = addDays(date, -(isoWeekday(date) - 1));
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

/** Všetky ODLIŠNÉ týždne, do ktorých padá aspoň jeden deň mesiaca (1..totalDays). */
export function weeksInMonth(year: number, month: number, totalDays: number): WeekBounds[] {
  const seen = new Set<string>();
  const weeks: WeekBounds[] = [];
  for (let day = 1; day <= totalDays; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const bounds = isoWeekBounds(date);
    if (!seen.has(bounds.weekStart)) {
      seen.add(bounds.weekStart);
      weeks.push(bounds);
    }
  }
  return weeks;
}

/**
 * Najdlhšia súvislá prestávka (v hodinách) medzi zmenami, ktorá sa aspoň
 * ČIASTOČNE prekrýva s [weekStart, weekEnd]. ZÁMERNE berie do úvahy VŠETKY
 * zmeny zamestnanca za mesiac (nielen tesne pred/po týždni) — pôvodne tu bol
 * ±3-dňový "buffer", ktorý pri riedkom rozvrhu (zamestnanec pracuje len
 * občas, napr. strieda sa s kolegom) nesprávne "nevidel" najbližšiu
 * zmenu mimo bufferu a hlásil falošné porušenie (nájdené na reálnom
 * scenári). Zoznam je vždy len jeden mesiac na
 * jedného zamestnanca (max ~31 položiek), takže netreba orezávať kvôli
 * výkonu. Menej ako 2 zmeny CELKOM = neobmedzený odpočinok (nič ho neprerušuje).
 *
 * DRUHÝ nájdený edge-case: funkcia pôvodne meria odpočinok LEN
 * ako medzeru MEDZI dvoma známymi zmenami — čas PRED úplne prvou zmenou ani
 * PO úplne poslednej zmene v zozname sa nepočítal vôbec, aj keď v tomto
 * čase evidentne nič nie je naplánované (zamestnanec napr. začína pracovať
 * až TENTO týždeň). Bez tejto opravy týždeň, ktorý sa dotýka len prvej/
 * poslednej zmeny zamestnanca, videl iba najbližšiu MALÚ medzeru k susednej
 * zmene (napr. 16h cez noc) namiesto skutočne voľného úseku pred/po —
 * falošné porušenie presne pri prvom pracovnom týždni nového bloku
 * (nájdené na reálnom scenári A1: Marek, prvá zmena 6.9., týždeň
 * 31.8.–6.9. bol falošne vyhodnotený ako porušenie). Okrajové medzery sa
 * OREZÁVAJÚ na hranicu SAMOTNÉHO týždňa (`weekStartMin`/`weekEndMin`), nie
 * nekonečno — vieme len, že v tomto konkrétnom týždni dovtedy/odvtedy nič
 * naplánované nie je, nič viac.
 */
export function longestRestHoursInWeek(shifts: AssignedShift[], weekStart: string, weekEnd: string): number {
  const relevant = shifts
    .map((s) => ({ start: shiftStartMinutes(s.date, s.startTime), end: shiftEndMinutes(s) }))
    .sort((a, b) => a.start - b.start);

  // Menej ako 2 zmeny CELKOM = nemá sa o čo oprieť (žiadna zmena, alebo len
  // jedna bez susedy) — neobmedzený odpočinok, nič ho neprerušuje.
  if (relevant.length < 2) return Number.POSITIVE_INFINITY;

  const weekStartMin = shiftStartMinutes(weekStart, "00:00:00");
  const weekEndMin = shiftStartMinutes(addDays(weekEnd, 1), "00:00:00"); // polnoc na pondelok = koniec nedele

  // `null` = zatiaľ ŽIADNA medzera sa vôbec neprekrýva s týmto týždňom —
  // to nie je "0h odpočinku", je to "nič v tomto týždni nie je čím
  // obmedziť", teda neobmedzený odpočinok.
  let maxGapHours: number | null = null;

  const consider = (gapStart: number, gapEnd: number) => {
    if (gapEnd > weekStartMin && gapStart < weekEndMin) {
      const gapHours = (gapEnd - gapStart) / 60;
      maxGapHours = maxGapHours === null ? gapHours : Math.max(maxGapHours, gapHours);
    }
  };

  // Okrajové medzery — od hranice TOHTO týždňa po prvú/poslednú známu zmenu.
  consider(weekStartMin, relevant[0].start);
  consider(relevant[relevant.length - 1].end, weekEndMin);

  for (let i = 0; i < relevant.length - 1; i++) {
    consider(relevant[i].end, relevant[i + 1].start);
  }

  return maxGapHours ?? Number.POSITIVE_INFINITY;
}
