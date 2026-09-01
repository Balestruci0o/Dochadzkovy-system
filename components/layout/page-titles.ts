const DOW = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];
const MONTHS = [
  "januára",
  "februára",
  "marca",
  "apríla",
  "mája",
  "júna",
  "júla",
  "augusta",
  "septembra",
  "októbra",
  "novembra",
  "decembra",
];

function todayLong(): string {
  const d = new Date();
  return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const TITLES: Record<string, [string, string]> = {
  "/dnes": ["Prehľad dňa", todayLong()],
  "/kalendar": ["Kalendár smien", "Plánovanie rozvrhu zamestnancov"],
  "/pipnutia": ["Prehľad pípnutí", "Kto, kedy a koľko odpracoval — za deň aj za obdobie"],
  "/zamestnanci": ["Zamestnanci", "Tím — hotel a office"],
  "/vykazy": ["Výkazy a exporty", "Mesačná dochádzka a mzdové podklady"],
  "/moja-dochadzka": ["Moja dochádzka", todayLong()],
  "/moj-rozvrh": ["Môj rozvrh", "Naplánované smeny"],
  "/ziadosti": ["Žiadosti", "Dovolenka, PN, OČR, paragraf — čakajúce na schválenie"],
  "/moje-ziadosti": ["Moje žiadosti", "Dovolenka, PN, OČR, paragraf"],
  "/moje-upozornenia": ["Emailové upozornenia", "Ktoré notifikácie chodia aj mailom"],
  "/kontakt": ["Kontakt", "Podpora, majiteľ, manažér"],
  "/nastavenia": ["Nastavenia", "Prevádzky, pozície, pravidlá, terminály"],
  "/nastavenia/konta": ["Kontá", "Majiteľ, manažéri, zamestnanci — role a stav"],
  "/nastavenia/prevadzky": ["Prevádzky", "Prevádzkové dni, GPS súradnice"],
  "/nastavenia/pozicie": ["Pozície", "Číselník pozícií"],
  "/nastavenia/zmeny": ["Šablóny smien", "Čas od–do, prestávka, farba"],
  "/nastavenia/pokrytie": ["Požiadavky na pokrytie", "Koľko ľudí ktorej pozície denne"],
  "/nastavenia/pravidla": ["§ZP pravidlá", "Zákonné limity — hodiny, odpočinok"],
  "/nastavenia/zatvorenia": ["Dni zatvorenia", "Kedy je prevádzka mimo prevádzky"],
  "/nastavenia/sviatky": ["Sviatky", "Štátne sviatky SR"],
  "/nastavenia/terminaly": ["Terminály", "Registrácia a prístupový kľúč pre pípanie"],
  "/audit": ["História zmien", "Kto, kedy a čo zmenil — audit log"],
  "/pomoc": ["Pomoc", "Návody podľa témy"],
};

export function getPageTitle(pathname: string): [string, string] {
  if (TITLES[pathname]) return TITLES[pathname];
  const prefix = Object.keys(TITLES).find((p) => pathname.startsWith(`${p}/`));
  return prefix ? TITLES[prefix] : ["", ""];
}
