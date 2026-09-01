import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra pre getRateAt/getSalaryAt zakladá dáta priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { employeeRateHistory, employeeSalaryHistory, employees, organizations } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { zonedTimeToUtc } from "@/lib/shared/time";
import { calculateAttendanceDay, getRateAt, getSalaryAt, type AttendanceDayCalcInput } from "./calculate";

/**
 * Blok 8 (🔍) — z tohto výpočtu idú mzdy. Každý bod má tu svoj
 * test, ručne prepočítaný na papieri (viď komentár pri každom testu).
 * `calculateAttendanceDay` je čistá funkcia (žiadne DB), takže tieto testy
 * nepotrebujú pripojenie — len `getRateAt` na konci súboru.
 */

const noHoliday = () => false;

function baseInput(overrides: Partial<AttendanceDayCalcInput>): AttendanceDayCalcInput {
  return {
    actualStart: null,
    actualEnd: null,
    plannedStart: null,
    plannedEnd: null,
    breakMinutes: 0,
    crossesMidnight: false,
    date: "2026-02-02", // pondelok, žiadny sviatok — neutrálny "obyčajný deň"
    isHoliday: noHoliday,
    ...overrides,
  };
}

describe("calculateAttendanceDay — príchod pred zmenou sa neráta (povinný test)", () => {
  it("príchod 20 min pred zmenou → počíta sa od PLÁNOVANÉHO začiatku, nie od skoršieho príchodu", () => {
    // 09:00–17:30 (8,5h) - 30 min prestávka = 8h, aj keď prišla o 08:40.
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "09:00:00",
        plannedEnd: "17:30:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "08:40:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "17:30:00"),
      }),
    );
    expect(result.workedHours).toBeCloseTo(8, 6);
    expect(result.overtimeHours).toBe(0);
    expect(result.isLate).toBe(false);
    expect(result.lateMinutes).toBe(0);
  });
});

describe("calculateAttendanceDay — 11h zmena, 30 min prestávka (povinný test)", () => {
  it("11h zmena s 30 min prestávkou → 10,5 h", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "07:00:00",
        plannedEnd: "18:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "07:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "18:00:00"),
      }),
    );
    expect(result.workedHours).toBeCloseTo(10.5, 6);
    expect(result.overtimeHours).toBe(0);
  });
});

