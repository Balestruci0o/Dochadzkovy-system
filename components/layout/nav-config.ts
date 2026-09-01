import { Calendar, Clock, FileText, HelpCircle, History, ListChecks, QrCode, Settings, Umbrella, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { hasSettingsAccess, type ManagerPermissions } from "@/lib/auth/manager-permissions";
import type { UserRole } from "@/lib/auth/session";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** Pomocník — vidí ho úplne každá rola, preto samostatná položka pridávaná do VŠETKÝCH zoznamov nižšie, nie súčasť MANAGER_NAV/EMPLOYEE_NAV. */
const HELP_NAV_ITEM: NavItem = { href: "/pomoc", label: "Pomoc", icon: HelpCircle };

const MANAGER_NAV: NavItem[] = [
  { href: "/dnes", label: "Dnes", icon: Clock },
  { href: "/kalendar", label: "Kalendár smien", icon: Calendar },
  { href: "/pipnutia", label: "Prehľad pípnutí", icon: ListChecks },
  { href: "/ziadosti", label: "Žiadosti", icon: Umbrella },
  { href: "/zamestnanci", label: "Zamestnanci", icon: Users },
  { href: "/vykazy", label: "Výkazy a exporty", icon: FileText },
  HELP_NAV_ITEM,
];

const EMPLOYEE_NAV: NavItem[] = [
  { href: "/moja-dochadzka", label: "Moja dochádzka", icon: Clock },
  { href: "/moj-rozvrh", label: "Môj rozvrh", icon: Calendar },
  { href: "/moje-ziadosti", label: "Moje žiadosti", icon: Umbrella },
  // Odkaz späť na QR obrazovku (`app/punch/`, mimo AppShell) — bez tohto
  // odkazu sa zamestnanec po opustení /punch (tlačidlo "Späť do appky" v
  // qr-punch-screen.tsx) už nemal ako k nej vrátiť.
  { href: "/punch", label: "Pípanie", icon: QrCode },
  HELP_NAV_ITEM,
];

// "História zmien" ostáva OWNER-ONLY NAVŽDY (mimo systému pravomocí — audit
// log celej organizácie, nie prevádzková delegácia). "Nastavenia" sa
// manažérovi zobrazí len ak má aspoň jeden nastavenia-balíček (odvodené,
// hasSettingsAccess — rovnaká logika ako nastavenia/layout.tsx).
const AUDIT_NAV_ITEM: NavItem = { href: "/audit", label: "História zmien", icon: History };
const SETTINGS_NAV_ITEM: NavItem = { href: "/nastavenia", label: "Nastavenia", icon: Settings };

/** Navigácia sa líši podľa role AJ podľa pravomocí (manažér). */
export function getNavForRole(role: UserRole, permissions: ManagerPermissions): NavItem[] {
  switch (role) {
    case "owner":
      return [...MANAGER_NAV, AUDIT_NAV_ITEM, SETTINGS_NAV_ITEM];
    case "manager":
      return hasSettingsAccess(role, permissions) ? [...MANAGER_NAV, SETTINGS_NAV_ITEM] : MANAGER_NAV;
    case "employee":
      return EMPLOYEE_NAV;
    case "accountant":
      // Účtovníčka nie je explicitne rozpísaná — zatiaľ
      // dostáva len výkazy (jediné, čo z manažérskej navigácie dáva zmysel
      // bez prístupu k zamestnancom/kalendáru) a Pomoc (tú vidí úplne každá
      // rola). Toto je stále otvorená otázka nasadenia, nie definitívne rozhodnutie.
      return MANAGER_NAV.filter((item) => item.href === "/vykazy" || item.href === "/pomoc");
    default:
      return [];
  }
}

export function getSidebarSectionLabel(role: UserRole): string {
  return role === "employee" ? "Moje" : "Prevádzka";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Majiteľ",
  manager: "Manažér",
  employee: "Zamestnanec",
  accountant: "Účtovníčka",
};
