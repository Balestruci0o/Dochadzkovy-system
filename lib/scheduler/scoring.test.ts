import { describe, expect, it } from "vitest";
import { applyAssignment, scoreCandidate, type ScoreCandidateInput, type TeamAverages } from "./scoring";

/**
 * Blok 9b (🔍) — skórovanie (férovosť), docs/ARCHITECTURE.md sekcia 4.
 * Vyhráva NAJNIŽŠIE skóre. Každý test izoluje JEDNO kritérium tak, že
 * ostatné vstupy sú medzi kandidátmi identické — jasne sa tak vidí, ktorá
 * zložka rozhoduje.
 */

const NEUTRAL_TEAM: TeamAverages = { avgAssignedHours: 0, avgAssignedWeekendShifts: 0, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: null };

function baseInput(overrides: Partial<ScoreCandidateInput> = {}): ScoreCandidateInput {
  return {
    contractedMonthlyHours: null,
    candidateShiftHours: 8,
    isWeekend: false,
    isHoliday: false,
    preferredShiftTemplateId: null,
    candidateShiftTemplateId: null,
    softViolationPriorities: [],
    matchedSoftPairedPartnersCount: 0,
    snapshot: { assignedHoursThisMonth: 0, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 },
    teamAverages: NEUTRAL_TEAM,
    ...overrides,
  };
}

describe("scoreCandidate — odchýlka od zmluvného fondu (váha 1000, povinný test)", () => {
  it("kandidát s MENEJ odrobenými hodinami (voči rovnakému fondu) dostane NIŽŠIE skóre a vyhráva", () => {
    const teamAverages: TeamAverages = { avgAssignedHours: 60, avgAssignedWeekendShifts: 0, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: 160 };

    const janaMenej = baseInput({
      contractedMonthlyHours: 160,
      snapshot: { assignedHoursThisMonth: 40, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 },
      teamAverages,
    });
    const peterViac = baseInput({
      contractedMonthlyHours: 160,
      snapshot: { assignedHoursThisMonth: 80, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 },
      teamAverages,
    });

    const janaScore = scoreCandidate(janaMenej);
    const peterScore = scoreCandidate(peterViac);

    expect(janaScore).toBeLessThan(peterScore);
  });

  it("bez zmluvného fondu (contractedMonthlyHours=null) sa táto zložka vôbec nepočíta", () => {
    const snapshot = { assignedHoursThisMonth: 40, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 };
    const bezFondu = scoreCandidate(baseInput({ contractedMonthlyHours: null, snapshot }));
    // avgContractedMonthlyHours: 160 — jediný kandidát v hre má fond 160, teda
    // referenčná škála = jeho vlastný fond (presne ako by to spočítal
    // `computeTeamAverages` v generate.ts, keby bol jediným rovesníkom).
    const sFondom = scoreCandidate(baseInput({ contractedMonthlyHours: 160, snapshot, teamAverages: { ...NEUTRAL_TEAM, avgContractedMonthlyHours: 160 } }));

    // Rozdiel medzi "s fondom" a "bez fondu" je PRESNE fondová zložka (1000 × odchýlka) —
    // zvyšné zložky (hodiny/víkendy/...) sú v oboch prípadoch identické.
    const hoursAfter = snapshot.assignedHoursThisMonth + 8; // candidateShiftHours z baseInput()
    expect(sFondom - bezFondu).toBe(1000 * (hoursAfter - 160));
  });
});