describe("calculateAttendanceDay — pípanie prestávok, krok 4 (🔍, careful zone)", () => {
  it("'automaticky' (default, breakTrackingMode nevyplnené) → NEZMENENÉ správanie, breakPunches sa úplne ignorujú", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "16:00:00"),
        // Aj keby breakPunches nejako omylom prišli, "automaticky" ich nesmie použiť.
        breakPunches: [{ start: zonedTimeToUtc("2026-02-02", "12:00:00"), end: zonedTimeToUtc("2026-02-02", "12:05:00") }],
      }),
    );
    expect(result.workedHours).toBeCloseTo(7.5, 6); // 8h - 30 min config, NIE 8h - 5 min reálnej prestávky
    expect(result.effectiveBreakMinutes).toBe(30);
  });

  it("'pipa' + DVE reálne prestávky za deň → odráta sa ich SÚČET, nie config breakMinutes", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30, // config — nemá sa použiť
        breakTrackingMode: "pipa",
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "16:00:00"),
        breakPunches: [
          { start: zonedTimeToUtc("2026-02-02", "10:00:00"), end: zonedTimeToUtc("2026-02-02", "10:10:00") }, // 10 min
          { start: zonedTimeToUtc("2026-02-02", "13:00:00"), end: zonedTimeToUtc("2026-02-02", "13:20:00") }, // 20 min
        ],
      }),
    );
    expect(result.effectiveBreakMinutes).toBeCloseTo(30, 6); // súčet reálnych (10+20), zhodou okolností rovnaké číslo ako config
    expect(result.workedHours).toBeCloseTo(7.5, 6); // 8h - 30 min reálnych (10+20)
  });

  it("'pipa' + reálne prestávky KRATŠIE než config → odráta sa MENEJ (reálny čas víťazí, nie config)", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30,
        breakTrackingMode: "pipa",
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "16:00:00"),
        breakPunches: [{ start: zonedTimeToUtc("2026-02-02", "12:00:00"), end: zonedTimeToUtc("2026-02-02", "12:05:00") }], // 5 min
      }),
    );
    expect(result.effectiveBreakMinutes).toBeCloseTo(5, 6);
    expect(result.workedHours).toBeCloseTo(7 + 55 / 60, 6); // 8h - 5 min
  });

  it("'pipa' + NEPÍPOL ani jednu prestávku → padá späť na config breakMinutes (rovnaké ako 'automaticky')", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30,
        breakTrackingMode: "pipa",
        breakPunches: [],
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "16:00:00"),
      }),
    );
    expect(result.effectiveBreakMinutes).toBe(30);
    expect(result.workedHours).toBeCloseTo(7.5, 6);
  });

  it("'pipa' + posledná prestávka NEUZAVRETÁ (end: null, auto-close ju zastihol) → počíta sa až po actualEnd, nie donekonečna", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30,
        breakTrackingMode: "pipa",
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "12:00:00"), // auto-close uzavrel PRESNE na odchod na prestávku
        breakPunches: [{ start: zonedTimeToUtc("2026-02-02", "12:00:00"), end: null }],
      }),
    );
    expect(result.effectiveBreakMinutes).toBe(0); // start === actualEnd → 0 min, nie NaN/záporné
    expect(result.workedHours).toBeCloseTo(4, 6); // 08:00-12:00, žiadna prestávka odrátaná navyše
  });

  it("BUG FIX — zmena EŠTE BEŽÍ (žiadny actualEnd), 'pipa' PRÁVE odišiel na prestávku → effectiveBreakMinutes je REÁLNY (živý) čas od odchodu, NIE naplánovaná hodnota zo šablóny", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30, // config — nesmie sa použiť, kým prestávka neskončí
        breakTrackingMode: "pipa",
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: null, // zmena stále beží
        breakPunches: [{ start: zonedTimeToUtc("2026-02-02", "12:00:00"), end: null }], // práve odišiel o 12:00
        now: zonedTimeToUtc("2026-02-02", "12:00:00"), // hneď po odchode — 0 min, NIE 30
      }),
    );
    expect(result.status).toBe("working");
    expect(result.effectiveBreakMinutes).toBe(0);
  });

  it("BUG FIX — zmena beží, 'pipa' na prestávke 15 min → effectiveBreakMinutes = 15 (živo od 'now'), nie 30", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30,
        breakTrackingMode: "pipa",
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: null,
        breakPunches: [{ start: zonedTimeToUtc("2026-02-02", "12:00:00"), end: null }],
        now: zonedTimeToUtc("2026-02-02", "12:15:00"), // o 15 min neskôr, ešte sa nevrátil
      }),
    );
    expect(result.effectiveBreakMinutes).toBeCloseTo(15, 6);
  });

  it("BUG FIX — zmena beží, 'pipa' UŽ SA VRÁTIL z prestávky (50 min) → effectiveBreakMinutes = 50, nie 30 (reálna dĺžka víťazí, presne ako pri dokončenom dni)", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30,
        breakTrackingMode: "pipa",
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: null, // zmena ešte beží (vrátil sa z prestávky, pracuje ďalej)
        breakPunches: [{ start: zonedTimeToUtc("2026-02-02", "12:00:00"), end: zonedTimeToUtc("2026-02-02", "12:50:00") }],
        now: zonedTimeToUtc("2026-02-02", "13:30:00"), // uzavretá prestávka, "now" na jej dĺžku nemá vplyv
      }),
    );
    expect(result.effectiveBreakMinutes).toBe(50);
  });

  it("'automaticky' (zmena beží) → effectiveBreakMinutes ostáva config hodnota, breakPunches sa ignorujú rovnako ako pri dokončenom dni", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "08:00:00"),
        actualEnd: null,
        breakPunches: [{ start: zonedTimeToUtc("2026-02-02", "12:00:00"), end: null }],
        now: zonedTimeToUtc("2026-02-02", "12:05:00"),
      }),
    );
    expect(result.effectiveBreakMinutes).toBe(30);
  });

  it("zamestnanec ešte VÔBEC neprišiel (status 'planned') → effectiveBreakMinutes = config, bez ohľadu na breakTrackingMode", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "08:00:00",
        plannedEnd: "16:00:00",
        breakMinutes: 30,
        breakTrackingMode: "pipa",
        actualStart: null,
        actualEnd: null,
      }),
    );
    expect(result.status).toBe("planned");
    expect(result.effectiveBreakMinutes).toBe(30);
  });
});

