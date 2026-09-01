import { explainCandidates } from "./format";
import { computeGapSuggestion, formatGapSuggestion } from "./gap-suggestions";
import { consecutiveRestDaysBefore, consecutiveWorkDaysBefore, evaluateRules, netWorkedHours, type AssignedShift, type AvailabilityRuleInput, type LegalRuleInput } from "./rules";
import { applyAssignment, scoreCandidate, unapplyAssignment, type FairnessSnapshot, type TeamAverages } from "./scoring";
import { longestRestHoursInWeek, weeksInMonth } from "./weekly-rest";
import type { WorkTimeMode } from "./work-time-mode";
import { daysInMonth, isoWeekday, toDateStr } from "@/lib/shared/dates";

/**
 * Blok 9c (🔍) — hlavný generačný algoritmus.
 *
 * PIECE 1 (kostra slučky): ako sa chodí po dňoch/pozíciách, zatvorené dni,
 * a že `locked` zmeny sa NIKDY nedotknú.
 *
 * PIECE 2 (tento diel) — skutočný výber kandidáta: `evaluateRules` (9a)
 * hard/soft filter, `scoreCandidate` (9b) výber najnižšieho skóre, a
 * priebežná aktualizácia férovosti po každom priradení. Nemenné pravidlá:
 *   - HARD porušenie → kandidát úplne vypadáva (nie penalizácia)
 *   - SOFT porušenie → kandidát zostáva, ide do skóre ako penalizácia
 *   - víťaz = najnižšie skóre spomedzi PREŽIVŠÍCH (nikdy "prvý vhodný")
 *   - nikto neprežije hard filter → DIERA s presným zoznamom kandidátov a
 *     PRESNE ktoré pravidlo (kód + hláška z `evaluateRules`) ich vyradilo
 */

export type GenerateEmployee = {
  id: string;
  name: string;
  /** Aktuálna pozícia (z `employee_position_history`) — `null` = žiadna priradená. */
  positionId: string | null;
  /** Jeho AKTÍVNE `employee_availability_rules`, platné k danému mesiacu. */
  rules: AvailabilityRuleInput[];
  /**
   * Zmluvný mesačný fond — priamo z `employees.contract_hours_per_month`, s
   * fallbackom na `legal_rules.MAX_WEEKLY_HOURS` (× priemerný počet
   * týždňov/mesiac) keď zamestnanec nemá vlastný úväzok nastavený (Q10:
   * "default plný, prepísateľný"). Reálne NIKDY `null` v
   * praxi (fallback ho pokrýva) — typ ostáva nullable len ako obranná
   * poistka, ak by `MAX_WEEKLY_HOURS` chýbal úplne. NIE z
   * `min_hours_per_month` pravidla — to bol pôvodný zámer, ale
   * `db-loader.ts` ho nikdy nečítal a rovnaké pravidlo v `evaluateRules` je
   * zámerný no-op — dve miesta na tú istú vec by len
   * mýlili, preto je aktívna len táto cesta.
   */
  contractedMonthlyHours: number | null;
  /** Z `preferred_shift` pravidla — `null` = nemá preferenciu. */
  preferredShiftTemplateId: string | null;
  /** Blok A (§87 ZP) — vyriešené `positions.work_time_mode`/zamestnancov prepis (`resolveWorkTimeMode`). Pri `nerovnomerny_turnus` MAX_WEEKLY_HOURS vôbec neplatí, viď `rules.ts`. */
  workTimeMode: WorkTimeMode;
  /**
   * Blok A (carryOverBlock) — REÁLNE priradené zmeny z
   * KONCA predchádzajúceho mesiaca (posledných ~14 dní pred 1. dňom
   * mesiaca, čo sa práve generuje). JEDINÉ, čo sa medzi mesiacmi prenáša —
   * seeduje sa do `EmployeeRunState.existingShifts` (nie do `fairness` —
   * férovosť je zámerne len za TENTO mesiac, viď princíp 3 rozhodnutia),
   * aby `findBlockContinuer`/MIN_REST_DAILY/min_rest_days na 1. dni nového
   * mesiaca správne videli, že blok/odpočinok pokračuje cez hranicu
   * mesiaca, nie že "nikto nikdy predtým nepracoval".
   */
  priorMonthTailShifts: AssignedShift[];
  /**
   * Vedúci smeny, krok 2 — `employees.can_be_shift_leader`. POZOR: `generateSchedule`
   * (táto funkcia/súbor) toto pole vôbec nečíta — obsadzovanie/skóre/férovosť
   * hodín sú úplne nedotknuté. Je tu LEN preto, aby ho mal k dispozícii
   * samostatný POSLEDNÝ prechod `lib/scheduler/shift-leader.ts`
   * (`assignShiftLeaders`), ktorý beží AŽ PO `generateSchedule()` nad jej
   * hotovým výsledkom — nech nemusí zamestnancov/pozície načítavať znova.
   * Nepovinné (`?? false` v `assignShiftLeaders`) — z rovnakého dôvodu ako
   * `pairings?` na `GenerateInput` nižšie: existujúce testy/volania, čo o
   * vedúcich smeny vôbec nevedia, nemusia toto pole dopĺňať.
   */
  canBeShiftLeader?: boolean;
};

/**
 * Jedna položka z `coverage_requirements`. POZOR: tabuľka nemá
 * `shift_template_id` (schema.sql) — nešpecifikuje, KTORÚ zmenu (ranná/
 * poobedná/nočná) má obsadenie použiť. `shiftTemplateId` je tu preto ako
 * rozhodnutie VOLAJÚCEHO (DB-loading vrstva, ešte nepostavená): jedna
 * `coverage_requirements` položka = jedna konkrétna zmena. Ak jedna pozícia
 * potrebuje pokryť viac zmien denne (ranná AJ poobedná), musia to byť
 * DVE samostatné položky.
 */
export type CoverageNeed = {
  positionId: string | null; // null = ktokoľvek
  minPeople: number;
  weekdays: number[]; // ISO 1-7
  appliesHolidays: boolean;
  isHard: boolean;
  shiftTemplateId: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
};

/** Už existujúca (ručne zadaná ALEBO z predošlého behu) zamknutá zmena — nikdy sa neprepisuje. */
export type LockedShift = {
  employeeId: string;
  date: string;
  positionId: string | null; // pozícia zamestnanca v ten deň (na počítanie pokrytia)
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
};

export type AbsenceEntry = {
  employeeId: string;
  date: string;
  // Zámerne BEZ `isConfirmed` — DB-loading vrstva načíta VŠETKY absencie
  // (potvrdené aj nepotvrdené, schema.sql: "false = žiadosť ešte visí, ale
  // generátor to už rešpektuje") a sem ich pošle už ako jeden zoznam.
  // Rozlišovanie potvrdenia sa preto v generátore vôbec nerieši — je
  // zámerne irelevantné, obe blokujú rovnako.
};

/**
 * Blok 15 (Vrstva C, po častiach — Stage 2a) — "pracuje preferovane s X",
 * naprieč pozíciami AJ prevádzkami (schema.ts, `employee_pairings`). Plochý
 * zoznam PÁROV (nie "pre tohto zamestnanca"), presne v tvare DB riadku —
 * `generateSchedule` si z neho postaví obojsmerné mapovanie samo (jeden
 * riadok platí pre OBE strany).
 *
 * STAGE 2 (mäkké páry): `isHard: false` ovplyvňuje LEN skóre (scoring.ts,
 * váha 100) — nikdy neblokuje. STAGE 3 (tvrdé páry, `isHard: true`): "obaja
 * alebo nikto" — viď `selectCandidate` (živá kontrola pri výbere) a
 * `enforceHardPairings` (dodatočné vynútenie po zložení celého mesiaca,
 * rovnaký vzor ako `enforceMinRestWeekly`/`enforceNoResidualHardViolations`
 * — hard pravidlo sa NEDÁ vyhodnotiť len z jedného kandidáta na jeden deň,
 * lebo závisí od TOHO, či partner (možno inde v poli, možno v inej
 * prevádzke, možno vyhodnotený AŽ NESKÔR ten istý deň) vôbec dostane zmenu).
 */
