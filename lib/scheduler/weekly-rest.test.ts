import { describe, expect, it } from "vitest";
import type { AssignedShift } from "./rules";
import { isoWeekBounds, longestRestHoursInWeek, weeksInMonth } from "./weekly-rest";

/**
 * Blok 9c Piece 4 (🔍) — MIN_REST_WEEKLY, čistá funkcia,
 * testovaná nezávisle od `generateSchedule`.
 */

function shift(date: string, startTime = "09:00:00", endTime = "17:00:00"): AssignedShift {
  return { date, startTime, endTime, crossesMidnight: false, breakMinutes: 0 };
}

describe("isoWeekBounds", () => {
  it("2026-02-04 (streda) patrí do týždňa 2.–8.2.2026", () => {
    expect(isoWeekBounds("2026-02-04")).toEqual({ weekStart: "2026-02-02", weekEnd: "2026-02-08" });
  });
});

describe("weeksInMonth", () => {
  it("február 2026 (28 dní, začína nedeľou) sa dotýka 5 rôznych ISO týždňov", () => {
    const weeks = weeksInMonth(2026, 2, 28);
    expect(weeks).toEqual([
      { weekStart: "2026-01-26", weekEnd: "2026-02-01" },
      { weekStart: "2026-02-02", weekEnd: "2026-02-08" },
      { weekStart: "2026-02-09", weekEnd: "2026-02-15" },
      { weekStart: "2026-02-16", weekEnd: "2026-02-22" },
      { weekStart: "2026-02-23", weekEnd: "2026-03-01" },
    ]);
  });
});

