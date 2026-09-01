import { addDays } from "@/lib/shared/dates";
import type { Assignment, GenerateInput } from "./generate";

/**
 * Vedúci smeny, krok 2 — samostatný, POSLEDNÝ prechod PO CELOM generovaní
 * (volá ho `run-generate.ts`, AŽ PO `generateSchedule()` — teda po
 * `enforceMinRestWeekly`/`enforceHardPairings`, keď sú `assignments`
 * definitívne a nič sa už neruší). Vedúci je VŽDY jeden z UŽ priradených
 * (`assignments`) — táto funkcia nič nepridáva, nič neuberá, nemení počet
 * ľudí na smene. Preto NEBEŽÍ vnútri `generateSchedule` a nedotýka sa jej
 * skóre/férovosti/turnusu — štrukturálne to ani nemôže, dostáva len hotový
 * výsledok na prečítanie.
 *
 * KROK 3 (turnus/prekryv): kontinuita bloku + seniorita pri prekryve.
 * KROK 4 (férovosť): keď seniorita remizuje (viac ĽUDÍ začína NOVÝ blok v
 * ten istý deň, nikto nie je "služobne starší"), rozhoduje počet blokov
 * vedúcovstva TOHTO mesiaca — kto viedol MENEJ, dostane prednosť.
 *
 * KĽÚČOVÁ PASCA, na ktorú toto rieši: keby sa poradie kandidátov
 * PREPOČÍTAVALO nanovo KAŽDÝ deň (aj v strede už bežiaceho bloku), samotné
 * PRIBÚDANIE bodov víťaza počas jeho bloku by mohlo v strede bloku
 * "vystriedať" vedúceho (jeho počet stúpol, súperov nie) — to je presný
 * protiklad kontinuity (bod 6 zadania: "vedúci sa nemení deň po dni").
 * Preto beží SEKVENČNE (chronologicky, per pozícia) s explicitným
 * "prilepeným" stavom (`currentLeaderId`): kým súčasný vedúci naozaj
 * pracoval AJ VČERA (nie len že je dnes eligible), ostáva vedúcim BEZ
 * PREHODNOTENIA — férovosť/seniorita sa vôbec nepočítajú znova, kým jeho
 * VLASTNÁ nepretržitá práca na pozícii trvá.
 *
 * KROK 6 (regenerácia): `existingManualLeaders` sú ručne nastavené dni
 * (`shift_leader_assignments.source = 'manual'`) v OBDOBÍ, čo sa prepočítava.
 * Táto funkcia do nich NIKDY nezapíše (writer ich aj tak chráni, viď
 * `shift-leader-writer.ts`), ale berie ich ako "pravdu o tom dni" pri
 * sekvenčnom priechode — kontinuita ("bol vedúcim aj včera"), seniorita
 * (cez `assignedDatesByEmployee`, tá manuálom nie je ovplyvnená — vychádza
 * VÝHRADNE z REÁLNEJ práce, nie z toho, kto viedol) aj férovosť (manuálne
 * priradený blok sa započíta rovnako ako vygenerovaný — inak by manažér
 * mohol ručne uprednostňovať niekoho a automatický rozpočet férovosti by o
 * tom nevedel) VŽDY zohľadňujú manuálny deň, presne ako keby ho "vybral"
 * algoritmus — len sa preň nikdy nevytvorí `ShiftLeaderDecision` (nič sa preň
 * nezapíše, writer by to aj tak zahodil).
 */

export type ShiftLeaderDecision = {
  positionId: string;
  date: string;
  employeeId: string;
};

export type ShiftLeaderGap = {
  positionId: string;
  date: string;
  message: string;
};

export type AssignShiftLeadersResult = {
  decisions: ShiftLeaderDecision[];
  gaps: ShiftLeaderGap[];
};

/** Krok 6 — jeden existujúci RUČNÝ riadok (`source = 'manual'`), na vstupe pre kontinuitu/senioritu/férovosť. `employeeId: null` = vedomá voľba "žiadny vedúci". */
export type ExistingManualLeader = {
  positionId: string;
  date: string;
  employeeId: string | null;
};

/**
 * Najskorší dátum NEPRETRŽITÉHO radu dní, čo zamestnanec pracoval na tejto
 * pozícii, končiaceho (vrátane) `date` — "začiatok jeho turnusového bloku".
 * Kráča DOZADU deň po dni cez `assignedDates`, kým nenarazí na medzeru.
 */