describe("calculateAttendanceDay — zmena cez polnoc (povinný test)", () => {
  it("22:00–06:00 (8h) s 30 min prestávkou → 7,5 h, planned_end patrí ĎALŠIEMU dňu", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "22:00:00",
        plannedEnd: "06:00:00",
        crossesMidnight: true,
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "22:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-03", "06:00:00"), // nasledujúci deň, žiadny DST v hre
      }),
    );
    expect(result.workedHours).toBeCloseTo(7.5, 6);
    expect(result.overtimeHours).toBe(0);
    // 2026-02-02 (pondelok) aj 2026-02-03 (utorok) — žiadny víkend/sviatok v hre.
    expect(result.weekendHours).toBe(0);
    expect(result.holidayHours).toBe(0);
  });
});

describe("calculateAttendanceDay — prechod na letný čas (povinný test)", () => {
  it("nočná zmena cez noc 28.→29.3.2026 (posun 02:00→03:00) → 7 h, NIE 8 h", () => {
    // Reálny dátum: posledná marcová nedeľa 2026 = 29.3. — posun o 1h vpred
    // o 02:00 SEČ (UTC+1) na 03:00 SELČ (UTC+2). 22:00 (SEČ, pred posunom) →
    // 06:00 (SELČ, po posune) je preto len 7 reálnych hodín, hoci naivný
    // "koniec mínus začiatok" na hodinkách by ukázal 8. Prestávka=0, aby
    // číslo ukázalo LEN DST efekt, nič iné. (Víkend/sviatok sa tu zámerne
    // netestuje — skutočný prechod na letný čas vždy padne na víkendovú noc,
    // takže by len zbytočne miešal dva rôzne javy do jedného assertu.)
    const result = calculateAttendanceDay(
      baseInput({
        date: "2026-03-28",
        plannedStart: "22:00:00",
        plannedEnd: "06:00:00",
        crossesMidnight: true,
        breakMinutes: 0,
        actualStart: zonedTimeToUtc("2026-03-28", "22:00:00"),
        actualEnd: zonedTimeToUtc("2026-03-29", "06:00:00"),
      }),
    );
    expect(result.workedHours).toBeCloseTo(7, 6);
  });

  it("kontrola bez DST korekcie by dala 8h — potvrdzuje, že rozdiel je reálny (nie chyba testu)", () => {
    const naiveMs = zonedTimeToUtc("2026-03-29", "06:00:00").getTime() - zonedTimeToUtc("2026-03-28", "22:00:00").getTime();
    expect(naiveMs / 3_600_000).toBeCloseTo(7, 6); // zonedTimeToUtc je DST-korektná, preto 7, nie 8
  });
});

describe("calculateAttendanceDay — sviatok (povinný test)", () => {
  it("celá zmena v sviatok → všetky hodiny idú do holiday_hours", () => {
    const result = calculateAttendanceDay(
      baseInput({
        date: "2026-01-01", // Nový rok, štvrtok — nie je to náhodou aj víkend
        plannedStart: "09:00:00",
        plannedEnd: "17:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-01-01", "09:00:00"),
        actualEnd: zonedTimeToUtc("2026-01-01", "17:00:00"),
        isHoliday: (d) => d === "2026-01-01",
      }),
    );
    expect(result.workedHours).toBeCloseTo(7.5, 6);
    expect(result.holidayHours).toBeCloseTo(7.5, 6);
    expect(result.weekendHours).toBe(0); // sviatok má prednosť, nesčíta sa aj ako víkend
  });
});

