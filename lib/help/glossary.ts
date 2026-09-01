import type { GlossaryTerm } from "./types";

/**
 * Kontextové "?" ikonky pri zložitých pojmoch — krátke vysvetlenie priamo pri
 * poli, kde sa pojem používa (nie samostatná stránka). Rovnaká dátová
 * štruktúra ako `HELP_TOPICS` v `content.ts` — obsah, nie kód.
 */
export const GLOSSARY: Record<string, GlossaryTerm> = {
  uvazok: {
    slug: "uvazok",
    term: "Úväzok",
    explanation:
      "Úväzok hovorí, koľko hodín má zamestnanec za mesiac odpracovať podľa zmluvy — napríklad 173,93 h pri práci na plný úväzok. Rozvrh sa snaží tento počet hodín naplniť, nie ho prekročiť.",
  },
  turnus: {
    slug: "turnus",
    term: "Turnus",
    explanation:
      "Turnus je opakujúci sa blok pracovných dní, napríklad \"5 dní v práci, 2 dni voľno\", ktorý sa stále dokola opakuje. Ak má zamestnanec nastavený turnus, rozvrh mu smeny prideľuje len v jeho pracovných dňoch.",
  },
  rezimPrestavky: {
    slug: "rezim-prestavky",
    term: "Režim prestávky",
    explanation:
      "\"Automaticky\" znamená, že sa prestávka vždy odpočíta v pevnej dĺžke podľa pozície, bez toho, aby ju zamestnanec musel pípať. \"Pípa sa\" znamená, že si zamestnanec odchod aj návrat z prestávky sám pípne a do výkazu sa započíta presný odpípaný čas.",
  },
  veduciSmeny: {
    slug: "veduci-smeny",
    term: "Vedúci zmeny",
    explanation:
      "Vedúci zmeny je zamestnanec, ktorý je pre danú pozíciu a deň označený ako ten, kto danú zmenu vedie — napríklad zodpovedá za odovzdanie pokladne alebo kľúčov. Nie každá pozícia vedúceho vyžaduje; ak áno, dá sa určiť priamo pri priraďovaní zmeny.",
  },
  rezimOdchodu: {
    slug: "rezim-odchodu",
    term: "Režim odchodu",
    explanation:
      "\"Pípa odchod\" znamená, že si zamestnanec odchod vždy pípne sám — ak zabudne, zmena ostáva otvorená, kým ju manažér ručne neopraví. \"Nepípa (auto na konci zmeny)\" znamená, že ak zamestnanec pípol príchod a odchod si sám nepípne, systém mu ho na konci plánovanej zmeny dopíše automaticky.",
  },
  rezimOdmenovania: {
    slug: "rezim-odmenovania",
    term: "Režim odmeňovania",
    explanation:
      "\"Hodinová sadzba\" znamená, že sa mzda počíta ako odpracované hodiny krát sadzba — dnešný spôsob. \"Fixný plat\" znamená mesačný paušál (fix + variabilná zložka), rovnaký každý mesiac bez ohľadu na odpracované hodiny — tie sa aj tak ďalej evidujú, len sa z nich mzda neodvodzuje.",
  },
  pristupovyKluc: {
    slug: "pristupovy-kluc",
    term: "Prístupový kľúč",
    explanation:
      "Prístupový kľúč je tajný kód, ktorým sa terminál (zariadenie na pípanie pri vchode) preukáže systému, že je to naozaj on, a nie niekto cudzí. Zadáva sa len raz, pri nastavovaní terminálu — bežne ho zamestnanci nikdy nevidia ani nepotrebujú.",
  },
};