describe("scoreCandidate — nerovnomernosť víkendov (váha 500, povinný test)", () => {
  it("dvaja INAK ROVNAKÍ kandidáti na víkendovú zmenu — ten, čo víkendy EŠTE NEMAL, vyhráva nad tým, čo by dostal ĎALŠÍ", () => {
    const teamAverages: TeamAverages = { avgAssignedHours: 80, avgAssignedWeekendShifts: 1, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: null };

    const zatiaľBezVikendu = baseInput({
      isWeekend: true,
      snapshot: { assignedHoursThisMonth: 80, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 },
      teamAverages,
    });
    const uzMaDvaVikendy = baseInput({
      isWeekend: true,
      snapshot: { assignedHoursThisMonth: 80, assignedWeekendShiftsThisMonth: 2, assignedHolidayShiftsThisMonth: 0 },
      teamAverages,
    });

    const scoreBezVikendu = scoreCandidate(zatiaľBezVikendu);
    const scoreSDvomaVikendmi = scoreCandidate(uzMaDvaVikendy);

    expect(scoreBezVikendu).toBeLessThan(scoreSDvomaVikendmi);
  });

  it("na NEVÍKENDOVÝ deň sa víkendová nerovnomernosť vôbec nezapočíta (obaja majú inak rovnaké skóre)", () => {
    const teamAverages: TeamAverages = { avgAssignedHours: 80, avgAssignedWeekendShifts: 1, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: null };
    const bezVikendov = baseInput({ isWeekend: false, snapshot: { assignedHoursThisMonth: 80, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 }, teamAverages });
    const sVikendmi = baseInput({ isWeekend: false, snapshot: { assignedHoursThisMonth: 80, assignedWeekendShiftsThisMonth: 5, assignedHolidayShiftsThisMonth: 0 }, teamAverages });

    expect(scoreCandidate(bezVikendov)).toBe(scoreCandidate(sVikendmi));
  });
});

describe("scoreCandidate — nerovnomernosť hodín voči tímovému priemeru (váha 300)", () => {
  it("kandidát POD tímovým priemerom dostane nižšie skóre než ten NAD priemerom", () => {
    const teamAverages: TeamAverages = { avgAssignedHours: 50, avgAssignedWeekendShifts: 0, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: null };
    const podPriemerom = baseInput({ snapshot: { assignedHoursThisMonth: 30, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 }, teamAverages });
    const nadPriemerom = baseInput({ snapshot: { assignedHoursThisMonth: 70, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 }, teamAverages });

    expect(scoreCandidate(podPriemerom)).toBeLessThan(scoreCandidate(nadPriemerom));
  });
});

describe("scoreCandidate — soft porušenie (váha 200 × priorita)", () => {
  it("kandidát so soft porušením prehráva s kandidátom bez porušenia", () => {
    const bezPorusenia = baseInput({ softViolationPriorities: [] });
    const sPorusenim = baseInput({ softViolationPriorities: [3] }); // penalizácia 200*3=600

    expect(scoreCandidate(sPorusenim)).toBe(scoreCandidate(bezPorusenia) + 600);
  });

  it("viacero soft porušení naraz sa SČÍTAVA", () => {
    const jedno = baseInput({ softViolationPriorities: [2] });
    const dve = baseInput({ softViolationPriorities: [2, 5] });

    expect(scoreCandidate(dve)).toBe(scoreCandidate(jedno) + 200 * 5);
  });
});

describe("scoreCandidate — sviatky (váha 150, rovnaká logika ako víkendy)", () => {
  it("v sviatok kandidát BEZ doterajších sviatočných zmien vyhráva nad tým, čo by dostal ďalší", () => {
    const teamAverages: TeamAverages = { avgAssignedHours: 0, avgAssignedWeekendShifts: 0, avgAssignedHolidayShifts: 1, avgContractedMonthlyHours: null };
    const bezSviatku = baseInput({ isHoliday: true, snapshot: { assignedHoursThisMonth: 0, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 }, teamAverages });
    const uzMaSviatok = baseInput({ isHoliday: true, snapshot: { assignedHoursThisMonth: 0, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 2 }, teamAverages });

    expect(scoreCandidate(bezSviatku)).toBeLessThan(scoreCandidate(uzMaSviatok));
  });
});

describe("scoreCandidate — odchýlka od preferovanej zmeny (váha 50, kozmetika)", () => {
  it("priradenie MIMO preferovanej šablóny dostane +50 penalizáciu", () => {
    const preferuje = baseInput({ preferredShiftTemplateId: "ranna", candidateShiftTemplateId: "poobedna" });
    const bezPreferencie = baseInput({ preferredShiftTemplateId: null, candidateShiftTemplateId: "poobedna" });

    expect(scoreCandidate(preferuje)).toBe(scoreCandidate(bezPreferencie) + 50);
  });

  it("priradenie PRESNE preferovanej šablóny nemá žiadnu penalizáciu", () => {
    const presneSedi = baseInput({ preferredShiftTemplateId: "ranna", candidateShiftTemplateId: "ranna" });
    expect(scoreCandidate(presneSedi)).toBe(scoreCandidate(baseInput()));
  });
});

