import type { Page } from "@playwright/test";
import { BASE_URL, HELP_SCREENSHOTS_DIR, README_SCREENSHOTS_DIR, type Role } from "./config";
import * as prepare from "./prepare";

export type Category = "help" | "readme";

export type ScreenshotTarget = {
  key: string;
  category: Category;
  role: Role;
  /** `{workplace}` sa nahradí ID prevádzky `workplaceCode` (default Hotel) pred návštevou. */
  path: string;
  /**
   * Office nemá `requiresShiftLeader` (len Hotel/Recepcia) — kalendár Office
   * preto NIKDY neukazuje "chýba vedúci zmeny" upozornenia, ktoré README
   * nechce (nález Fázy S). Help screenshoty vedome ostávajú na Hoteli — tam
   * je upozornenie/porušenie súčasťou toho, čo majú ilustrovať.
   */
  workplaceCode?: "HOTEL" | "OFFICE";
  /** Text/regex, ktorý MUSÍ byť viditeľný predtým, než sa dá fotiť — dôkaz vykresleného obsahu, nie len `networkidle`. */
  readyText: string | RegExp;
  /** S2 — voliteľná sekvencia krokov (klik, vyplnenie) PRED odfotením, po `readyText`. */
  prepareState?: (page: Page) => Promise<void>;
  /**
   * Volitený krok PO screenshote (rovnaký `page`, kontext sa zavrie až po
   * ňom) — na vrátenie dočasnej zmeny, ktorú `prepareState` urobil (napr.
   * dočasné vypnutie `canBeShiftLeader` v DB pre "veduci-zmeny-priradenie",
   * viď `prepare.ts`). Bez tohto by druhý beh v rade (skúška
   * reprodukovateľnosti) videl inú DB než prvý.
   */
  cleanupState?: (page: Page) => Promise<void>;
  desktopOnly?: boolean;
  mobileOnly?: boolean;
};

const help = (t: Omit<ScreenshotTarget, "category">): ScreenshotTarget => ({ ...t, category: "help" });
const readme = (t: Omit<ScreenshotTarget, "category">): ScreenshotTarget => ({ ...t, category: "readme" });