describe("calculateAttendanceDay — víkend (dopĺňa 'So, Ne zvlášť', bod 1)", () => {
  it("celá zmena v sobotu → weekend_hours = worked_hours", () => {
    const result = calculateAttendanceDay(
      baseInput({
        date: "2026-02-07", // sobota
        plannedStart: "09:00:00",
        plannedEnd: "17:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-07", "09:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-07", "17:00:00"),
      }),
    );
    expect(result.workedHours).toBeCloseTo(7.5, 6);
    expect(result.weekendHours).toBeCloseTo(7.5, 6);
    expect(result.holidayHours).toBe(0);
  });

  it("celá zmena v nedeľu → weekend_hours = worked_hours", () => {
    const result = calculateAttendanceDay(
      baseInput({
        date: "2026-02-08", // nedeľa
        plannedStart: "09:00:00",
        plannedEnd: "17:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-08", "09:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-08", "17:00:00"),
      }),
    );
    expect(result.weekendHours).toBeCloseTo(7.5, 6);
  });
});

describe("calculateAttendanceDay — nadčas (bod 1: 'nad plánovaný koniec')", () => {
  it("odchod 1,5h po plánovanom konci → 1,5h nadčas navyše, prestávka sa naň neaplikuje", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "09:00:00",
        plannedEnd: "17:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "09:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "18:30:00"),
      }),
    );
    expect(result.workedHours).toBeCloseTo(7.5, 6); // (17:00-09:00) - 0.5h prestávka
    expect(result.overtimeHours).toBeCloseTo(1.5, 6); // 18:30 - 17:00, bez prestávky
  });
});

describe("calculateAttendanceDay — meškanie (bod 1: 'evidencia, zatiaľ bez dôsledku')", () => {
  it("príchod 15 min po zmene → eviduje sa is_late/late_minutes, hodiny sa počítajú od SKUTOČNÉHO príchodu (nie extra penalizácia navyše)", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "09:00:00",
        plannedEnd: "17:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "09:15:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "17:00:00"),
      }),
    );
    expect(result.isLate).toBe(true);
    expect(result.lateMinutes).toBe(15);
    // 7h45m - 30min prestávka = 7,25h (žiadny ĎALŠÍ postih za meškanie navyše)
    expect(result.workedHours).toBeCloseTo(7.25, 6);
  });
});

describe("calculateAttendanceDay — bez naplánovanej zmeny (ad-hoc práca, žiadny scheduled_shift)", () => {
  it("bez plánu sa počíta priamo actual_start→actual_end, žiadny nadčas ani meškanie", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: null,
        plannedEnd: null,
        breakMinutes: 0,
        actualStart: zonedTimeToUtc("2026-02-02", "10:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "14:00:00"),
      }),
    );
    expect(result.workedHours).toBeCloseTo(4, 6);
    expect(result.overtimeHours).toBe(0);
    expect(result.isLate).toBe(false);
  });
});

describe("calculateAttendanceDay — nedokončený/neprítomný deň", () => {
  it("ešte pracuje (actual_end chýba) → všetky hodiny 0, status 'working'", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "09:00:00",
        plannedEnd: "17:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "09:00:00"),
        actualEnd: null,
      }),
    );
    expect(result.status).toBe("working");
    expect(result.workedHours).toBe(0);
  });

  it("ešte neprišla (actual_start chýba) → status 'planned'", () => {
    const result = calculateAttendanceDay(baseInput({ plannedStart: "09:00:00", plannedEnd: "17:00:00" }));
    expect(result.status).toBe("planned");
    expect(result.workedHours).toBe(0);
  });
});

