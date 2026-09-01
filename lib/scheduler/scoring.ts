/**
 * Blok 9b (🔍) — skórovanie kandidátov, ktorí prešli cez `evaluateRules` (9a)
 * bez HARD porušenia (tí s hard porušením už vypadli skôr, nedostanú sa sem
 * vôbec). Čistá funkcia, žiadne DB — poradie a váhy sú z docs/ARCHITECTURE.md,
 * sekcia 4 ("Skórovanie — férovosť"):
 *
 *   Odchýlka od zmluvného fondu   1000
 *   Nerovnomernosť víkendov        500
 *   Nerovnomernosť hodín           300
 *   Soft porušenie            200 × priorita
 *   Sviatky                        150
 *   Mäkké párovanie (Blok 15)  100 × počet partnerov, čo ten deň pracujú
 *   Odchýlka od preferencie         50
 *
 * VYHRÁVA NAJNIŽŠIE skóre. Každý kandidát sa porovnáva na TOM ISTOM dni/
 * zmene, takže absolútna hodnota skóre nie je dôležitá — len relatívne
 * poradie medzi kandidátmi toho istého priradenia.
 *
 * Mäkké párovanie (Blok 15, Stage 2b) je ZÁMERNE zaradené NIŽŠIE než fondová/
 * víkendová/hodinová férovosť a než soft-porušenia dostupnosti (200×priorita
 * pri priorite ≥1) — je to "pekné, ak vyjde", nie individuálna prekážka
 * zamestnanca. Vyššie než preferencia zmeny (50), lebo vzťah medzi ľuďmi je
 * silnejší signál než typ zmeny. Štrukturálne sa to NIKDY nedostane nad hard
 * pravidlá/§ZP stropy — tie kandidáta vyradia ešte PRED scoreCandidate
 * (evaluateRules v generate.ts), skóre teda nemá ako ich "prebiť".
 */

export type FairnessSnapshot = {
  /** Koľko ČISTÝCH odpracovaných hodín (po prestávkach) má zamestnanec UŽ priradených tento mesiac (PRED týmto priradením). */
  assignedHoursThisMonth: number;
  /** Koľko víkendových (So/Ne) zmien má UŽ priradených tento mesiac. */
  assignedWeekendShiftsThisMonth: number;
  /** Koľko sviatočných zmien má UŽ priradených tento mesiac. */
  assignedHolidayShiftsThisMonth: number;
};

export type TeamAverages = {
  /**
   * Q10 — toto UŽ JE prepočítané na referenčnú škálu
   * `avgContractedMonthlyHours` nižšie (volajúci, `computeTeamAverages` v
   * `generate.ts`, to robí za celú skupinu rovesníkov) — nie surový priemer
   * hodín. Pri rovnakom (alebo chýbajúcom) úväzku medzi rovesníkmi je to
   * číselne ZHODNÉ so surovým priemerom, takže sa nič nemení oproti pôvodnému
   * správaniu — mení sa LEN keď majú rovesníci ROZDIELNY úväzok.
   */
  avgAssignedHours: number;
  avgAssignedWeekendShifts: number;
  avgAssignedHolidayShifts: number;
  /**
   * Q10 — priemerný zmluvný mesačný fond MEDZI rovesníkmi,
   * ktorí fond majú (`null` = nikto z rovesníkov ho nemá). Referenčná škála,
   * na ktorú `scoreCandidate` prepočíta KAŽDÉHO kandidáta s fondom — aby sa
   * porovnávalo % VLASTNÉHO úväzku, nie surové hodiny, keď má napr. jeden
   * kolega plný a druhý polovičný úväzok (inak by surový tímový priemer
   * systematicky ťahal proti fondovej férovosti).
   */
  avgContractedMonthlyHours: number | null;
};

export type ScoreCandidateInput = {
  /** Zmluvný mesačný fond — pozri `GenerateEmployee.contractedMonthlyHours` (generate.ts) pre presný pôvod hodnoty. */
  contractedMonthlyHours: number | null;
  /** ČISTÉ odpracované hodiny POSUDZOVANEJ zmeny (po odrátaní prestávky — `netWorkedHours`). */
  candidateShiftHours: number;
  isWeekend: boolean;
  isHoliday: boolean;
  /** Zamestnancova preferovaná šablóna (`preferred_shift`) — `null` = nemá preferenciu. */
  preferredShiftTemplateId: string | null;
  /** Šablóna POSUDZOVANEJ zmeny. */
  candidateShiftTemplateId: string | null;
  /** `priority` KAŽDÉHO soft-porušeného pravidla z `evaluateRules` (len tie s `isHard: false`). */
  softViolationPriorities: number[];
  /**
   * Blok 15 (Stage 2b) — počet MÄKKÝCH spárovaných partnerov, ktorí majú v
   * TENTO deň už priradenú zmenu (kdekoľvek — iná pozícia aj prevádzka).
   * `0` = žiadny postih, žiadny bonus (mäkké = "snaž sa, ak to vyjde", nikdy
   * nie povinnosť). Počíta `generate.ts` (`selectCandidate`) z `runState` +
   * `externalPartnerShifts`, nikdy priamo tu — táto funkcia zostáva čistá,
   * bez znalosti DB/iných zamestnancov.
   */
  matchedSoftPairedPartnersCount: number;
  snapshot: FairnessSnapshot;
  teamAverages: TeamAverages;
};

/** Blok 15 (Stage 2b) — váha JEDNÉHO zhodujúceho sa mäkkého párovania, viď zaradenie do váh vyššie. */
const SOFT_PAIRING_BONUS_WEIGHT = 100;