describe("longestRestHoursInWeek", () => {
  it("Po-Pi 8h zmeny (09:00-17:00), víkend voľno → 64h nepretržitého odpočinku (Pi 17:00 → Po 09:00, ďaleko nad 35h)", () => {
    // Vrátane zmeny nasledujúci pondelok (9.2.) — bez nej by "medzera po piatku"
    // nemala oproti čomu byť ohraničená (nekonečno nie je to, čo tu testujeme).
    // Pi 17:00 → So 17:00 (24h) → Ne 17:00 (24h) → Po 09:00 (16h) = 64h.
    const shifts = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-09"].map((d) => shift(d));
    const hours = longestRestHoursInWeek(shifts, "2026-02-02", "2026-02-08");
    expect(hours).toBeCloseTo(64, 6);
  });

  it("pracuje VŠETKY dni v týždni (aj víkend) → najdlhší odpočinok je len medzizmenový (16h), pod 35h", () => {
    const shifts = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07", "2026-02-08"].map((d) => shift(d));
    const hours = longestRestHoursInWeek(shifts, "2026-02-02", "2026-02-08");
    expect(hours).toBeCloseTo(16, 6); // 17:00 dnes → 09:00 zajtra = 16h, žiadna medzera nie je väčšia
  });

  it("žiadne zmeny v danom týždni ani okolí → neobmedzený odpočinok (nič ho neprerušuje)", () => {
    expect(longestRestHoursInWeek([], "2026-02-02", "2026-02-08")).toBe(Number.POSITIVE_INFINITY);
  });

  it("len JEDNA zmena v okolí týždňa → neobmedzený odpočinok (nemá sa o čo oprieť)", () => {
    const hours = longestRestHoursInWeek([shift("2026-02-04")], "2026-02-02", "2026-02-08");
    expect(hours).toBe(Number.POSITIVE_INFINITY);
  });

  it("odpočinok presahujúci hranicu týždňa (posledná zmena predošlý týždeň) sa počíta správne", () => {
    // Zmena v piatok predošlého týždňa (30.1.) končí 17:00, ďalšia až pondelok tohto týždňa (2.2.) o 09:00 — 64h odpočinku.
    // Zvyšok týždňa (Po-Ne) je zámerne PLNE obsadený — inak by dominovala
    // OKRAJOVÁ medzera na začiatku/konci týždňa (pozri #53), nie táto
    // konkrétna cezhraničná medzera, ktorú test overuje.
    const shifts = [
      shift("2026-01-30"),
      ...["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07", "2026-02-08"].map((d) => shift(d)),
    ];
    const hours = longestRestHoursInWeek(shifts, "2026-02-02", "2026-02-08");
    expect(hours).toBeCloseTo(64, 6);
  });

  it("REGRESIA: riedky rozvrh — najbližšia zmena je ĎALEJ než pôvodný ±3-dňový buffer, ale odpočinok je stále dostatočný", () => {
    // Nájdené na reálnom scenári (Skupina A) — zamestnanec, ktorý bežne pracuje
    // len občas (strieda sa s kolegom), odpracuje Po-Pi TENTO týždeň (víkend
    // sa vôbec neobsadzuje, takže v jeho vlastnom zozname niet zmeny na So/Ne),
    // a jeho ĎALŠIA zmena je až o 4 dni PO konci týždňa — mimo pôvodného
    // ±3-dňového bufferu. Funkcia predtým videla len vnútorné 16h medzery
    // (Po-Pi) a falošne hlásila nedostatočný odpočinok, hoci reálne mal
    // zamestnanec pred sebou takmer 6 dní voľna.
    const shifts = [
      "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", // Po-Pi tento týždeň
      "2026-02-12", // ďalšia zmena až budúci štvrtok — 4 dni po konci týždňa (2.-8.2.)
    ].map((d) => shift(d));

    const hours = longestRestHoursInWeek(shifts, "2026-02-02", "2026-02-08");

    // Pi 6.2. 17:00 -> Št 12.2. 09:00 = 5 dní 16h = 136h, ĎALEKO nad 35h.
    expect(hours).toBeCloseTo(136, 6);
  });

  it("prestávka NEOVPLYVŇUJE odpočinok — rovnaké zmeny s 0 a s 90 min prestávkou dajú identický výsledok", () => {
    const withoutBreak: AssignedShift[] = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-09"].map((d) => ({
      date: d,
      startTime: "09:00:00",
      endTime: "17:00:00",
      crossesMidnight: false,
      breakMinutes: 0,
    }));
    const withBreak: AssignedShift[] = withoutBreak.map((s) => ({ ...s, breakMinutes: 90 }));

    const hoursWithoutBreak = longestRestHoursInWeek(withoutBreak, "2026-02-02", "2026-02-08");
    const hoursWithBreak = longestRestHoursInWeek(withBreak, "2026-02-02", "2026-02-08");

    // Odpočinok sa počíta od KONCA zmeny (17:00), nie od konca čistej práce —
    // 90-minútová prestávka počas zmeny odpočinok MEDZI zmenami vôbec nemení.
    expect(hoursWithBreak).toBe(hoursWithoutBreak);
    expect(hoursWithBreak).toBeCloseTo(64, 6);
  });

  it("REGRESIA: zamestnancova ÚPLNE PRVÁ zmena padne neskoro v týždni — pred ňou je voľno, nie 'žiadna medzera'", () => {
    // Presne reálny nález (Skupina A, scenár A1): Marekova prvá zmena v
    // pozícii je 6.9. (nedeľa, posledný deň týždňa 31.8.–6.9.). Pred touto
    // zmenou nemá VÔBEC ŽIADNU históriu — celý zvyšok týždňa (Po–So) je
    // voľný. Predtým sa toto vôbec nepočítalo (funkcia merala len medzery
    // MEDZI zmenami), takže videla iba malú 16h nočnú medzeru k ďalšiemu dňu
    // a falošne hlásila porušenie 35h limitu.
    const shifts = ["2026-02-08", "2026-02-09", "2026-02-10", "2026-02-11"].map((d) => shift(d)); // Ne–St
    const hours = longestRestHoursInWeek(shifts, "2026-02-02", "2026-02-08");

    // Týždeň 2.–8.2. (Po–Ne): pred prvou zmenou (Ne 8.2. 09:00) je celé
    // Po–So voľné = 6 dní 9h = 153h, ďaleko nad 35h.
    expect(hours).toBeCloseTo(153, 6);
  });

  it("REGRESIA (Skupina B): odpočinok cez prechod na LETNÝ čas (29.3.2026) je DST-korektný, nie o hodinu nadhodnotený", () => {
    // Po-Pi pracovný týždeň (23.-27.3.), potom voľno cez víkend prechodu na
    // letný čas, ďalšia zmena v nedeľu 29.3. o 05:00. Nominálna ("na
    // hodinkách") aritmetika by dala 36h (Pi 17:00 -> Ne 05:00), ale hodina
    // 02:00-03:00 v noci 28.-29.3. vôbec neexistuje — skutočný odpočinok je
    // len 35h. Presne na hranici min. 35h limitu — o hodinu vedľa by tu
    // znamenalo falošné "OK" namiesto skutočného hraničného prípadu.
    const shifts: AssignedShift[] = [
      shift("2026-03-23"), shift("2026-03-24"), shift("2026-03-25"), shift("2026-03-26"), shift("2026-03-27"),
      { date: "2026-03-29", startTime: "05:00:00", endTime: "13:00:00", crossesMidnight: false, breakMinutes: 0 },
      shift("2026-03-30"),
    ];
    const hours = longestRestHoursInWeek(shifts, "2026-03-23", "2026-03-29");
    expect(hours).toBeCloseTo(35, 6); // NIE 36 — DST-korektná hodnota
  });
});