export const TARGETS: ScreenshotTarget[] = [
  // --- A) Nápoveda — 19, presne kľúče z lib/help/content.ts ---------------
  help({ key: "moja-dochadzka-tlacidlo", role: "employee", path: "/moja-dochadzka", readyText: "Pípnuť príchod" }),
  help({ key: "qr-punch-screen", role: "employee", path: "/punch", readyText: "Kód sa obnovuje automaticky" }),
  help({ key: "prehlad-pipnuti", role: "owner", path: "/pipnutia?workplace={workplace}", readyText: "Prehľad pípnutí" }),
  help({ key: "moj-rozvrh-kalendar", role: "employee", path: "/moj-rozvrh", readyText: "Môj rozvrh" }),
  help({
    key: "kalendar-cell-picker",
    role: "owner",
    path: "/kalendar?workplace={workplace}",
    readyText: "Kalendár smien",
    prepareState: prepare.openCellPicker,
  }),
  help({
    key: "kalendar-po-generovani",
    role: "owner",
    path: "", // doplnené v index.ts (nextMonthCalendarUrl() potrebuje workplaceId)
    readyText: "Kalendár smien",
  }),
  help({
    key: "veduci-zmeny-priradenie",
    role: "owner",
    path: "/kalendar?workplace={workplace}",
    readyText: "Kalendár smien",
    prepareState: prepare.openShiftLeaderWarning,
    cleanupState: prepare.restoreShiftLeaderEligibility,
  }),
  help({ key: "nova-ziadost-formular", role: "employee", path: "/moje-ziadosti", readyText: "Nová žiadosť" }),
  help({ key: "ziadosti-schvalenie", role: "owner", path: "/ziadosti", readyText: "Žiadosti" }),
  help({ key: "vykazy-prehlad", role: "owner", path: "/vykazy?workplace={workplace}", readyText: "Výkazy a exporty" }),
  help({
    key: "nastavenia-konta",
    role: "owner",
    path: "/nastavenia/konta",
    readyText: "Kontá",
    prepareState: prepare.openNewAccountForm,
  }),
  help({ key: "nastavenia-prevadzky", role: "owner", path: "/nastavenia/prevadzky", readyText: "Prevádzky" }),
  help({
    key: "nastavenia-pozicie",
    role: "manager",
    path: "/nastavenia/pozicie",
    readyText: "Pozície",
    prepareState: prepare.openNewPositionForm,
  }),
  help({
    key: "nastavenia-zmeny",
    role: "manager",
    path: "/nastavenia/zmeny",
    readyText: "Šablóny smien",
    prepareState: prepare.openNewShiftTemplateForm,
  }),
  help({
    key: "nastavenia-pokrytie",
    role: "manager",
    path: "/nastavenia/pokrytie",
    readyText: "Pokrytie",
    prepareState: prepare.openNewCoverageForm,
  }),
  help({ key: "nastavenia-pravidla", role: "manager", path: "/nastavenia/pravidla", readyText: "§ZP pravidlá" }),
  help({
    key: "nastavenia-zatvorenia",
    role: "manager",
    path: "/nastavenia/zatvorenia",
    readyText: "Dni zatvorenia",
    prepareState: prepare.openNewClosureForm,
  }),
  help({ key: "nastavenia-sviatky", role: "owner", path: "/nastavenia/sviatky", readyText: "Sviatky" }),
  help({
    key: "nastavenia-terminaly",
    role: "manager",
    path: "/nastavenia/terminaly",
    readyText: "Terminály",
    prepareState: prepare.openNewTerminalForm,
  }),

  // --- B) README (docs/screenshots/) — 6 -----------------------------------
  // Bez "readme-prehlad-dna" — /dnes je obsahovo chudobná (produktový
  // nález, NALEZY.md, "Chýbajúci prehľad kto je v práci") a keď sme si to
  // všimli, nemá zmysel ju ukazovať v README ako víťaznú snímku. Hero je
  // teraz readme-vykaz — čísla hovoria samé za seba.
  //
  // Kalendár je Hotel (default workplaceCode), NIE Office — kalendár s
  // jedným človekom je pre plánovací nástroj zlá ukážka. Skutočná šírka
  // appky (žiadne vstreknuté CSS, žiadny širší viewport) — pri 31-dňovom
  // mesiaci sa tabuľka vodorovne orezáva kvôli max-w-[1180px] na obsahovej
  // oblasti (components/layout/app-shell.tsx) — zapísané ako produktový
  // nález v NALEZY.md, nie riešené fotografickým trikom. Bez výstražných
  // pruhov: Jana AJ Zuzana majú `canBeShiftLeader: true` (lib/db/seed.ts) —
  // Recepcia tak nemá ANI JEDEN deň bez oprávneného kandidáta, takže
  // schedule_violations (uložené PRI GENEROVANÍ, nie live) ostáva pre
  // Hotel prázdna.
  readme({
    key: "readme-kalendar",
    role: "owner",
    path: "/kalendar?workplace={workplace}",
    readyText: "Kalendár smien",
    desktopOnly: true,
  }),
  readme({ key: "readme-qr-pipanie", role: "employee", path: "/punch", readyText: "Kód sa obnovuje automaticky", desktopOnly: true }),
  readme({ key: "readme-vykaz", role: "owner", path: "/vykazy?workplace={workplace}", readyText: "Výkazy a exporty", desktopOnly: true }),
  // "Žiadosti" (manažér) je zámerne LEN fronta čakajúcich — história troch
  // stavov naraz existuje jedine na "Moje žiadosti" pre JEDNÉHO človeka
  // (Jana má teraz pending+approved+rejected, viď lib/db/seed-schedule.ts).
  readme({ key: "readme-ziadosti", role: "employee", path: "/moje-ziadosti", readyText: "Moje žiadosti", desktopOnly: true }),
  readme({ key: "readme-pravomoci-manazera", role: "owner", path: "/nastavenia/konta", readyText: "Pravomoci v Nastaveniach", desktopOnly: true }),
  readme({ key: "readme-mobil-zamestnanec", role: "employee", path: "/moja-dochadzka", readyText: "Pípnuť príchod", mobileOnly: true }),
];

export function outputDir(category: Category): string {
  return category === "help" ? HELP_SCREENSHOTS_DIR : README_SCREENSHOTS_DIR;
}

export type WorkplaceIds = { HOTEL: string; OFFICE: string };

export function resolvePath(target: ScreenshotTarget, workplaces: WorkplaceIds): string {
  const workplaceId = workplaces[target.workplaceCode ?? "HOTEL"];
  return `${BASE_URL}${target.path.replace("{workplace}", workplaceId)}`;
}