export function scoreCandidate(input: ScoreCandidateInput): number {
  let score = 0;

  const hoursAfter = input.snapshot.assignedHoursThisMonth + input.candidateShiftHours;

  // Q10 — prepočítaj na "ekvivalentné hodiny pri referenčnom
  // (priemernom) fonde rovesníkov" namiesto surových hodín. Bez tohto by
  // rovnaký ABSOLÚTNY nedostatok hodín (napr. 10 h pod fondom) vyzeral
  // rovnako naliehavo pre plný aj polovičný úväzok — pritom 10 h je pre
  // polovičný úväzok OMNOHO väčšie % zaostávania. `refHours` (priemer fondov
  // MEDZI rovesníkmi, počítaný v `generate.ts`) je spoločná škála, na ktorú
  // sa prepočíta KAŽDÝ kandidát aj tímový priemer — kto má fond=refHours
  // (rovnaký úväzok ako priemer, alebo len jeden kandidát v hre), tomu sa
  // nezmení vôbec nič oproti pôvodnému vzorcu (normalizedHoursAfter=hoursAfter).
  const refHours = input.teamAverages.avgContractedMonthlyHours;
  const normalizedHoursAfter =
    input.contractedMonthlyHours !== null && input.contractedMonthlyHours > 0 && refHours !== null
      ? (hoursAfter / input.contractedMonthlyHours) * refHours
      : hoursAfter;

  // 1000 — odchýlka od ZMLUVNÉHO FONDU (osobný cieľ, 100 % VLASTNÉHO úväzku).
  // Kto má odrobené menej % svojho fondu, dostane nižšie (výhodnejšie) skóre.
  if (input.contractedMonthlyHours !== null && refHours !== null) {
    score += 1000 * (normalizedHoursAfter - refHours);
  }

  // 300 — nerovnomernosť HODÍN voči TÍMOVÉMU priemeru (vyrovnávanie nad rámec
  // fondu), na ROVNAKEJ referenčnej škále ako vyššie — inak by táto zložka
  // pri rôznom úväzku ťahala PROTI fondovej férovosti (surový priemer
  // favorizuje rovnaké SUROVÉ hodiny, nie rovnaké % úväzku).
  score += 300 * (normalizedHoursAfter - input.teamAverages.avgAssignedHours);

  // 500 — nerovnomernosť VÍKENDOV (len ak je posudzovaný deň víkend).
  if (input.isWeekend) {
    const weekendsAfter = input.snapshot.assignedWeekendShiftsThisMonth + 1;
    score += 500 * (weekendsAfter - input.teamAverages.avgAssignedWeekendShifts);
  }

  // 150 — sviatky, rovnaká logika ako víkendy.
  if (input.isHoliday) {
    const holidaysAfter = input.snapshot.assignedHolidayShiftsThisMonth + 1;
    score += 150 * (holidaysAfter - input.teamAverages.avgAssignedHolidayShifts);
  }

  // 200 × priorita — súčet za VŠETKY soft-porušené pravidlá (môže ich byť viac naraz).
  for (const priority of input.softViolationPriorities) {
    score += 200 * priority;
  }

  // 100 — mäkké párovanie (Blok 15): BONUS (znižuje skóre = výhodnejšie), nikdy postih.
  // Škáluje s počtom partnerov, čo ten deň už pracujú — 0 = neutrálne.
  score -= SOFT_PAIRING_BONUS_WEIGHT * input.matchedSoftPairedPartnersCount;

  // 50 — odchýlka od preferovanej zmeny (kozmetika). Bez preferencie = žiadny postih.
  if (input.preferredShiftTemplateId && input.preferredShiftTemplateId !== input.candidateShiftTemplateId) {
    score += 50;
  }

  return score;
}

/**
 * Priebežná aktualizácia stavu PO priradení (docs/ARCHITECTURE.md: "po každom
 * priradení sa aktualizujú počty, takže sa hodiny a víkendy vyrovnávajú
 * počas celého behu"). Volá `lib/scheduler/generate.ts` (9c) hneď po výbere
 * víťaza — NEVOLA sa pre kandidátov, ktorí priradenie nedostali.
 */
export function applyAssignment(
  snapshot: FairnessSnapshot,
  assignment: { hours: number; isWeekend: boolean; isHoliday: boolean },
): FairnessSnapshot {
  return {
    assignedHoursThisMonth: snapshot.assignedHoursThisMonth + assignment.hours,
    assignedWeekendShiftsThisMonth: snapshot.assignedWeekendShiftsThisMonth + (assignment.isWeekend ? 1 : 0),
    assignedHolidayShiftsThisMonth: snapshot.assignedHolidayShiftsThisMonth + (assignment.isHoliday ? 1 : 0),
  };
}

/**
 * Opak `applyAssignment` — Piece 4 (MIN_REST_WEEKLY) potrebuje vedieť
 * retroaktívne ZRUŠIŤ priradenie, keď sa až po zložení celého týždňa zistí,
 * že porušuje nepretržitý týždenný odpočinok (hard pravidlo, ktoré sa z
 * jedného dňa nedalo vopred vyhodnotiť — viď `weekly-rest.ts`).
 */
export function unapplyAssignment(
  snapshot: FairnessSnapshot,
  assignment: { hours: number; isWeekend: boolean; isHoliday: boolean },
): FairnessSnapshot {
  return {
    assignedHoursThisMonth: snapshot.assignedHoursThisMonth - assignment.hours,
    assignedWeekendShiftsThisMonth: snapshot.assignedWeekendShiftsThisMonth - (assignment.isWeekend ? 1 : 0),
    assignedHolidayShiftsThisMonth: snapshot.assignedHolidayShiftsThisMonth - (assignment.isHoliday ? 1 : 0),
  };
}