export type EmployeePairingInput = {
  employeeAId: string;
  employeeBId: string;
  isHard: boolean;
};

/**
 * Blok 15 — keď je PARTNER z páru zamestnancom INEJ prevádzky (bežný prípad —
 * párovanie je zámerne nezávislé od prevádzky), tento beh preň negeneruje
 * žiadne zmeny (nie je v `GenerateInput.employees`). Aby mäkké skóre aj tak
 * vedelo "partner v ten deň pracuje", DB-loading vrstva sem vloží jeho UŽ
 * REÁLNE ULOŽENÉ zmeny za cieľový mesiac (z `scheduled_shifts`, nezávisle od
 * prevádzky) — READ-ONLY snímka, nikdy sa neaktualizuje počas behu (na
 * rozdiel od `runState` pre zamestnancov TEJTO prevádzky).
 */
export type ExternalPartnerShift = {
  employeeId: string;
  date: string;
};

/**
 * Blok 15 (Stage 3) — meno partnera MIMO `employees` (iná prevádzka), pre
 * zrozumiteľné hlásenia ("partner Zuzana Wellness má dnes neprítomnosť").
 * Vedomá poistka pre RLS viditeľnosť: keď generovanie
 * spúšťa MANAŽÉR obmedzený na jednu prevádzku, `employees`/`absences`/
 * `scheduled_shifts` riadky partnera z INEJ (jemu nedostupnej) prevádzky mu
 * RLS jednoducho NEVRÁTI (fail-safe, nie chyba). Bez tohto zoznamu (ktorý
 * DB-loading vrstva naplní LEN reálne viditeľnými menami) by `generate.ts`
 * nevedel rozlíšiť "partner naozaj nepracuje" od "dáta sú pre tohto
 * používateľa jednoducho neviditeľné" — a druhý prípad by sa nesmel
 * NIKDY vyhodnotiť ako "partner nepracuje" (viď `isPartnerVerifiable`
 * nižšie), inak by manažér s obmedzeným prístupom videl svojmu zamestnancovi
 * nezmyselne zrušené zmeny kvôli páru, ktorý v skutočnosti vôbec neporušil.
 */
export type ExternalPartnerName = {
  employeeId: string;
  name: string;
};

export type GenerateInput = {
  workplaceId: string;
  year: number;
  month: number; // 1-12
  employees: GenerateEmployee[];
  coverageNeeds: CoverageNeed[];
  legalRules: LegalRuleInput[];
  lockedShifts: LockedShift[];
  absences: AbsenceEntry[];
  /** Dni, keď je CELÁ prevádzka zatvorená (`workplace_closures`) — žiadna pozícia sa ten deň neobsadzuje. */
  closedDates: string[];
  /** Sviatky (`holidays.date`) prekrývajúce sa s mesiacom. */
  holidayDates: string[];
  /**
   * Blok 15 (Stage 2a) — všetky páry, kde je ASPOŇ JEDEN zo zamestnancov v
   * `employees`. Nepovinné (`?? []` v `generateSchedule`) — nech existujúce
   * testy/volania, čo o párovaní vôbec nevedia, nemusia toto pole dopĺňať.
   */
  pairings?: EmployeePairingInput[];
  /** Blok 15 (Stage 2a) — už uložené zmeny partnerov MIMO `employees` (iná prevádzka), viď `ExternalPartnerShift`. Nepovinné z rovnakého dôvodu ako `pairings`. */
  externalPartnerShifts?: ExternalPartnerShift[];
  /** Blok 15 (Stage 3) — mená partnerov MIMO `employees`, LEN tých reálne viditeľných tomuto behu (RLS), viď `ExternalPartnerName`. */
  externalPartnerNames?: ExternalPartnerName[];
  /** Blok 15 (Stage 3) — absencie partnerov MIMO `employees`, LEN tých reálne viditeľných (rovnaká poistka ako `externalPartnerNames`) — bez tohto by živá kontrola tvrdého páru nevidela, že vzdialený partner má dovolenku. */
  externalPartnerAbsences?: AbsenceEntry[];
  /**
   * Vedúci smeny, krok 2 — `positions.id`, kde `requires_shift_leader = true`
   * (touto prevádzkou dosiahnuteľné, viď `db-loader.ts`). `generateSchedule`
   * toto pole rovnako ako `canBeShiftLeader` vôbec nečíta — určené výhradne
   * pre `assignShiftLeaders` (samostatný prechod PO tejto funkcii).
   */
  positionsRequiringShiftLeader?: string[];
};

export type Assignment = {
  employeeId: string;
  date: string;
  shiftTemplateId: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  source: "generated";
  /**
   * KTO INÝ prichádzal do úvahy a PREČO nedostal túto zmenu — aj keď sa
   * miesto obsadilo (nielen pri dierach). Bez tohto by sa "prehral na skóre"
   * (blockedBy: "SCORE") dalo pozorovať len pri diere, nikdy pri úspešnom
   * priradení — a práve TO je rozdiel medzi "vôbec nemohol" (kód pravidla) a
   * "mohol, len prehral" (SCORE), ktorý má manažér vidieť.
   */
  candidatesConsidered: RejectedCandidate[];
};

export type RejectedCandidate = {
  employeeId: string;
  name: string;
  blockedBy: string;
  detail: string;
  /**
   * Q21 — prevzaté z `RuleViolation.shortfall`/`shortfallUnit`
   * (rules.ts) pri HARD porušení pravidla — `null` pre štrukturálne dôvody
   * (POSITION/ALREADY_ASSIGNED/ABSENCE/SCORE) alebo binárne pravidlá, kde
   * "o koľko" nedáva zmysel. `lib/scheduler/gap-suggestions.ts` to používa
   * na nájdenie "najbližšieho" kandidáta pri diere.
   */
  shortfall: number | null;
  shortfallUnit: "hours" | "days" | "minutes" | null;
};

export type Gap = {
  date: string;
  positionId: string | null;
  needed: number;
  assigned: number;
  message: string;
  candidatesRejected: RejectedCandidate[];
};

export type GenerateResult = {
  assignments: Assignment[];
  gaps: Gap[];
};

const EMPTY_FAIRNESS: FairnessSnapshot = { assignedHoursThisMonth: 0, assignedWeekendShiftsThisMonth: 0, assignedHolidayShiftsThisMonth: 0 };

export type EmployeeRunState = {
  existingShifts: AssignedShift[];
  fairness: FairnessSnapshot;
  /** Koľkokrát tento zamestnanec doteraz vyhral PRESNÚ remízu v skóre. */
  tieBreakWinsThisMonth: number;
};

function emptyRunState(): EmployeeRunState {
  return { existingShifts: [], fairness: { ...EMPTY_FAIRNESS }, tieBreakWinsThisMonth: 0 };
}