function blockStartDate(date: string, assignedDates: Set<string>): string {
  let start = date;
  let cursor = addDays(date, -1);
  while (assignedDates.has(cursor)) {
    start = cursor;
    cursor = addDays(cursor, -1);
  }
  return start;
}

/**
 * `input` je TEN ISTÝ objekt, čo dostala `generateSchedule` (potrebuje
 * `employees[].positionId`/`canBeShiftLeader`/`priorMonthTailShifts` a
 * `positionsRequiringShiftLeader`), `assignments` je `GenerateResult.assignments`
 * z jej výsledku. `existingManualLeaders` (krok 6, nepovinné — `?? []` z
 * rovnakého dôvodu ako `pairings?` na `GenerateInput`) sú ručne nastavené dni
 * v prepočítavanom období.
 */
export function assignShiftLeaders(
  input: GenerateInput,
  assignments: Assignment[],
  existingManualLeaders: ExistingManualLeader[] = [],
): AssignShiftLeadersResult {
  const requiredPositions = new Set(input.positionsRequiringShiftLeader ?? []);
  if (requiredPositions.size === 0) return { decisions: [], gaps: [] };

  const employeeById = new Map(input.employees.map((e) => [e.id, e]));

  // employeeId → VŠETKY dni, čo pracoval na SVOJEJ pozícii (na výpočet
  // turnusového bloku/senority, `blockStartDate` vyššie) — seedované
  // chvostom predchádzajúceho mesiaca (`priorMonthTailShifts`, rovnaký
  // mechanizmus ako `findBlockContinuer` v `generate.ts`), aby blok
  // rozbehnutý koncom predošlého mesiaca správne pokračoval cez hranicu
  // mesiaca (aj v senorite, aj v kontinuite "pracoval včera"). ZÁMERNE
  // NEOVPLYVNENÉ manuálnymi vedúcimi — seniorita je o REÁLNEJ práci, nie o
  // tom, kto bol (ručne) označený za vedúceho.
  const assignedDatesByEmployee = new Map<string, Set<string>>();
  for (const e of input.employees) {
    if (e.priorMonthTailShifts.length === 0) continue;
    assignedDatesByEmployee.set(e.id, new Set(e.priorMonthTailShifts.map((s) => s.date)));
  }

  // "date|positionId" → zoznam employeeId priradených TAM v ten deň.
  const assignedByDayPosition = new Map<string, string[]>();
  for (const a of assignments) {
    const employee = employeeById.get(a.employeeId);
    if (!employee?.positionId || !requiredPositions.has(employee.positionId)) continue;

    const dates = assignedDatesByEmployee.get(a.employeeId);
    if (dates) dates.add(a.date);
    else assignedDatesByEmployee.set(a.employeeId, new Set([a.date]));

    const key = `${a.date}|${employee.positionId}`;
    const list = assignedByDayPosition.get(key);
    if (list) list.push(a.employeeId);
    else assignedByDayPosition.set(key, [a.employeeId]);
  }

  // Krok 6 — manuálne dni ako mapa "date|positionId" → employeeId | null.
  const manualByKey = new Map<string, string | null>();
  for (const m of existingManualLeaders) {
    if (!requiredPositions.has(m.positionId)) continue;
    manualByKey.set(`${m.date}|${m.positionId}`, m.employeeId);
  }

  // Zoskup podľa pozície, v rámci pozície chronologicky — na rozdiel od
  // krokov 2/3 (nezávislé per (deň, pozícia)) je toto SEKVENČNÉ: deň N
  // závisí od rozhodnutia dňa N-1 (kontinuita) aj od kumulatívnych bodov
  // (férovosť). Množina dní PER pozícia je union pracovných dní
  // (`assignedByDayPosition`) A manuálnych rozhodnutí — manuálny deň sa MUSÍ
  // spracovať aj keby (nezvyčajne) nemal zodpovedajúci `assignments` záznam v
  // tomto behu, inak by sa kontinuita/férovosť za ním "stratila".
  const keysByPosition = new Map<string, Set<string>>();
  for (const key of assignedByDayPosition.keys()) {
    const positionId = key.slice(key.indexOf("|") + 1);
    const set = keysByPosition.get(positionId);
    if (set) set.add(key);
    else keysByPosition.set(positionId, new Set([key]));
  }
  for (const key of manualByKey.keys()) {
    const positionId = key.slice(key.indexOf("|") + 1);
    const set = keysByPosition.get(positionId);
    if (set) set.add(key);
    else keysByPosition.set(positionId, new Set([key]));
  }

  const decisions: ShiftLeaderDecision[] = [];
  const gaps: ShiftLeaderGap[] = [];
  // Body TOHTO behu (= tohto mesiaca) — rovnaká zásada ako hodinová
  // férovosť v `scoring.ts`: nikdy sa neprenáša naprieč mesiacmi, reset na
  // začiatku každého behu. Manuálne bloky sa počítajú DO tohto súčtu (krok 6).
  const blocksLedByEmployee = new Map<string, number>();

  for (const positionId of [...keysByPosition.keys()].sort()) {
    const keys = [...keysByPosition.get(positionId)!].sort();
    let currentLeaderId: string | null = null;

    for (const key of keys) {
      const date = key.slice(0, key.indexOf("|"));

      if (manualByKey.has(key)) {
        // Krok 6 — RUČNE nastavený deň: NIKDY sa doň nezapisuje (žiadny
        // `decisions.push`, writer by to aj tak zahodil), ale je "pravdou o
        // tomto dni" pre všetko ĎALEJ — kontinuita nasledujúceho dňa,
        // seniorita (cez skutočnú prácu, nezávisle od tohto rozhodnutia) aj
        // férovosť (nový manuálny blok sa počíta rovnako ako vygenerovaný).
        const manualLeader = manualByKey.get(key)!;
        if (manualLeader && currentLeaderId !== manualLeader) {
          blocksLedByEmployee.set(manualLeader, (blocksLedByEmployee.get(manualLeader) ?? 0) + 1);
        }
        currentLeaderId = manualLeader; // null = vedomé "žiadny vedúci" → kontinuita sa preruší
        continue;
      }

      const employeeIds = assignedByDayPosition.get(key) ?? [];
      const eligible = employeeIds.filter((id) => employeeById.get(id)?.canBeShiftLeader);

      if (eligible.length === 0) {
        const names = employeeIds.map((id) => employeeById.get(id)?.name ?? id).join(", ");
        gaps.push({ positionId, date, message: `Nikto z priradených (${names}) nemá "môže byť vedúci" — pozícia zostáva bez vedúceho zmeny.` });
        currentLeaderId = null; // žiadny oprávnený → kontinuita sa štrukturálne preruší
        continue;
      }

      // KONTINUITA — súčasný vedúci (generovaný ALEBO prevzatý z manuálneho
      // dňa vyššie) pokračuje BEZ prehodnotenia, kým jeho VLASTNÁ nepretržitá
      // práca na pozícii trvá (pracoval aj včera).
      const yesterday = addDays(date, -1);
      if (currentLeaderId && eligible.includes(currentLeaderId) && (assignedDatesByEmployee.get(currentLeaderId)?.has(yesterday) ?? false)) {
        decisions.push({ positionId, date, employeeId: currentLeaderId });
        continue;
      }

      // NOVÁ VOĽBA — vždy znamená začiatok NOVÉHO bloku vedúcovstva (inak by
      // sme boli v kontinuite vyššie). Seniorita (`blockStartDate`)
      // rozhoduje najprv; férovosť (počet blokov TOHTO mesiaca, VRÁTANE
      // manuálnych) LEN pri jej remíze; `employeeId` je posledná
      // deterministická poistka.
      const ranked = eligible
        .map((id) => ({
          id,
          seniorBlockStart: blockStartDate(date, assignedDatesByEmployee.get(id) ?? new Set()),
          blocksLed: blocksLedByEmployee.get(id) ?? 0,
        }))
        .sort((a, b) => {
          if (a.seniorBlockStart !== b.seniorBlockStart) return a.seniorBlockStart < b.seniorBlockStart ? -1 : 1;
          if (a.blocksLed !== b.blocksLed) return a.blocksLed - b.blocksLed;
          return a.id < b.id ? -1 : 1;
        });

      const winner = ranked[0].id;
      currentLeaderId = winner;
      decisions.push({ positionId, date, employeeId: winner });
      blocksLedByEmployee.set(winner, (blocksLedByEmployee.get(winner) ?? 0) + 1);
    }
  }

  return { decisions, gaps };
}