describe("scoreCandidate — kombinácia: fond prevýši slabšiu výhodu víkendu", () => {
  it("váha 1000 (fond) rozhoduje aj keď víkendová zložka (500) hovorí opačne", () => {
    const teamAverages: TeamAverages = { avgAssignedHours: 60, avgAssignedWeekendShifts: 1, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: 160 };
    // Ďaleko pod fondom, ale UŽ MÁ veľa víkendov — fond (1000) by mal prevážiť nad víkendovou nevýhodou (500).
    const dalekoPodFondom = baseInput({
      contractedMonthlyHours: 160,
      isWeekend: true,
      snapshot: { assignedHoursThisMonth: 20, assignedWeekendShiftsThisMonth: 4, assignedHolidayShiftsThisMonth: 0 },
      teamAverages,
    });
    // Presne na fonde, ale víkendy ešte nemal.
    const naFondeBezVikendov = baseInput({
      contractedMonthlyHours: 160,
      isWeekend: true,
      snapshot: { assignedHoursThisMonth: 152, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 },
      teamAverages,
    });

    expect(scoreCandidate(dalekoPodFondom)).toBeLessThan(scoreCandidate(naFondeBezVikendov));
  });
});

describe("scoreCandidate — Q10: férovosť podľa % VLASTNÉHO úväzku, nie surových hodín", () => {
  it("rovnaký ABSOLÚTNY nedostatok hodín pod fondom váži VIAC pre menší úväzok (% zaostávania, nie hodiny)", () => {
    // Plný úväzok (fond 200h): už odrobil tak, že po tejto zmene bude 15h pod fondom (7,5 % zvyšku).
    // Polovičný úväzok (fond 50h): už odrobil tak, že po tejto zmene bude 10h pod fondom (20 % zvyšku).
    // PRED opravou (#72) by fond porovnával surový absolútny deficit (15h > 10h) a
    // uprednostnil by PLNÝ úväzok — nesprávne, lebo ten má zaostávanie len 7,5 %,
    // kým polovičný zaostáva 20 % svojho fondu — ten by mal vyhrať.
    const teamAverages: TeamAverages = { avgAssignedHours: 100, avgAssignedWeekendShifts: 0, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: 125 };

    const plnyUvazok = baseInput({
      contractedMonthlyHours: 200,
      snapshot: { assignedHoursThisMonth: 177, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 }, // +8 (baseInput) = 185/200 = 92,5 %
      teamAverages,
    });
    const polovicnyUvazok = baseInput({
      contractedMonthlyHours: 50,
      snapshot: { assignedHoursThisMonth: 32, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 }, // +8 = 40/50 = 80 %
      teamAverages,
    });

    expect(scoreCandidate(polovicnyUvazok)).toBeLessThan(scoreCandidate(plnyUvazok));
  });

  it("rovnaké % úväzku (rôzny fond) → rovnaká fondová zložka skóre, aj keď sú surové hodiny úplne iné", () => {
    // Oba kandidáti presne na 50 % svojho (rôzneho) fondu po tejto zmene —
    // fondová zložka (1000×) má vyjsť IDENTICKY, hoci surové hodiny (75 vs 20) nie.
    const teamAverages: TeamAverages = { avgAssignedHours: 0, avgAssignedWeekendShifts: 0, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: 90 };

    const a = baseInput({
      contractedMonthlyHours: 160,
      snapshot: { assignedHoursThisMonth: 72, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 }, // +8 = 80/160 = 50 %
      teamAverages,
    });
    const b = baseInput({
      contractedMonthlyHours: 20,
      snapshot: { assignedHoursThisMonth: 2, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 }, // +8 = 10/20 = 50 %
      teamAverages,
    });

    expect(scoreCandidate(a)).toBe(scoreCandidate(b));
  });
});