/**
 * Blok 15 — obojsmerné mapovanie `input.pairings` (plochý zoznam párov) na
 * "pre TOHTO zamestnanca, toto sú JEHO partneri" — postavené RAZ na začiatku
 * `generateSchedule`, nie opakovane per deň/kandidát.
 *
 * `externalPartnerShiftDates`/`externalPartnerAbsenceDates` sú READ-ONLY
 * snímky (Stage 2a/3a, `db-loader.ts`) pre partnerov MIMO `input.employees`
 * — nikdy sa počas behu needitujú. `nameById` a `verifiedEmployeeIds`
 * existujú KVÔLI Stage 3 (tvrdé páry): `nameById` pre zrozumiteľné hlásenia,
 * `verifiedEmployeeIds` je poistka proti RLS viditeľnosti — hard-pair
 * kontrola smie o niekom vyhlásiť "nepracuje" LEN keď je jeho existencia
 * skutočne overená (je v `input.employees` ALEBO má meno v
 * `externalPartnerNames`); inak by manažér s obmedzeným prístupom mohol
 * dostať krivé zrušenie zmeny len preto, že dáta vzdialeného partnera preň
 * RLS neviditeľné (fail-safe smerom OPAČNÝM — radšej nič nevynucuj, než
 * vynúť na základe chýbajúcich dát).
 */
type PairingContext = {
  partnersByEmployee: Map<string, { partnerId: string; isHard: boolean }[]>;
  externalPartnerShiftDates: Map<string, Set<string>>;
  externalPartnerAbsenceDates: Map<string, Set<string>>;
  nameById: Map<string, string>;
  verifiedEmployeeIds: Set<string>;
};

function buildPairingContext(input: GenerateInput): PairingContext {
  const partnersByEmployee = new Map<string, { partnerId: string; isHard: boolean }[]>();
  const addDirection = (employeeId: string, partnerId: string, isHard: boolean) => {
    const list = partnersByEmployee.get(employeeId) ?? [];
    list.push({ partnerId, isHard });
    partnersByEmployee.set(employeeId, list);
  };
  for (const p of input.pairings ?? []) {
    addDirection(p.employeeAId, p.employeeBId, p.isHard);
    addDirection(p.employeeBId, p.employeeAId, p.isHard);
  }

  const externalPartnerShiftDates = new Map<string, Set<string>>();
  for (const s of input.externalPartnerShifts ?? []) {
    const set = externalPartnerShiftDates.get(s.employeeId) ?? new Set<string>();
    set.add(s.date);
    externalPartnerShiftDates.set(s.employeeId, set);
  }

  const externalPartnerAbsenceDates = new Map<string, Set<string>>();
  for (const a of input.externalPartnerAbsences ?? []) {
    const set = externalPartnerAbsenceDates.get(a.employeeId) ?? new Set<string>();
    set.add(a.date);
    externalPartnerAbsenceDates.set(a.employeeId, set);
  }

  const nameById = new Map<string, string>();
  const verifiedEmployeeIds = new Set<string>();
  for (const e of input.employees) {
    nameById.set(e.id, e.name);
    verifiedEmployeeIds.add(e.id);
  }
  for (const p of input.externalPartnerNames ?? []) {
    nameById.set(p.employeeId, p.name);
    verifiedEmployeeIds.add(p.employeeId);
  }

  return { partnersByEmployee, externalPartnerShiftDates, externalPartnerAbsenceDates, nameById, verifiedEmployeeIds };
}

/**
 * Pracuje `employeeId` (ktokoľvek — kandidát AJ jeho partner) na `date`? Pre
 * zamestnancov TOHTO behu (majú `runState`) číta ŽIVÝ stav (aktualizuje sa
 * priebežne počas generovania — takže poradie spracovania v RÁMCI JEDNÉHO
 * dňa ovplyvňuje, kto bonus dostane, viď komentár pri `selectCandidate`).
 * Pre partnerov MIMO tohto behu (iná prevádzka) číta READ-ONLY
 * `externalPartnerShiftDates` (Stage 2a, `db-loader.ts`).
 */
function worksOnDate(employeeId: string, date: string, runState: Map<string, EmployeeRunState>, pairingCtx: PairingContext): boolean {
  const state = runState.get(employeeId);
  if (state) return state.existingShifts.some((s) => s.date === date);
  return pairingCtx.externalPartnerShiftDates.get(employeeId)?.has(date) ?? false;
}

/**
 * Blok 15 (Stage 3a) — je `employeeId` na `date` PREUKÁZATEĽNE neprítomný
 * (dovolenka/PN/OČR)? Pre zamestnancov TEJTO prevádzky číta `absences`
 * priamo (rovnaký zdroj ako bežná ABSENCE kontrola), pre externých
 * `externalPartnerAbsenceDates` (Stage 3a, `db-loader.ts`).
 */
function isAbsentOnDate(employeeId: string, date: string, absences: AbsenceEntry[], pairingCtx: PairingContext): boolean {
  if (absences.some((a) => a.employeeId === employeeId && a.date === date)) return true;
  return pairingCtx.externalPartnerAbsenceDates.get(employeeId)?.has(date) ?? false;
}

/**
 * Blok 15 (Stage 2b) — koľko MÄKKÝCH partnerov `employeeId` má tento deň UŽ
 * priradených (kdekoľvek). TVRDÉ páry majú vlastný, prísnejší mechanizmus
 * (Stage 3 — `selectCandidate`/`enforceHardPairings`), preto sa TU ZÁMERNE
 * IGNORUJÚ (`!p.isHard`) — inak by tvrdý pár prispieval AJ do skóre AJ do
 * blokovania naraz, čo nedáva zmysel (blokovanie je striktnejšie a víťazí).
 */
