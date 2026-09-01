import type { HelpTopic } from "./types";

/**
 * Pomocník — jediné miesto pravdy pre obsah pomoci. Zámerne
 * čisté dáta (string/array), nie JSX — pripravené na to, aby sa dala v
 * budúcnosti pridať editácia priamo v appke (napr. presunom tohto poľa do
 * DB tabuľky `help_articles` so ZACHOVANÍM rovnakého tvaru), bez toho, aby
 * sa muselo prepisovať čokoľvek, čo tento súbor číta (`/pomoc`, budúci
 * editor). PRE TERAZ je to len tento súbor — žiadna DB tabuľka, žiadny
 * editor, presne ako bolo zadané.
 *
 * `placeholder: true` — sekcia, ktorej obsah ešte nie je hotový (klient
 * zatiaľ nepozná finálne UI/pravidlá danej časti — keď si nie si istý,
 * nedomýšľaj si).
 */
export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: "pipanie",
    label: "Pípanie",
    icon: "clock",
    roles: ["owner", "manager", "employee"],
    articles: [
      {
        slug: "pipnutie-z-webu",
        title: "Pípnutie príchodu a odchodu z webu",
        summary: "Ako zaznamenať príchod a odchod priamo z počítača alebo mobilu, bez terminálu.",
        roles: ["employee"],
        keywords: ["príchod", "odchod", "web", "mobil", "pípnuť"],
        steps: [
          { text: "V ľavom menu otvor stránku \"Moja dochádzka\"." },
          {
            text: "Na stránke je veľké farebné tlačidlo. Text na ňom sa mení sám podľa toho, čo je práve na rade — \"Pípnuť príchod\", ak ešte nie si v práci, alebo \"Pípnuť odchod\", ak už si prišiel/prišla. Ak tlačidlo nevidíš vôbec, pípanie z webu ti zamestnávateľ zatiaľ nepovolil (nastavuje sa pri tvojom mene v Zamestnanci → \"Môže sa pípať cez web\") — použi terminál.",
            screenshot: "moja-dochadzka-tlacidlo",
          },
          { text: "Klikni na tlačidlo. Ak sa prehliadač spýta, či môže zistiť polohu, dá sa to pokojne aj odmietnuť — pípnutie sa zapíše vždy, poloha sa používa len ako doplnková informácia pre manažéra." },
          { text: "Po chvíli sa vedľa tlačidla objaví zelený text s presným časom — to znamená, že pípnutie je zapísané." },
        ],
      },
      {
        slug: "pipnutie-cez-terminal",
        title: "Pípnutie cez terminál (QR kód)",
        summary: "Ako pípnuť pomocou QR kódu na svojom telefóne a terminálu pri vchode.",
        roles: ["employee"],
        keywords: ["QR", "kód", "terminál", "telefón", "kamera"],
        steps: [
          { text: "V ľavom menu otvor stránku \"Pípanie\"." },
          { text: "Na obrazovke telefónu sa zobrazí QR kód. Ten sa každých pár sekúnd sám obnoví — to je normálne a netreba sa tým znepokojovať." },
          { text: "Telefón s týmto kódom priblíž pred kameru terminálu pri vchode, tak aby bol celý kód vidieť.", screenshot: "qr-punch-screen" },
          { text: "Terminál pípnutie potvrdí zvukom alebo správou na svojej obrazovke. Ak má zamestnanec zapnuté pípanie prestávok, hore je aj druhá záložka \"Prestávka\" pre samostatný QR kód na prestávku." },
        ],
      },
      {
        slug: "zabudnute-pipnutie",
        title: "Zabudol/a som pípnuť",
        summary: "Čo robiť, keď sa nestihlo pípnuť príchod alebo odchod (napríklad terminál nefungoval).",
        roles: ["employee"],
        keywords: ["zabudol", "zabudla", "chýba", "nahlásiť", "terminál nefunguje"],
        steps: [
          { text: "Na stránke \"Moja dochádzka\" nájdi kartu \"Chýba mi pípnutie\" a klikni na \"Nahlásiť\"." },
          { text: "Vyplň, na ktorý deň a približne o koľkej si prišiel/prišla alebo odišiel/odišla, a krátko napíš dôvod (napr. \"terminál nešiel\")." },
          { text: "Žiadosť pošli. Manažér ju uvidí a buď schváli (zapíše sa ako nové pípnutie), alebo zamietne — dovtedy sa deň zobrazuje ako neúplný." },
        ],
      },
      {
        slug: "prehlad-pipnuti-a-oprava",
        title: "Prehľad pípnutí a ich oprava",
        summary: "Ako manažér skontroluje, kto kedy pípol, a opraví chybný záznam.",
        roles: ["owner", "manager"],
        keywords: ["oprava", "korekcia", "kontrola", "manažér"],
        steps: [
          { text: "V ľavom menu otvor stránku \"Prehľad pípnutí\"." },
          { text: "Hore si vyber prevádzku, obdobie (deň, alebo cez tlačidlo \"Tento mesiac\") a prípadne konkrétneho zamestnanca." },
          { text: "V zozname vidno pre každý deň, kedy zamestnanec prišiel a odišiel a koľko hodín mu to dalo.", screenshot: "prehlad-pipnuti" },
          { text: "Pri riadku, ktorý treba opraviť (napr. zle zapísaný čas), klikni na \"Upraviť deň\" a zadaj správny čas príchodu/odchodu (prípadne prestávky) aj krátky dôvod opravy — pôvodné pípnutie sa nevymaže, len sa označí ako opravené a rozkliknutím riadka (šípka vľavo) je vidno oboje." },
        ],
      },
    ],
  },
  {
    slug: "rozvrh",
    label: "Rozvrh",
    icon: "calendar",
    roles: ["owner", "manager", "employee"],
    articles: [
      {
        slug: "moj-rozvrh",
        title: "Kde nájdem svoje smeny",
        summary: "Ako si zamestnanec pozrie, kedy má akú zmenu naplánovanú.",
        roles: ["employee"],
        keywords: ["zmeny", "smeny", "kalendár", "rozpis"],
        steps: [
          { text: "V ľavom menu otvor stránku \"Môj rozvrh\"." },
          { text: "Zobrazí sa mesačný kalendár. Dni so zmenou majú farebný štítok s názvom zmeny a časom od-do.", screenshot: "moj-rozvrh-kalendar" },
          { text: "Šípkami vedľa názvu mesiaca sa dá prezerať aj predchádzajúci alebo nasledujúci mesiac." },
          { text: "Zobrazuje sa vždy len rozvrh, ktorý manažér už zverejnil — pripravovaný (ešte nezverejnený) rozvrh na ďalší mesiac zamestnanec nevidí, kým nie je hotový." },
        ],
      },
      {
        slug: "priradenie-zmeny",
        title: "Priradenie zmeny zamestnancovi",
        summary: "Ako manažér ručne priradí (alebo zmení) konkrétnu zmenu konkrétnemu zamestnancovi.",
        roles: ["owner", "manager"],
        keywords: ["priradiť", "zmena", "smena", "kalendár smien"],
        steps: [
          { text: "V ľavom menu otvor stránku \"Kalendár smien\" a hore si vyber správnu prevádzku." },
          { text: "V riadku zamestnanca klikni na políčko pod dňom, ktorému chceš priradiť zmenu — objaví sa malé okno s ponukou zmien.", screenshot: "kalendar-cell-picker" },
          { text: "Vyber typ zmeny zo zoznamu. Ak treba, priamo tu sa dá upraviť aj dĺžka prestávky v minútach." },
          { text: "Ak chce zamestnanec namiesto zmeny voľno (dovolenka, PN a podobne), v tom istom okne nižšie je sekcia \"Neprítomnosť\" s rovnakou voľbou." },
        ],
      },
      {
        slug: "generovanie-a-zverejnenie",
        title: "Vygenerovanie a zverejnenie rozvrhu",
        summary: "Ako nechať systém navrhnúť rozvrh na celý mesiac a následne ho sprístupniť zamestnancom.",
        roles: ["owner", "manager"],
        keywords: ["generovať", "zverejniť", "návrh", "publikovať"],
        steps: [
          { text: "Na stránke \"Kalendár smien\" klikni na tlačidlo \"Generovať rozvrh\" (alebo \"Pregenerovať rozvrh\", ak už mesiac obsahuje nejaké zmeny)." },
          { text: "Systém sám navrhne obsadenie na celý mesiac podľa pravidiel a dostupnosti zamestnancov. Návrh je zatiaľ len pracovný — zamestnanci ho ešte NEVIDIA.", screenshot: "kalendar-po-generovani" },
          { text: "Ak niekde chýba obsadenie, objaví sa upozornenie s presným vysvetlením, koho a prečo sa nepodarilo priradiť — návrh sa dá pred zverejnením ručne doplniť (viď \"Priradenie zmeny zamestnancovi\")." },
          { text: "Keď je návrh hotový, klikni na \"Zverejniť rozvrh\". Až týmto krokom sa rozvrh sprístupní zamestnancom a pošle sa im upozornenie." },
        ],
      },
      {
        slug: "veduci-zmeny",
        title: "Určenie vedúceho zmeny",
        summary: "Ako označiť, kto je pre danú zmenu vedúci — pri pozíciách, ktoré to vyžadujú.",
        roles: ["owner", "manager"],
        keywords: ["vedúci", "zmeny", "korunka"],
        steps: [
          { text: "Vedúceho zmeny ide nastaviť len pri pozíciách, ktoré ho vyžadujú (nastavuje sa v Nastavenia → Pozície)." },
          { text: "Priamo v paneli, kde sa priraďuje zmena (viď \"Priradenie zmeny zamestnancovi\"), je po priradení zmeny aj tlačidlo \"Označiť ako vedúceho zmeny\"." },
          { text: "Ak zamestnanec nemá v systéme označenie, že môže byť vedúci, systém na to upozorní — dá sa to aj tak potvrdiť tlačidlom \"Priradiť [meno] AJ TAK\", ak je to zámer.", screenshot: "veduci-zmeny-priradenie" },
          { text: "Kto je vedúci, sa dá kedykoľvek pozrieť aj zmeniť v riadku s korunkou (👑) v spodnej časti kalendára, pri danej pozícii." },
        ],
      },
    ],
  },
  {
    slug: "ziadosti",
    label: "Žiadosti",
    icon: "umbrella",
    roles: ["owner", "manager", "employee"],
    articles: [
      {
        slug: "podanie-ziadosti",
        title: "Ako požiadať o dovolenku, PN alebo iné voľno",
        summary: "Podanie žiadosti o neprítomnosť — dovolenka, PN, OČR, paragraf a ďalšie.",
        roles: ["employee"],
        keywords: ["dovolenka", "pn", "OČR", "paragraf", "voľno", "žiadosť", "podať", "ako podať"],
        steps: [
          { text: "V ľavom menu otvor stránku \"Moje žiadosti\"." },
          { text: "V hornej časti vo formulári \"Nová žiadosť\" vyber druh neprítomnosti (napr. Dovolenka) a obdobie, na ktoré ju potrebuješ.", screenshot: "nova-ziadost-formular" },
          { text: "Ak ide len o pár hodín (napríklad návšteva lekára), zaškrtni \"Len na hodiny\" a zadaj presný počet hodín namiesto celého dňa." },
          { text: "Voliteľne napíš dôvod a klikni na \"Podať žiadosť\". Nižšie na tej istej stránke potom vidno, či žiadosť ešte čaká, alebo už bola schválená či zamietnutá." },
        ],
      },
      {
        slug: "schvalenie-ziadosti",
        title: "Schválenie alebo zamietnutie žiadosti",
        summary: "Ako manažér rozhodne o žiadosti zamestnanca o voľno.",
        roles: ["owner", "manager"],
        keywords: ["schváliť", "zamietnuť", "žiadosť", "voľno"],
        steps: [
          { text: "V ľavom menu otvor stránku \"Žiadosti\" — zobrazujú sa tu všetky žiadosti, ktoré ešte čakajú na rozhodnutie." },
          { text: "Pri každej žiadosti je vidno meno zamestnanca, druh a termín neprítomnosti a prípadný dôvod. Ak má v tom termíne voľno aj niekto ďalší, systém na to upozorní.", screenshot: "ziadosti-schvalenie" },
          { text: "Klikni na \"Schváliť\", ak je termín v poriadku." },
          { text: "Ak žiadosť nemôže byť schválená, klikni na \"Zamietnuť\" — otvorí sa políčko, kam je potrebné napísať dôvod zamietnutia (bez dôvodu sa zamietnutie nedá odoslať, aby zamestnanec vedel, prečo)." },
        ],
      },
    ],
  },
  {
    slug: "vykazy",
    label: "Výkazy",
    icon: "file-text",
    roles: ["owner", "manager", "accountant"],
    articles: [
      {
        slug: "stiahnutie-vykazu",
        title: "Stiahnutie mesačného výkazu",
        summary: "Ako stiahnuť podklady pre mzdy za daný mesiac vo formáte PDF alebo Excel.",
        roles: ["owner", "manager", "accountant"],
        keywords: ["export", "pdf", "excel", "mzdy", "výplata", "podklady", "nadčas", "sviatok"],
        steps: [
          { text: "V ľavom menu otvor stránku \"Výkazy a exporty\" a šípkami hore si vyber správny mesiac a prevádzku." },
          { text: "V prehľade je za každého zamestnanca vidno odpracované a sviatočné hodiny, nadčas, neprítomnosti a hrubú mzdu. Sumy sa zobrazia len tomu, kto má pravomoc vidieť mzdy — inak sú namiesto čísla bodky.", screenshot: "vykazy-prehlad" },
          { text: "Tlačidlo \"Excel\" stiahne mesačný súhrn — jeden riadok na zamestnanca s odpracovanými hodinami, sviatkom, nadčasom, neprítomnosťami a mzdou — ten je najvhodnejší priamo na poslanie účtovníčke." },
          { text: "Tlačidlo \"PDF prehľad\" stiahne súhrnný prehľad za celú prevádzku (bez rozpisu po dňoch). Pri jednotlivom zamestnancovi v tabuľke je aj malá ikona na stiahnutie jeho PDF výkazu — ten navyše obsahuje dennú evidenciu (príchod, odchod, prestávka a hodiny za každý deň). Tlačidlo \"Individuálne výpisy všetkých\" stiahne tie isté podrobné výkazy pre všetkých zamestnancov naraz, v jednom súbore." },
        ],
      },
    ],
  },
  {
    slug: "nastavenia",
    label: "Nastavenia",
    icon: "settings",
    roles: ["owner", "manager"],
    articles: [
      {
        slug: "nastavenia-konta",
        title: "Kontá — pridanie manažéra a správa prístupov",
        summary: "Ako pridať nové konto, nastaviť pravomoci manažéra, deaktivovať konto alebo znova poslať pozvánku.",
        roles: ["owner", "manager"],
        keywords: ["konto", "manažér", "pozvánka", "aktivácia", "deaktivácia", "heslo", "prístup", "pravomoci"],
        steps: [
          { text: "Otvor Nastavenia → Kontá — vidíš ju ako majiteľ, alebo ako manažér s pridelenou pravomocou \"Kontá\". Táto stránka slúži na správu manažérskych, účtovníckych (a majiteľovi aj ďalších majiteľských) kont — zamestnanecké konto sa zakladá inde, na stránke Zamestnanci → Nový zamestnanec." },
          { text: "Klikni na \"Nové konto\", vyber rolu (Manažér, Účtovníčka, alebo — len ako majiteľ — Majiteľ) a vyplň meno, email a voliteľne telefón. Pri role Manažér navyše zaškrtni prevádzky, ktoré bude spravovať.", screenshot: "nastavenia-konta" },
          { text: "Vyber, ako sa konto aktivuje — \"Poslať pozvánku emailom\" (dostane odkaz na nastavenie hesla) alebo \"Nastaviť heslo teraz\" (zadáš heslo priamo, konto je hneď aktívne, žiadny email neodíde) — a klikni na \"Vytvoriť konto\"." },
          { text: "Konto, ktoré ešte pozvánku nepotvrdilo, má štítok \"Čaká na aktiváciu\" — dá sa mu poslať pozvánka znova tlačidlom \"Poslať znova\" (len majiteľ)." },
          { text: "Konto, ktoré má prestať pracovať v systéme, vypni tlačidlom \"Deaktivovať\" (kedykoľvek sa dá znova zapnúť cez \"Aktivovať\") — história a údaje zostanú zachované. Manažér s pravomocou \"Kontá\" smie takto vypnúť len zamestnanecké kontá, nie iné manažérske ani majiteľské." },
          { text: "Len majiteľ vidí a mení, ktoré prevádzky manažér spravuje a aké má pravomoci v sekcii \"Pravomoci v Nastaveniach\" (Pozície a šablóny smien / Pravidlá, pokrytie, zatvorenia / Terminály / Kontá) — presne tu sa rozhoduje, ktoré ďalšie stránky Nastavení daný manažér uvidí." },
        ],
      },
      {
        slug: "nastavenia-prevadzky",
        title: "Pridanie a úprava prevádzky",
        summary: "Nastavenie novej prevádzky — prevádzkové dni, časové pásmo a GPS pre pípanie z webu.",
        roles: ["owner"],
        keywords: ["prevádzka", "workplace", "gps", "otváracie dni"],
        steps: [
          { text: "Otvor Nastavenia → Prevádzky a klikni na \"Nová prevádzka\"." },
          { text: "Vyplň názov a krátky kód prevádzky (napríklad \"HOTEL\"), časové pásmo (predvolené Europe/Bratislava), zaškrtni dni, kedy je prevádzka bežne otvorená, a či funguje aj počas sviatkov.", screenshot: "nastavenia-prevadzky" },
          { text: "Voliteľne zadaj GPS súradnice a okruh v metroch — použije sa len ako doplnková kontrola pri pípaní z webu a NIKDY pípnutie nezablokuje, len ho označí ako podozrivé, ak je zamestnanec mimo okruhu." },
          { text: "Klikni na \"Pridať prevádzku\". Existujúcu prevádzku upravíš tlačidlom \"Upraviť\" priamo v zozname, vypneš tlačidlom \"Deaktivovať\"." },
        ],
      },
      {
        slug: "nastavenia-pozicie-clanok",
        title: "Pridanie pozície",
        summary: "Nastavenie pozície — farba, režim prestávok, režim odmeňovania a či vyžaduje vedúceho zmeny.",
        roles: ["owner", "manager"],
        keywords: ["pozícia", "farba", "prestávky", "vedúci", "odmeňovanie", "sadzba"],
        steps: [
          { text: "Otvor Nastavenia → Pozície (vidíš ju ako majiteľ, alebo ako manažér s pridelenou pravomocou \"Pozície a šablóny smien\") a klikni na \"Nová pozícia\"." },
          { text: "Zadaj názov, vyber farbu (uvidíš ju potom v celom kalendári) a prevádzku, ku ktorej pozícia patrí — alebo nechaj \"naprieč všetkými\", ak nie je viazaná na jednu prevádzku.", screenshot: "nastavenia-pozicie" },
          { text: "Vyber režim prestávok, režim odmeňovania (Hodinová sadzba/Fixný plat) a zaškrtni \"Vyžaduje vedúceho zmeny\", ak má táto pozícia mať vždy určeného vedúceho." },
          { text: "Klikni na \"Pridať\". Pozíciu, ktorá sa dočasne nepoužíva, vypni tlačidlom \"Deaktivovať\"; úplne ju zmažeš košíkom v zozname — appka najprv pošle potvrdzovací kód na email, bez neho sa zmazanie nedokončí." },
        ],
      },
      {
        slug: "nastavenia-zmeny-clanok",
        title: "Pridanie šablóny smeny",
        summary: "Vytvorenie typu zmeny (napríklad Ranná, Poobedná) — čas od-do, prestávka a farba.",
        roles: ["owner", "manager"],
        keywords: ["šablóna", "smena", "zmena", "čas", "prestávka"],
        steps: [
          { text: "Otvor Nastavenia → Šablóny smien (vidíš ju ako majiteľ, alebo ako manažér s pridelenou pravomocou \"Pozície a šablóny smien\") a klikni na \"Nová šablóna\"." },
          { text: "Vyber prevádzku, zadaj názov, kód a čas od-do. Ak zmena končí až na druhý deň (napríklad nočná), zaškrtni \"Smena cez polnoc\".", screenshot: "nastavenia-zmeny" },
          { text: "Nastav prestávku — buď pevný počet minút, alebo presný čas od-do." },
          { text: "Vyber farbu, ktorou sa bude táto zmena zobrazovať v kalendári, a klikni na \"Pridať šablónu\"." },
        ],
      },
      {
        slug: "nastavenia-pokrytie-clanok",
        title: "Nastavenie požiadaviek na pokrytie",
        summary: "Koľko ľudí (a na akej pozícii) má byť v danej zmene — a čo urobí generátor, keď sa to nedá splniť.",
        roles: ["owner", "manager"],
        keywords: ["pokrytie", "obsadenie", "koľko ľudí", "generátor"],
        steps: [
          { text: "Otvor Nastavenia → Pokrytie (vidíš ju ako majiteľ, alebo ako manažér s pridelenou pravomocou \"Pravidlá, pokrytie, zatvorenia\") a klikni na \"Nové pravidlo\"." },
          { text: "Vyber prevádzku, pozíciu (alebo \"ktokoľvek\") a konkrétnu šablónu smeny, ktorej sa pravidlo týka." },
          { text: "Zadaj minimálny (a voliteľne maximálny) počet ľudí, dni, kedy pravidlo platí, a či platí aj počas sviatkov.", screenshot: "nastavenia-pokrytie" },
          { text: "Vyber, či je pravidlo \"Tvrdé\" (generátor ho nikdy neporuší, radšej nechá v rozvrhu dieru) alebo \"Mäkké\" (poruší ho, len ak niet inej možnosti, a vždy to nahlási)." },
          { text: "Klikni na \"Pridať pravidlo\"." },
        ],
      },
      {
        slug: "nastavenia-pravidla-clanok",
        title: "§ZP pravidlá — zákonné limity",
        summary: "Kde sa nastavujú zákonné limity (odpočinok, dĺžka zmeny) — zmena sa hneď prejaví v generátore.",
        roles: ["owner", "manager"],
        keywords: ["zákonník práce", "odpočinok", "dĺžka zmeny", "limity"],
        steps: [
          { text: "Otvor Nastavenia → §ZP pravidlá (vidíš ju ako majiteľ, alebo ako manažér s pridelenou pravomocou \"Pravidlá, pokrytie, zatvorenia\")." },
          { text: "Existujúce pravidlo upravíš kliknutím na \"Upraviť\" — dajú sa meniť len číselné hodnoty (napríklad koľko hodín odpočinku) a to, či je pravidlo tvrdé alebo mäkké. Kód, názov ani zákonná referencia sa po založení meniť nedajú.", screenshot: "nastavenia-pravidla" },
          { text: "Nové pravidlo pridáš tlačidlom \"Nové pravidlo\" — zadaj kód, názov, voliteľne odkaz na zákon a hodnoty parametrov." },
          { text: "Zmena sa prejaví okamžite — pri ďalšom generovaní rozvrhu už systém počíta s novou hodnotou." },
        ],
      },
      {
        slug: "nastavenia-zatvorenia-clanok",
        title: "Pridanie dňa (alebo obdobia) zatvorenia",
        summary: "Kedy je prevádzka mimo prevádzky — jeden deň alebo celé obdobie naraz.",
        roles: ["owner", "manager"],
        keywords: ["zatvorenie", "sviatok prevádzky", "dovolenka firmy", "zatvorené"],
        steps: [
          { text: "Otvor Nastavenia → Dni zatvorenia (vidíš ju ako majiteľ, alebo ako manažér s pridelenou pravomocou \"Pravidlá, pokrytie, zatvorenia\") a klikni na \"Pridať zatvorenie\"." },
          { text: "Vyber prevádzku a dátum \"Od\". Ak ide o dlhšie obdobie (napríklad celofiremná dovolenka), vyplň aj \"Do\" — naraz sa pridajú všetky dni v rozsahu.", screenshot: "nastavenia-zatvorenia" },
          { text: "Voliteľne napíš dôvod a klikni na \"Pridať\"." },
          { text: "Zatvorenie, ktoré už neplatí, zmažeš košíkom priamo v zozname — bez potvrdzovacieho kódu." },
        ],
      },
      {
        slug: "nastavenia-sviatky-clanok",
        title: "Sviatky — import a ručné pridanie",
        summary: "Ako naimportovať slovenské štátne sviatky na daný rok, alebo pridať sviatok ručne.",
        roles: ["owner"],
        keywords: ["sviatok", "štátny sviatok", "import"],
        steps: [
          { text: "Otvor Nastavenia → Sviatky." },
          { text: "Do políčka pri \"Import SK sviatkov pre rok\" zadaj rok a klikni na \"Importovať\" — naplnia sa všetky slovenské štátne sviatky naraz.", screenshot: "nastavenia-sviatky" },
          { text: "Chýbajúci alebo firemný voľný deň pridáš ručne tlačidlom \"Pridať ručne\" — zadaj dátum a názov." },
          { text: "Sviatky platia naprieč celou appkou (nielen jednou prevádzkou) a dajú sa kedykoľvek zmazať košíkom v zozname." },
        ],
      },
      {
        slug: "nastavenia-terminaly-clanok",
        title: "Registrácia terminálu a prístupový kľúč",
        summary: "Ako pridať nový terminál a čo robiť s prístupovým kľúčom.",
        roles: ["owner", "manager"],
        keywords: ["terminál", "prístupový kľúč", "registrácia", "device id"],
        steps: [
          { text: "Otvor Nastavenia → Terminály (vidíš ju ako majiteľ, alebo ako manažér s pridelenou pravomocou \"Terminály\") a klikni na \"Nový terminál\"." },
          { text: "Vyber prevádzku, zadaj názov (napríklad \"Recepcia hotel\") a technický identifikátor zariadenia (Device ID) — ten dostaneš od dodávateľa terminálu.", screenshot: "nastavenia-terminaly" },
          { text: "Klikni na \"Zaregistrovať a vygenerovať prístupový kľúč\". Kľúč sa zobrazí LEN TERAZ — hneď si ho skopíruj alebo zapíš priamo do terminálu, po zatvorení okna sa už nedá znova zobraziť." },
          { text: "Ak treba kľúč vymeniť (napríklad pri podozrení na zneužitie), použi tlačidlo s ikonou kľúča pri danom termináli a potvrď — starý kľúč prestane fungovať okamžite." },
        ],
      },
    ],
  },
];