describe("scoreCandidate — mäkké párovanie (Blok 15, Stage 2b, váha 100)", () => {
  it("kandidát S 1 zhodujúcim sa partnerom dostane presne o 100 NIŽŠIE (výhodnejšie) skóre", () => {
    const withPartner = scoreCandidate(baseInput({ matchedSoftPairedPartnersCount: 1 }));
    const withoutPartner = scoreCandidate(baseInput({ matchedSoftPairedPartnersCount: 0 }));
    expect(withPartner).toBe(withoutPartner - 100);
  });

  it("DVAJA zhodujúci sa partneri = dvojnásobný bonus (200), nie len 100", () => {
    const two = scoreCandidate(baseInput({ matchedSoftPairedPartnersCount: 2 }));
    const zero = scoreCandidate(baseInput({ matchedSoftPairedPartnersCount: 0 }));
    expect(two).toBe(zero - 200);
  });

  it("bonus NEPREBÍJA fondovú férovosť (váha 1000) — výrazne prečerpaný kandidát prehráva aj S bonusom proti výrazne nedočerpanému BEZ neho", () => {
    const teamAverages: TeamAverages = { avgAssignedHours: 60, avgAssignedWeekendShifts: 0, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: 160 };
    const overworkedWithPartner = baseInput({
      contractedMonthlyHours: 160,
      snapshot: { assignedHoursThisMonth: 120, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 },
      matchedSoftPairedPartnersCount: 1,
      teamAverages,
    });
    const underworkedNoPartner = baseInput({
      contractedMonthlyHours: 160,
      snapshot: { assignedHoursThisMonth: 20, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 },
      matchedSoftPairedPartnersCount: 0,
      teamAverages,
    });
    // Prečerpaný kandidát MUSÍ mať aj tak vyššie (horšie) skóre — 100-bodový
    // bonus nemá ako prebiť stovky bodov fondovej nerovnováhy.
    expect(scoreCandidate(overworkedWithPartner)).toBeGreaterThan(scoreCandidate(underworkedNoPartner));
  });
});

describe("applyAssignment — priebežná aktualizácia stavu po priradení", () => {
  it("pripočíta hodiny a zvýši počítadlo víkendu/sviatku len keď to sedí", () => {
    const start = { assignedHoursThisMonth: 10, assignedWeekendShiftsThisMonth: 1, assignedHolidayShiftsThisMonth: 0 };

    const afterWeekday = applyAssignment(start, { hours: 8, isWeekend: false, isHoliday: false });
    expect(afterWeekday).toEqual({ assignedHoursThisMonth: 18, assignedWeekendShiftsThisMonth: 1, assignedHolidayShiftsThisMonth: 0 });

    const afterWeekend = applyAssignment(start, { hours: 8, isWeekend: true, isHoliday: false });
    expect(afterWeekend).toEqual({ assignedHoursThisMonth: 18, assignedWeekendShiftsThisMonth: 2, assignedHolidayShiftsThisMonth: 0 });

    const afterHoliday = applyAssignment(start, { hours: 8, isWeekend: false, isHoliday: true });
    expect(afterHoliday).toEqual({ assignedHoursThisMonth: 18, assignedWeekendShiftsThisMonth: 1, assignedHolidayShiftsThisMonth: 1 });
  });

  it("pôvodný snapshot sa NEMUTUJE (čistá funkcia)", () => {
    const start = { assignedHoursThisMonth: 10, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 };
    applyAssignment(start, { hours: 8, isWeekend: true, isHoliday: false });
    expect(start).toEqual({ assignedHoursThisMonth: 10, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 });
  });

  it("priebežné skóre sa mení po sérii priradení presne tak, ako by sa mali hodiny/víkendy vyrovnávať", () => {
    // Dvaja rovnakí kandidáti od nuly. Po priradení víkendu Jane by mala pri
    // ĎALŠOM víkende prehrávať s Petrom (teraz má menej víkendov on).
    let jana = { assignedHoursThisMonth: 0, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 };
    const peter = { assignedHoursThisMonth: 0, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 };

    jana = applyAssignment(jana, { hours: 8, isWeekend: true, isHoliday: false }); // Jana dostala prvý víkend

    const teamAverages: TeamAverages = { avgAssignedHours: 4, avgAssignedWeekendShifts: 0.5, avgAssignedHolidayShifts: 0, avgContractedMonthlyHours: null };
    const janaScore = scoreCandidate(baseInput({ isWeekend: true, snapshot: jana, teamAverages }));
    const peterScore = scoreCandidate(baseInput({ isWeekend: true, snapshot: peter, teamAverages }));

    expect(peterScore).toBeLessThan(janaScore); // Peter (menej víkendov) teraz vyhráva ďalší víkend
  });
});