function countMatchedSoftPartners(employeeId: string, date: string, runState: Map<string, EmployeeRunState>, pairingCtx: PairingContext): number {
  const partners = pairingCtx.partnersByEmployee.get(employeeId) ?? [];
  return partners.filter((p) => !p.isHard && worksOnDate(p.partnerId, date, runState, pairingCtx)).length;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Vypočíta priemery férovosti NAPRIEČ relevantnou skupinou (kandidáti na
 * túto potrebu) — priebežne, z aktuálneho stavu, nie raz na začiatku behu
 * (docs/ARCHITECTURE.md: "po každom priradení sa aktualizujú počty").
 *
 * Q10 — `avgAssignedHours` sa už NEPOČÍTA zo surových
 * `assignedHoursThisMonth`, ale z KAŽDÉHO rovesníka prepočítaného na
 * referenčnú škálu `avgContractedMonthlyHours` (priemer fondov medzi tými,
 * čo fond majú) — inak by táto zložka favorizovala rovnaké SUROVÉ hodiny
 * namiesto rovnakého % úväzku, keď majú rovesníci rôzny fond (napr. plný
 * vs polovičný na tej istej pozícii).
 */
function computeTeamAverages(peers: { employee: GenerateEmployee; state: EmployeeRunState }[]): TeamAverages {
  const contracted = peers.map((p) => p.employee.contractedMonthlyHours).filter((h): h is number => h !== null && h > 0);
  const avgContractedMonthlyHours = contracted.length > 0 ? average(contracted) : null;

  const normalizedHours = peers.map((p) => {
    const h = p.employee.contractedMonthlyHours;
    if (h !== null && h > 0 && avgContractedMonthlyHours !== null) {
      return (p.state.fairness.assignedHoursThisMonth / h) * avgContractedMonthlyHours;
    }
    return p.state.fairness.assignedHoursThisMonth;
  });

  return {
    avgAssignedHours: average(normalizedHours),
    avgAssignedWeekendShifts: average(peers.map((p) => p.state.fairness.assignedWeekendShiftsThisMonth)),
    avgAssignedHolidayShifts: average(peers.map((p) => p.state.fairness.assignedHolidayShiftsThisMonth)),
    avgContractedMonthlyHours,
  };
}

/**
 * Kto z kandidátov je UPROSTRED nedokončeného bloku (`block_length`) — teda
 * už odpracoval aspoň 1 deň v rade, ale ešte nedosiahol dĺžku bloku. Taký
 * človek MÁ dostať pokračovanie prednostne pred bežným skórovaním — inak by
 * sa "5-dňový blok" fakticky rozpadal na kúsky podľa toho, kto má práve
 * najnižšie skóre v ten-ktorý deň (presne to, čo si používateľ opísal:
 * "2 dni tu, 3 tam" namiesto súvislého týždňa). Deň 1 bloku sa TÝMTO
 * mechanizmom vôbec neriadi (streak by bol 0) — kto ZAČNE blok, rozhoduje
 * bežné skóre; len POKRAČOVANIE má prednosť.
 */
function findBlockContinuer(candidates: GenerateEmployee[], date: string, runState: Map<string, EmployeeRunState>): GenerateEmployee | null {
  for (const e of candidates) {
    const blockRule = e.rules.find((r) => r.ruleType === "block_length");
    if (!blockRule) continue;

    const state = runState.get(e.id) ?? emptyRunState();
    const shiftDates = new Set(state.existingShifts.map((s) => s.date));
    const streak = consecutiveWorkDaysBefore(shiftDates, date);
    const blockDays = blockRule.params.days as number;

    if (streak > 0 && streak < blockDays) return e;
  }
  return null;
}

function pickMin<T>(items: T[], key: (t: T) => number): T[] {
  const min = Math.min(...items.map(key));
  return items.filter((i) => key(i) === min);
}

function pickMax<T>(items: T[], key: (t: T) => number): T[] {
  const max = Math.max(...items.map(key));
  return items.filter((i) => key(i) === max);
}

/**
 * Deterministický rozstrel PRESNEJ remízy v skóre —
 * predtým pri remíze vyhrával, kto bol prvý v poli `employees` (poradie
 * vstupu, nie férovosť), čo pri dvoch symetrických `block_length` kolegoch
 * systematicky uprednostňovalo toho istého človeka každý mesiac (nájdené
 * vizuálnou kontrolou Skupiny A — Jana 112,5 h vs Marek 82,5 h za mesiac).
 *
 * Kritériá v tomto poradí (každé ďalšie sa použije, len ak predchádzajúce
 * STÁLE nerozhodlo):
 *   1. menej odpracovaných hodín tento mesiac (`assignedHoursThisMonth`)
 *   2. menej víkendových zmien tento mesiac
 *   3. MENEJ doterajších výhier v PRESNEJ remíze tento mesiac
 *      (`tieBreakWinsThisMonth`) — bez tohto kritérium 4 (odpočinok)
 *      systematicky vracalo výhru TOMU ISTÉMU človeku zakaždým, keď mu ten
 *      istý kolega "uvoľnil miesto": kto vyhral 1. remízu, dostal dlhý
 *      blok, jeho súper medzitým pracoval (0 dní odpočinku), takže pri
 *      ĎALŠEJ remíze víťaz PRVÉHO kola vyzeral "viac odpočinutý" a vyhral
 *      znova — donekonečna. Nájdené empiricky, nie
 *      teoreticky: potvrdené priamym behom, dňa 11.9. rozhodlo práve
 *      kritérium odpočinku (5 dní vs. 0 dní), nie ID.
 *   4. DLHŠÍ odpočinok bezprostredne pred dneškom (`consecutiveRestDaysBefore`)
 *      — uprednostní toho, kto už dlhšie oddychuje; teraz už len skutočný
 *      dolaďovací tiebreak, nie hlavný mechanizmus (kritérium 3 mu bráni
 *      systematicky favorizovať toho istého človeka)
 *   5. `employee.id` lexikograficky — posledná poistka, nezávislá od
 *      poradia v poli, len aby výsledok bol vždy deterministický
 *
 * Na poradí kandidátov vo vstupnom poli NEZÁVISÍ VÔBEC — overené testom,
 * ktorý beží ten istý mesiac s obráteným poradím `employees` a porovnáva
 * výsledok.
 */
export function breakScoreTie(
  tied: { employee: GenerateEmployee; state: EmployeeRunState }[],
  date: string,
): GenerateEmployee {
  let candidates = pickMin(tied, (c) => c.state.fairness.assignedHoursThisMonth);
  if (candidates.length === 1) return candidates[0].employee;

  candidates = pickMin(candidates, (c) => c.state.fairness.assignedWeekendShiftsThisMonth);
  if (candidates.length === 1) return candidates[0].employee;

  candidates = pickMin(candidates, (c) => c.state.tieBreakWinsThisMonth);
  if (candidates.length === 1) return candidates[0].employee;

  candidates = pickMax(candidates, (c) => {
    const shiftDates = new Set(c.state.existingShifts.map((s) => s.date));
    return consecutiveRestDaysBefore(shiftDates, date) ?? Number.POSITIVE_INFINITY;
  });
  if (candidates.length === 1) return candidates[0].employee;

  return [...candidates].sort((a, b) => (a.employee.id < b.employee.id ? -1 : a.employee.id > b.employee.id ? 1 : 0))[0].employee;
}

function selectCandidate(
  need: CoverageNeed,
  date: string,
  dayIsWeekend: boolean,
  dayIsHoliday: boolean,
  employees: GenerateEmployee[],
  usedToday: Set<string>,
  absences: AbsenceEntry[],
  legalRules: LegalRuleInput[],
  runState: Map<string, EmployeeRunState>,
  pairingCtx: PairingContext,
): { winner: GenerateEmployee | null; rejected: RejectedCandidate[] } {
  const rejected: RejectedCandidate[] = [];
  const structurallyEligible: GenerateEmployee[] = [];

  for (const e of employees) {
    if (need.positionId !== null && e.positionId !== need.positionId) {
      rejected.push({ employeeId: e.id, name: e.name, blockedBy: "POSITION", detail: "Nemá požadovanú pozíciu.", shortfall: null, shortfallUnit: null });
      continue;
    }
    if (usedToday.has(e.id)) {
      rejected.push({ employeeId: e.id, name: e.name, blockedBy: "ALREADY_ASSIGNED", detail: "Už má tento deň inú smenu.", shortfall: null, shortfallUnit: null });
      continue;
    }
    if (absences.some((a) => a.employeeId === e.id && a.date === date)) {
      rejected.push({ employeeId: e.id, name: e.name, blockedBy: "ABSENCE", detail: "Neprítomnosť v tento deň (dovolenka/PN/OČR) — blok sa (legitímne) preruší.", shortfall: null, shortfallUnit: null });
      continue;
    }

    // Blok 15 (Stage 3a) — TVRDÝ pár: "obaja alebo nikto". Tu sa dá spoľahlivo
    // zachytiť LEN prípad, keď je partner PREUKÁZATEĽNE neprítomný (absencia
    // je známa VOPRED, nezávisle od poradia spracovania) — pokrýva presne
    // scenár 3b ("jeden na dovolenke celý týždeň"). Prípad "partner ešte
    // TENTO deň nebol vyhodnotený, ale mohol by dostať zmenu neskôr" sa TU
    // ZÁMERNE NERIEŠI (rovnaká poradová nejednoznačnosť ako pri mäkkom
    // skóre, Stage 2b) — tie prípady zachytí `enforceHardPairings` až po
    // zložení celého mesiaca, kedy je už jasné, kto skutočne pracoval.
    // `verifiedEmployeeIds`: partner musí byť REÁLNE overený (viď
    // `PairingContext`) — inak by RLS-neviditeľný partner vyzeral ako
    // "vždy neprítomný" a krivo zablokoval kandidáta, ktorý v skutočnosti
    // pár neporušuje.
    const hardPartners = (pairingCtx.partnersByEmployee.get(e.id) ?? []).filter((p) => p.isHard);
    const absentHardPartner = hardPartners.find(
      (p) => pairingCtx.verifiedEmployeeIds.has(p.partnerId) && isAbsentOnDate(p.partnerId, date, absences, pairingCtx),
    );
    if (absentHardPartner) {
      const partnerName = pairingCtx.nameById.get(absentHardPartner.partnerId) ?? "partner";
      rejected.push({
        employeeId: e.id,
        name: e.name,
        blockedBy: "HARD_PAIR",
        detail: `Tvrdý pár: ${partnerName} má tento deň neprítomnosť (dovolenka/PN/OČR) — musia pracovať v ten istý deň spolu, preto nemôže dostať smenu ani ${e.name}.`,
        shortfall: null,
        shortfallUnit: null,
      });
      continue;
    }

    structurallyEligible.push(e);
  }

  const candidateShift = {
    startTime: need.startTime,
    endTime: need.endTime,
    crossesMidnight: need.crossesMidnight,
    breakMinutes: need.breakMinutes,
  };

  // Pokračovanie začatého bloku MÁ prednosť pred bežným skórovaním — ale LEN
  // ak aj tak prejde cez evaluateRules (napr. odpočinok/§ZP môžu blok
  // legitímne ukončiť skôr, presne ako max_consecutive_days pri dosiahnutí stropu).
  const continuer = findBlockContinuer(structurallyEligible, date, runState);
  if (continuer) {
    const state = runState.get(continuer.id) ?? emptyRunState();
    const violations = evaluateRules({ id: continuer.id, name: continuer.name }, date, candidateShift, {
      rules: continuer.rules,
      legalRules,
      existingShifts: state.existingShifts,
      workTimeMode: continuer.workTimeMode,
    });
    if (!violations.some((v) => v.isHard)) {
      for (const other of structurallyEligible) {
        if (other.id !== continuer.id) {
          rejected.push({ employeeId: other.id, name: other.name, blockedBy: "BLOCK_CONTINUATION", detail: `${continuer.name} pokračuje vo svojom rozbehnutom bloku (block_length).`, shortfall: null, shortfallUnit: null });
        }
      }
      return { winner: continuer, rejected };
    }
    // Pokračovanie zablokovalo iné HARD pravidlo (napr. odpočinok) — padni do bežného behu,
    // kde tento istý kandidát dostane presne ten istý (teraz už zdokumentovaný) hard-reject.
  }

  // evaluateRules HARD/SOFT filter — teraz beží NAPRIEČ vyfiltrovanými kandidátmi.
  const survivors: { employee: GenerateEmployee; softPriorities: number[] }[] = [];

  for (const e of structurallyEligible) {
    const state = runState.get(e.id) ?? emptyRunState();
    const violations = evaluateRules(
      { id: e.id, name: e.name },
      date,
      candidateShift,
      { rules: e.rules, legalRules, existingShifts: state.existingShifts, workTimeMode: e.workTimeMode },
    );

    const hardViolation = violations.find((v) => v.isHard);
    if (hardViolation) {
      rejected.push({ employeeId: e.id, name: e.name, blockedBy: hardViolation.code, detail: hardViolation.message, shortfall: hardViolation.shortfall, shortfallUnit: hardViolation.shortfallUnit });
      continue;
    }

    survivors.push({ employee: e, softPriorities: violations.filter((v) => !v.isHard).map((v) => v.priority) });
  }

  if (survivors.length === 0) {
    return { winner: null, rejected };
  }

  // Skóre (9b) — tímové priemery sa počítajú z CELEJ relevantnej skupiny (všetci
  // s touto pozíciou), nie len z dnešných prežívších. Inak by priemer kolísal
  // podľa toho, kto je náhodou dnes k dispozícii, a férovosť naprieč mesiacom
  // by bola nestabilná (dokončenie priebežnej férovosti z Piece 2).
  const positionPeers = employees.filter((e) => need.positionId === null || e.positionId === need.positionId);
  const teamAverages = computeTeamAverages(positionPeers.map((e) => ({ employee: e, state: runState.get(e.id) ?? emptyRunState() })));

  const scored = survivors.map((s) => {
    const state = runState.get(s.employee.id) ?? emptyRunState();
    const score = scoreCandidate({
      contractedMonthlyHours: s.employee.contractedMonthlyHours,
      candidateShiftHours: netWorkedHours(candidateShift),
      isWeekend: dayIsWeekend,
      isHoliday: dayIsHoliday,
      preferredShiftTemplateId: s.employee.preferredShiftTemplateId,
      candidateShiftTemplateId: need.shiftTemplateId,
      softViolationPriorities: s.softPriorities,
      matchedSoftPairedPartnersCount: countMatchedSoftPartners(s.employee.id, date, runState, pairingCtx),
      snapshot: state.fairness,
      teamAverages,
    });
    return { employee: s.employee, score, state };
  });

  const minScore = Math.min(...scored.map((s) => s.score));
  const tied = scored.filter((s) => s.score === minScore);
  const winner = tied.length === 1 ? tied[0].employee : breakScoreTie(tied, date);

  // Zaznamenaj výhru v PRESNEJ remíze — kritérium 3 v breakScoreTie ju
  // potrebuje, aby sa tá istá remíza nevracala stále tomu istému človeku.
  if (tied.length > 1) {
    const winnerState = runState.get(winner.id);
    if (winnerState) winnerState.tieBreakWinsThisMonth += 1;
  }

  for (const s of survivors) {
    if (s.employee.id !== winner.id) {
      rejected.push({ employeeId: s.employee.id, name: s.employee.name, blockedBy: "SCORE", detail: "Iný kandidát mal nižšie (výhodnejšie) skóre férovosti.", shortfall: null, shortfallUnit: null });
    }
  }

  return { winner, rejected };
}

export function generateSchedule(input: GenerateInput): GenerateResult {
  const assignments: Assignment[] = [];
  const gaps: Gap[] = [];

  // date -> zamestnanci, ktorí ten deň UŽ majú zmenu (zamknutú alebo novo priradenú)
  // — nech sa nikdy nepokúsime priradiť tomu istému človeku druhú zmenu.
  const assignedToday = new Map<string, Set<string>>();
  // date -> positionId -> počet UŽ pokrytých ľudí (zamknuté zmeny sa počítajú, ale NIKDY sa neprepíšu).
  const coveredByPosition = new Map<string, Map<string | null, number>>();
  // Priebežný stav KAŽDÉHO zamestnanca (existujúce zmeny + férovosť) — aktualizovaný PO KAŽDOM priradení.
  const runState = new Map<string, EmployeeRunState>();
  for (const e of input.employees) {
    const state = emptyRunState();
    // carryOverBlock — JEDINÉ, čo sa prenáša cez hranicu
    // mesiaca, je rozbehnutý blok. Seeduje sa LEN do existingShifts (aby
    // findBlockContinuer/MIN_REST_DAILY/min_rest_days na 1. dni mesiaca
    // videli skutočný kontext) — NIKDY do `fairness`, tá zostáva prísne
    // len za TENTO mesiac (princíp 3 rozhodnutia, žiadny cross-month súčet).
    state.existingShifts.push(...e.priorMonthTailShifts);
    runState.set(e.id, state);
  }

  // Blok 15 (Stage 2b) — postavené RAZ, čítané pri každom skórovaní.
  const pairingCtx = buildPairingContext(input);

  for (const locked of input.lockedShifts) {
    if (!assignedToday.has(locked.date)) assignedToday.set(locked.date, new Set());
    assignedToday.get(locked.date)!.add(locked.employeeId);

    if (!coveredByPosition.has(locked.date)) coveredByPosition.set(locked.date, new Map());
    const byPosition = coveredByPosition.get(locked.date)!;
    byPosition.set(locked.positionId, (byPosition.get(locked.positionId) ?? 0) + 1);

    // Zamknuté zmeny sa NEPREPISUJÚ, ale MUSIA sa počítať do stavu (bloky/odpočinok/férovosť) —
    // inak by generátor o nich pri vyhodnocovaní OSTATNÝCH dní vôbec nevedel.
    const state = runState.get(locked.employeeId);
    if (state) {
      const weekday = isoWeekday(locked.date);
      const lockedIsWeekend = weekday === 6 || weekday === 7;
      const lockedIsHoliday = input.holidayDates.includes(locked.date);
      state.existingShifts.push({ date: locked.date, startTime: locked.startTime, endTime: locked.endTime, crossesMidnight: locked.crossesMidnight, breakMinutes: locked.breakMinutes });
      state.fairness = applyAssignment(state.fairness, { hours: netWorkedHours(locked), isWeekend: lockedIsWeekend, isHoliday: lockedIsHoliday });
    }
  }

  const totalDays = daysInMonth(input.year, input.month);

  for (let day = 1; day <= totalDays; day++) {
    const date = toDateStr(input.year, input.month, day);

    // Prevádzka celkom zatvorená → žiadna pozícia sa tento deň vôbec neobsadzuje.
    if (input.closedDates.includes(date)) continue;

    const weekday = isoWeekday(date);
    const dayIsWeekend = weekday === 6 || weekday === 7;
    const isHoliday = input.holidayDates.includes(date);

    for (const need of input.coverageNeeds) {
      if (!need.weekdays.includes(weekday)) continue;
      if (isHoliday && !need.appliesHolidays) continue;

      if (!coveredByPosition.has(date)) coveredByPosition.set(date, new Map());
      const byPosition = coveredByPosition.get(date)!;
      let covered = byPosition.get(need.positionId) ?? 0;

      if (!assignedToday.has(date)) assignedToday.set(date, new Set());
      const usedToday = assignedToday.get(date)!;

      while (covered < need.minPeople) {
        const { winner, rejected } = selectCandidate(
          need,
          date,
          dayIsWeekend,
          isHoliday,
          input.employees,
          usedToday,
          input.absences,
          input.legalRules,
          runState,
          pairingCtx,
        );

        if (!winner) {
          const summary = `${date} — chýba obsadenie pozície (potrebná ${need.minPeople}, priradených ${covered}).`;
          const detail = explainCandidates(rejected);
          // Q21 — "návrhy pri dierach", NIČ nemení na
          // priradení (žiadne "najmenšie zlo") — len
          // pripojí k správe, čo by manažér mohol zvážiť ĎALEJ (najbližší
          // kandidát, kto má absenciu, či je to štrukturálny nedostatok ľudí).
          const suggestion = formatGapSuggestion(computeGapSuggestion({ rejected, need, employees: input.employees, year: input.year, month: input.month, holidayDates: input.holidayDates }));
          gaps.push({
            date,
            positionId: need.positionId,
            needed: need.minPeople,
            assigned: covered,
            message: [detail ? `${summary} ${detail}` : summary, suggestion].filter(Boolean).join(" "),
            candidatesRejected: rejected,
          });
          break; // Žiadne "najmenšie zlo" — nechaj dieru, skús ďalšiu potrebu.
        }

        assignments.push({
          employeeId: winner.id,
          date,
          shiftTemplateId: need.shiftTemplateId,
          startTime: need.startTime,
          endTime: need.endTime,
          crossesMidnight: need.crossesMidnight,
          breakMinutes: need.breakMinutes,
          source: "generated",
          candidatesConsidered: rejected,
        });
        usedToday.add(winner.id);
        covered++;
        byPosition.set(need.positionId, covered);

        // Priebežná aktualizácia férovosti — HNEĎ po priradení, nie na konci behu.
        const state = runState.get(winner.id)!;
        state.existingShifts.push({ date, startTime: need.startTime, endTime: need.endTime, crossesMidnight: need.crossesMidnight, breakMinutes: need.breakMinutes });
        state.fairness = applyAssignment(state.fairness, {
          hours: netWorkedHours(need),
          isWeekend: dayIsWeekend,
          isHoliday,
        });
      }
    }

    // Blok 15 (Stage 3 redizajn) — zosúladenie tvrdých párov HNEĎ, kým je
    // dnešok ešte "čerstvý" (nie na konci mesiaca — viď funkčný komentár
    // pri `reconcileHardPairingsForDay`). Beží AJ pre dni bez priradení
    // (no-op, rýchly filter na 0 dnešných priradení).
    reconcileHardPairingsForDay(date, assignments, gaps, input.employees, runState, pairingCtx);
  }

  enforceMinRestWeekly(assignments, gaps, input.employees, input.legalRules, runState, input.year, input.month, totalDays);

  // Blok 15 (Stage 3a) — `enforceNoResidualHardViolations` a
  // `enforceHardPairings` sa MÔŽU navzájom ovplyvňovať v reťazi: zrušenie
  // zmeny kvôli inému hard pravidlu (napr. MIN_REST_DAILY) môže NOVO
  // porušiť tvrdý pár (partner teraz "osamote" pracuje); zrušenie kvôli
  // tvrdému páru môže symetricky NOVO porušiť iné hard pravidlo (napr.
  // preruší block_length niekoho iného). Preto sa obe kontroly STRIEDAJÚ,
  // kým celé kolo nič nezmení — rovnaká záruka ukončenia ako v oboch
  // funkciách samostatne: KAŽDÉ kolo môže len RUŠIŤ priradenia, nikdy ich
  // nepridáva späť, takže celkový počet zrušení je zhora ohraničený počtom
  // priradení na začiatku tohto cyklu — nemôže sa zacykliť donekonečna.
  for (let round = 0; round < assignments.length + 1; round++) {
    const before = assignments.length;
    enforceNoResidualHardViolations(assignments, gaps, input.employees, input.legalRules, runState);
    enforceHardPairings(assignments, gaps, input.employees, runState, pairingCtx);
    if (assignments.length === before) break;
  }

  return { assignments, gaps };
}

/**
 * Bezpečnostná poistka PO `enforceMinRestWeekly`. Dodatočné zrušenie zmeny
 * (záplata JEDNÉHO hard pravidla) môže NEČAKANE porušiť INÉ hard pravidlo
 * pre TOHO ISTÉHO zamestnanca — napr. zrušenie dňa UPROSTRED súvislého bloku
 * (`block_length`) vytvorí umelú 1-dňovú medzeru, ktorá spustí `min_rest_days`
 * pre nasledujúci deň (ten pri PÔVODNOM generovaní bol úplne v poriadku —
 * plynulo pokračoval v rozbehnutom bloku). Nájdené na reálnom scenári,
 * nie v syntetických unit testoch.
 *
 * Preto po celom mesiaci beží ešte JEDNO (opakované) kolo overenia KAŽDÉHO
 * priradenia cez `evaluateRules` — rovnaký mechanizmus ako "nemenné" testy —
 * a čokoľvek nájde, tiež zruší (hard sa NIKDY neporuší, radšej dieru
 * navyše). Opakuje sa, lebo jedno zrušenie môže reťazovo
 * spôsobiť ďalšie; strop iterácií = počet priradení (nemôže sa zacykliť).
 */
function enforceNoResidualHardViolations(
  assignments: Assignment[],
  gaps: Gap[],
  employees: GenerateEmployee[],
  legalRules: LegalRuleInput[],
  runState: Map<string, EmployeeRunState>,
): void {
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  for (let iteration = 0; iteration < assignments.length + 1; iteration++) {
    let removedAny = false;

    for (const assignment of [...assignments]) {
      const employee = employeeById.get(assignment.employeeId);
      if (!employee) continue;

      const otherShifts = assignments
        .filter((a) => a.employeeId === assignment.employeeId && a.date !== assignment.date)
        .map((a) => ({ date: a.date, startTime: a.startTime, endTime: a.endTime, crossesMidnight: a.crossesMidnight, breakMinutes: a.breakMinutes }));

      const violations = evaluateRules(
        { id: employee.id, name: employee.name },
        assignment.date,
        { startTime: assignment.startTime, endTime: assignment.endTime, crossesMidnight: assignment.crossesMidnight, breakMinutes: assignment.breakMinutes },
        { rules: employee.rules, legalRules, existingShifts: otherShifts, workTimeMode: employee.workTimeMode },
      );
      const hardViolation = violations.find((v) => v.isHard);
      if (!hardViolation) continue;

      const idx = assignments.indexOf(assignment);
      assignments.splice(idx, 1);
      const state = runState.get(employee.id);
      if (state) {
        state.existingShifts = state.existingShifts.filter((s) => s.date !== assignment.date);
        state.fairness = unapplyAssignment(state.fairness, {
          hours: netWorkedHours(assignment),
          isWeekend: isoWeekday(assignment.date) === 6 || isoWeekday(assignment.date) === 7,
          isHoliday: false,
        });
      }

      gaps.push({
        date: assignment.date,
        positionId: employee.positionId,
        needed: 1,
        assigned: 0,
        message: `${assignment.date} — smena dodatočne zrušená: po úprave rozvrhu (napr. kvôli MIN_REST_WEEKLY) by porušovala ${hardViolation.code} pre ${employee.name}. ${hardViolation.message}`,
        candidatesRejected: [{ employeeId: employee.id, name: employee.name, blockedBy: hardViolation.code, detail: hardViolation.message, shortfall: hardViolation.shortfall, shortfallUnit: hardViolation.shortfallUnit }],
      });
      removedAny = true;
    }

    if (!removedAny) break;
  }
}

/**
 * Blok 15 (Stage 3 REDIZAJN) — denné zosúladenie tvrdých párov. Beží HNEĎ PO
 * spracovaní VŠETKÝCH `coverageNeeds` pre TENTO deň — NIE na konci celého
 * mesiaca (to robil pôvodný `enforceHardPairings` nižšie, ktorý teraz
 * zostáva len ako zvyškový bezpečnostný mechanizmus, viď jeho komentár).
 *
 * PREČO je toto teraz PRIMÁRNY mechanizmus, nie `enforceHardPairings`:
 * keď sa deň zruší AŽ NA KONCI MESIACA, `findBlockContinuer`/`block_length`
 * pre VŠETKY nasledujúce dni medzitým počítali streak zo STARÝCH,
 * ešte-nezmazaných dát — presne to spôsobovalo reálny bug (Jana +
 * Kuchár Dva, júl 2026): 7-dňový blok, čo bol v momente vzniku plne
 * v súlade so VŠETKÝMI hard pravidlami, sa spätne zrezal na 4 dni, lebo
 * partnerovu pozíciu tie 3 dni držal INÝ kolega z tej istej pozície
 * (dobiehajúci vlastný blok z predchádzajúceho mesiaca) — nie preto, že by
 * partner sám niečo porušil.
 *
 * Táto funkcia to rieši NEPRIAMO, nie špeciálnym prípadom pre turnus: keďže
 * zosúladenie beží HNEĎ (kým je deň ešte "čerstvý"), `runState` je VŽDY
 * presný, keď sa začne počítať ĎALŠÍ deň. `findBlockContinuer` na
 * nasledujúci deň preto vidí SKUTOČNÚ (už opravenú) históriu, nie duchov
 * dní, čo sa ešte len neskôr zmažú — takže blok, ktorý má reálne nárok na
 * 7 dní, ich aj reálne dostane (len prípadne posunutý na dni, keď partner
 * SKUTOČNE pracuje).
 *
 * Rieši aj "partner dostane zmenu neskôr v ten istý deň" (Stage 3a
 * obmedzenie živej kontroly) — kontrolujeme AŽ PO všetkých potrebách dňa,
 * takže "neskôr dnes" už v tom momente neexistuje, všetko je rozhodnuté.
 *
 * `verifiedEmployeeIds` poistka (RLS viditeľnosť) a "zruš a nechaj dieru,
 * nedopĺňaj náhradníka" princíp — rovnaké ako `enforceHardPairings`.
 *
 * Ukončenie: iteruje LEN nad DNEŠNÝMI priradeniami (typicky pár kusov, nie
 * stovky za celý mesiac) — rovnaká záruka ako `enforceHardPairings`
 * (striktne klesajúci počet priradení), len s oveľa menším a rýchlejším
 * rozsahom. Správne rieši aj hviezdicu (jeden človek, dvaja tvrdí partneri)
 * aj reťaz (A↔B↔C v ten istý deň) — overené testami nižšie.
 */
function reconcileHardPairingsForDay(
  date: string,
  assignments: Assignment[],
  gaps: Gap[],
  employees: GenerateEmployee[],
  runState: Map<string, EmployeeRunState>,
  pairingCtx: PairingContext,
): void {
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  for (let iteration = 0; iteration < assignments.length + 1; iteration++) {
    let removedAny = false;
    const todaysAssignments = assignments.filter((a) => a.date === date);

    for (const assignment of todaysAssignments) {
      const employee = employeeById.get(assignment.employeeId);
      if (!employee) continue;

      const hardPartners = (pairingCtx.partnersByEmployee.get(employee.id) ?? []).filter(
        (p) => p.isHard && pairingCtx.verifiedEmployeeIds.has(p.partnerId),
      );
      const missingPartner = hardPartners.find((p) => !worksOnDate(p.partnerId, date, runState, pairingCtx));
      if (!missingPartner) continue;

      const idx = assignments.indexOf(assignment);
      assignments.splice(idx, 1);
      const state = runState.get(employee.id);
      if (state) {
        state.existingShifts = state.existingShifts.filter((s) => s.date !== assignment.date);
        state.fairness = unapplyAssignment(state.fairness, {
          hours: netWorkedHours(assignment),
          isWeekend: isoWeekday(assignment.date) === 6 || isoWeekday(assignment.date) === 7,
          isHoliday: false,
        });
      }

      const partnerName = pairingCtx.nameById.get(missingPartner.partnerId) ?? "partner";
      gaps.push({
        date: assignment.date,
        positionId: employee.positionId,
        needed: 1,
        assigned: 0,
        message: `${assignment.date} — smena zrušená (denná kontrola): ${employee.name} je v tvrdom páre s ${partnerName}, ktorý(á) v tento deň nepracuje. Tvrdý pár vyžaduje, aby pracovali v ten istý deň spolu.`,
        candidatesRejected: [
          {
            employeeId: employee.id,
            name: employee.name,
            blockedBy: "HARD_PAIR",
            detail: `Partner ${partnerName} nemá tento deň smenu — tvrdý pár (denná kontrola).`,
            shortfall: null,
            shortfallUnit: null,
          },
        ],
      });
      removedAny = true;
    }

    if (!removedAny) break;
  }
}

/**
 * Blok 15 — TERAZ UŽ LEN ZVYŠKOVÁ POISTKA, nie primárny mechanizmus (ten je
 * `reconcileHardPairingsForDay` vyššie, beží denne priamo v hlavnej slučke).
 * Táto funkcia beží AŽ NA KONCI MESIACA, spolu s `enforceNoResidualHardViolations`,
 * a odchytáva JEDEN konkrétny zvyškový prípad: `enforceMinRestWeekly` (alebo
 * `enforceNoResidualHardViolations`) môže DODATOČNE zrušiť deň z INÉHO
 * dôvodu (týždenný odpočinok, iné hard pravidlo) — a TÝM čerstvo pokaziť
 * pár, čo bol celý mesiac v poriadku. Týždenný odpočinok sa principiálne
 * nedá vyhodnotiť skôr než po zložení celého týždňa, takže tento zvyškový
 * prípad NEMÁ skorší moment, kedy by sa dal odchytiť na dennej úrovni —
 * preto tu táto funkcia (pôvodne Stage 3a) zostáva, zámerne nezmazaná.
 *
 * Očakávanie po zavedení dennej kontroly: táto funkcia by sa mala
 * aktivovať OMNOHO zriedkavejšie než predtým (v praxi asi nikdy, pokiaľ
 * `enforceMinRestWeekly` skutočne niečo nezruší) — ale STÁLE musí existovať,
 * inak by mesačný odpočinok mohol nepozorovane pokaziť pár bez nahlásenia.
 */
function enforceHardPairings(
  assignments: Assignment[],
  gaps: Gap[],
  employees: GenerateEmployee[],
  runState: Map<string, EmployeeRunState>,
  pairingCtx: PairingContext,
): void {
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  for (let iteration = 0; iteration < assignments.length + 1; iteration++) {
    let removedAny = false;

    for (const assignment of [...assignments]) {
      const employee = employeeById.get(assignment.employeeId);
      if (!employee) continue;

      const hardPartners = (pairingCtx.partnersByEmployee.get(employee.id) ?? []).filter(
        (p) => p.isHard && pairingCtx.verifiedEmployeeIds.has(p.partnerId),
      );
      const missingPartner = hardPartners.find((p) => !worksOnDate(p.partnerId, assignment.date, runState, pairingCtx));
      if (!missingPartner) continue;

      const idx = assignments.indexOf(assignment);
      assignments.splice(idx, 1);
      const state = runState.get(employee.id);
      if (state) {
        state.existingShifts = state.existingShifts.filter((s) => s.date !== assignment.date);
        state.fairness = unapplyAssignment(state.fairness, {
          hours: netWorkedHours(assignment),
          isWeekend: isoWeekday(assignment.date) === 6 || isoWeekday(assignment.date) === 7,
          isHoliday: false,
        });
      }

      const partnerName = pairingCtx.nameById.get(missingPartner.partnerId) ?? "partner";
      gaps.push({
        date: assignment.date,
        positionId: employee.positionId,
        needed: 1,
        assigned: 0,
        message: `${assignment.date} — smena dodatočne zrušená: ${employee.name} je v tvrdom páre s ${partnerName}, ktorý(á) v tento deň nepracuje. Tvrdý pár vyžaduje, aby pracovali v ten istý deň spolu.`,
        candidatesRejected: [
          {
            employeeId: employee.id,
            name: employee.name,
            blockedBy: "HARD_PAIR",
            detail: `Partner ${partnerName} nemá tento deň smenu — tvrdý pár.`,
            shortfall: null,
            shortfallUnit: null,
          },
        ],
      });
      removedAny = true;
    }

    if (!removedAny) break;
  }
}

/**
 * MIN_REST_WEEKLY — nepretržitý 35h odpočinok v týždni.
 * Beží AŽ TERAZ, po tom, čo je celý mesiac poskladaný — nedá sa vyhodnotiť
 * z jedného kandidátneho dňa (`evaluateRules`), len z CELÉHO zloženého
 * týždňa. Ak je pravidlo HARD a týždeň ho porušuje, generátor MUSÍ ustúpiť
 * ("radšej nechaj dieru") — nie ponechať porušenie.
 *
 * Stratégia opravy je ZÁMERNE jednoduchá: zruš NAJNESKORŠIU (najbližšiu k
 * dnešku v tom týždni) VYGENEROVANÚ zmenu tohto zamestnanca — `locked`
 * zmeny sa nikdy nedotkne, tie ani nie sú v `assignments` — a nahraď ju
 * dierou. Neskúša nájsť náhradníka na uvoľnený deň (to by vyžadovalo znova
 * spustiť celý výber pre už "uzavretý" deň) — manažér dieru uvidí a doriešiť
 * ju vie ručne alebo pregenerovaním. Opakuje, kým sa týždeň nezhoduje s
 * pravidlom alebo kým už nie je čo zrušiť.
 */
function enforceMinRestWeekly(
  assignments: Assignment[],
  gaps: Gap[],
  employees: GenerateEmployee[],
  legalRules: LegalRuleInput[],
  runState: Map<string, EmployeeRunState>,
  year: number,
  month: number,
  totalDays: number,
): void {
  const rule = legalRules.find((r) => r.code === "MIN_REST_WEEKLY");
  if (!rule || !rule.isHard) return; // SOFT/nenakonfigurované — mimo rozsahu tejto (hard-only) opravy

  const requiredHours = rule.params.hours as number;
  const weeks = weeksInMonth(year, month, totalDays);

  for (const employee of employees) {
    const state = runState.get(employee.id);
    if (!state) continue;

    for (const { weekStart, weekEnd } of weeks) {
      let restHours = longestRestHoursInWeek(state.existingShifts, weekStart, weekEnd);

      // Bezpečnostný strop na počet iterácií = počet dní v týždni (nemôže sa zrušiť viac zmien, než ich je).
      for (let guard = 0; guard < 7 && restHours < requiredHours; guard++) {
        const removableThisWeek = assignments
          .filter((a) => a.employeeId === employee.id && a.date >= weekStart && a.date <= weekEnd)
          .sort((a, b) => (a.date < b.date ? 1 : -1)); // najneskorší deň prvý

        const toRemove = removableThisWeek[0];
        if (!toRemove) break; // nič viac na zrušenie (zvyšok sú len locked zmeny — tie sa nedotýkajú)

        const idx = assignments.indexOf(toRemove);
        assignments.splice(idx, 1);
        state.existingShifts = state.existingShifts.filter((s) => s.date !== toRemove.date);
        state.fairness = unapplyAssignment(state.fairness, {
          hours: netWorkedHours(toRemove),
          isWeekend: isoWeekday(toRemove.date) === 6 || isoWeekday(toRemove.date) === 7,
          isHoliday: false, // sviatočný stav sa tu nepamätá per-zmena — zanedbateľné pre opravu odpočinku, len pre férovosť
        });

        gaps.push({
          date: toRemove.date,
          positionId: employee.positionId,
          needed: 1,
          assigned: 0,
          message: `${toRemove.date} — smena zrušená DODATOČNE, aby sa dodržal nepretržitý týždenný odpočinok (min. ${requiredHours} h) pre ${employee.name}. Bez zrušenia by mal(a) len ${restHours.toFixed(1)} h odpočinku v týždni ${weekStart}–${weekEnd}.`,
          candidatesRejected: [
            {
              employeeId: employee.id,
              name: employee.name,
              blockedBy: "MIN_REST_WEEKLY",
              detail: `Nepretržitý odpočinok v týždni by bol len ${restHours.toFixed(1)} h (min. ${requiredHours} h) — táto smena bola najneskoršia v týždni, preto ustúpila.`,
              shortfall: requiredHours - restHours,
              shortfallUnit: "hours",
            },
          ],
        });

        restHours = longestRestHoursInWeek(state.existingShifts, weekStart, weekEnd);
      }
    }
  }
}