describe("calculateAttendanceDay — nočná práca §123 ZP (retest pred Blokom 12: PREKRÝVA sa s víkendom/sviatkom, nie samostatný bucket)", () => {
  const NIGHT = { from: "22:00:00", to: "06:00:00" };

  it("bez nightWindow (org rule ešte neaktívna) → nightHours vždy 0, nič iné sa nezmení", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "22:00:00",
        plannedEnd: "06:00:00",
        crossesMidnight: true,
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "22:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-03", "06:00:00"),
        // nightWindow zámerne nevyplnené
      }),
    );
    expect(result.nightHours).toBe(0);
    expect(result.workedHours).toBeCloseTo(7.5, 6); // rovnaké ako pôvodný test bez nightWindow
  });

  it("celá zmena 22:00–06:00 (obyčajný všedný deň) → celé odpracované hodiny sú nočné", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "22:00:00",
        plannedEnd: "06:00:00",
        crossesMidnight: true,
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "22:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-03", "06:00:00"),
        nightWindow: NIGHT,
      }),
    );
    expect(result.workedHours).toBeCloseTo(7.5, 6);
    expect(result.nightHours).toBeCloseTo(7.5, 6); // celý interval padá do 22:00-06:00
    expect(result.weekendHours).toBe(0);
    expect(result.holidayHours).toBe(0);
  });

  it("zmiešaná zmena 18:00–24:00 (6h) → len časť 22:00-24:00 (2h) je nočná, zvyšok nie", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "18:00:00",
        plannedEnd: "00:00:00",
        crossesMidnight: true,
        breakMinutes: 0,
        actualStart: zonedTimeToUtc("2026-02-02", "18:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-03", "00:00:00"),
        nightWindow: NIGHT,
      }),
    );
    expect(result.workedHours).toBeCloseTo(6, 6);
    expect(result.nightHours).toBeCloseTo(2, 6); // 22:00-24:00
  });

  it("nočná zmena v sobotu (22:00 So – 06:00 Ne) → nightHours AJ weekendHours sú NENULOVÉ SÚČASNE (prekryv, nie exkluzívny bucket)", () => {
    const result = calculateAttendanceDay(
      baseInput({
        date: "2026-02-07", // sobota
        plannedStart: "22:00:00",
        plannedEnd: "06:00:00",
        crossesMidnight: true,
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-07", "22:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-08", "06:00:00"), // 08.2. je nedeľa
        nightWindow: NIGHT,
      }),
    );
    expect(result.workedHours).toBeCloseTo(7.5, 6);
    expect(result.nightHours).toBeCloseTo(7.5, 6); // celá zmena je nočná
    expect(result.weekendHours).toBeCloseTo(7.5, 6); // AJ celá zmena je víkendová — prekryv, súčet nie je orezaný
  });

  it("celá zmena vo sviatok CEZ NOC (22:00-06:00) → nightHours AJ holidayHours súčasne (holiday len za časť do polnoci — 2.1. už nie je sviatok, rovnaké delenie ako predtým pre víkend/sviatok)", () => {
    const result = calculateAttendanceDay(
      baseInput({
        date: "2026-01-01", // Nový rok, štvrtok
        plannedStart: "22:00:00",
        plannedEnd: "06:00:00",
        crossesMidnight: true,
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-01-01", "22:00:00"),
        actualEnd: zonedTimeToUtc("2026-01-02", "06:00:00"),
        isHoliday: (d) => d === "2026-01-01",
        nightWindow: NIGHT,
      }),
    );
    expect(result.nightHours).toBeCloseTo(7.5, 6); // celá zmena je v 22:00-06:00 nočnom okne (nezávisí od toho, na ktorý kalendárny deň časť pripadne)
    expect(result.holidayHours).toBeCloseTo(1.875, 6); // len 2 z 8h (22:00-24:00) pripadajú na 1.1. — rovnaká logika ako weekendHours pri zmene cez polnoc, nič nové
  });

  it("denná zmena 09:00–17:00 (mimo 22:00-06:00) → nightHours = 0", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "09:00:00",
        plannedEnd: "17:00:00",
        breakMinutes: 30,
        actualStart: zonedTimeToUtc("2026-02-02", "09:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "17:00:00"),
        nightWindow: NIGHT,
      }),
    );
    expect(result.nightHours).toBe(0);
  });

  it("ranná zmena 05:00–09:00 (chvost VČEREJŠEJ nočnej inštancie 22:00-06:00) → 1h nočná", () => {
    const result = calculateAttendanceDay(
      baseInput({
        plannedStart: "05:00:00",
        plannedEnd: "09:00:00",
        breakMinutes: 0,
        actualStart: zonedTimeToUtc("2026-02-02", "05:00:00"),
        actualEnd: zonedTimeToUtc("2026-02-02", "09:00:00"),
        nightWindow: NIGHT,
      }),
    );
    expect(result.workedHours).toBeCloseTo(4, 6);
    expect(result.nightHours).toBeCloseTo(1, 6); // 05:00-06:00
  });
});

describe("getRateAt — sadzba PLATNÁ V DANÝ DEŇ, nie dnešná (bod 3, povinný test)", () => {
  let orgId: string;
  let employeeId: string;

  beforeAll(async () => {
    const [org] = await adminDb
      .insert(organizations)
      .values({ name: `Payroll rate test org ${crypto.randomUUID()}` })
      .returning();
    orgId = org.id;

    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId, firstName: "Rate", lastName: "Testovacia", hiredOn: "2024-01-01" })
      .returning();
    employeeId = employee.id;

    // Sadzba sa zmenila v POLOVICI marca — staré dni musia dostať starú sadzbu.
    await adminDb.insert(employeeRateHistory).values([
      { employeeId, hourlyRate: "10.5000", validFrom: "2026-01-01", validTo: "2026-03-14" },
      { employeeId, hourlyRate: "12.0000", validFrom: "2026-03-15", validTo: null },
    ]);
  });

  afterAll(async () => {
    await deleteOrgCascade(orgId);
  });

  it("deň PRED zmenou sadzby dostane STARÚ sadzbu", async () => {
    expect(await getRateAt(adminDb, employeeId, "2026-03-10")).toBe(10.5);
  });

  it("presne posledný deň starej sadzby (valid_to) ešte platí STARÁ sadzba", async () => {
    expect(await getRateAt(adminDb, employeeId, "2026-03-14")).toBe(10.5);
  });

  it("deň PO zmene sadzby dostane NOVÚ sadzbu", async () => {
    expect(await getRateAt(adminDb, employeeId, "2026-03-20")).toBe(12);
  });

  it("presne prvý deň novej sadzby (valid_from) už platí NOVÁ sadzba", async () => {
    expect(await getRateAt(adminDb, employeeId, "2026-03-15")).toBe(12);
  });

  it("dátum pred akoukoľvek sadzbou → null", async () => {
    expect(await getRateAt(adminDb, employeeId, "2025-12-31")).toBeNull();
  });
});

describe("getSalaryAt — fix+variabilná PLATNÁ K DANÉMU DÁTUMU (fixný plat, Fáza 1)", () => {
  let orgId: string;
  let employeeId: string;

  beforeAll(async () => {
    const [org] = await adminDb
      .insert(organizations)
      .values({ name: `Payroll salary test org ${crypto.randomUUID()}` })
      .returning();
    orgId = org.id;

    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId, firstName: "Salary", lastName: "Testovacia", hiredOn: "2024-01-01" })
      .returning();
    employeeId = employee.id;

    // Plat sa zmenil v POLOVICI marca — staré mesiace musia dostať starý plat.
    await adminDb.insert(employeeSalaryHistory).values([
      { employeeId, fixAmount: "900.00", variableAmount: "100.00", validFrom: "2026-01-01", validTo: "2026-03-14" },
      { employeeId, fixAmount: "1000.00", variableAmount: "150.00", validFrom: "2026-03-15", validTo: null },
    ]);
  });

  afterAll(async () => {
    await deleteOrgCascade(orgId);
  });

  it("dátum PRED zmenou platu dostane STARÝ fix+variabilnú", async () => {
    expect(await getSalaryAt(adminDb, employeeId, "2026-03-10")).toEqual({ fixAmount: 900, variableAmount: 100 });
  });

  it("presne posledný deň starého platu (valid_to) ešte platí STARÝ plat", async () => {
    expect(await getSalaryAt(adminDb, employeeId, "2026-03-14")).toEqual({ fixAmount: 900, variableAmount: 100 });
  });

  it("dátum PO zmene platu dostane NOVÝ fix+variabilnú", async () => {
    expect(await getSalaryAt(adminDb, employeeId, "2026-03-20")).toEqual({ fixAmount: 1000, variableAmount: 150 });
  });

  it("presne prvý deň nového platu (valid_from) už platí NOVÝ plat", async () => {
    expect(await getSalaryAt(adminDb, employeeId, "2026-03-15")).toEqual({ fixAmount: 1000, variableAmount: 150 });
  });

  it("dátum pred akýmkoľvek platom → null", async () => {
    expect(await getSalaryAt(adminDb, employeeId, "2025-12-31")).toBeNull();
  });
});
