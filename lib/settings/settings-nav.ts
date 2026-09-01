import type { ManagerPermissionKey } from "@/lib/auth/manager-permissions";

/**
 * Granulárne pravomoci manažérov — JEDINÝ zoznam nastavenia-podstránok +
 * balíčka, čo ich odomyká. Zdieľané medzi `SettingsTabs` (viditeľnosť tabov)
 * a `/nastavenia` (kam presmerovať pri vstupe na holý index) — DVA miesta s
 * vlastnou kópiou tohto zoznamu by sa časom nevyhnutne rozišli (presne to,
 * čo sa stalo pri prvom naklikaní: `/nastavenia` mal vlastný hardcoded
 * redirect na "/nastavenia/prevadzky", ktorý zabudol na pravomoci úplne).
 *
 * `permission: undefined` = OWNER-ONLY NAVŽDY, mimo systému pravomocí
 * (Prevádzky zámerne mimo v1; Sviatky je zdieľaný SK kalendár bez org_id,
 * nedá sa delegovať vôbec). Kontá dostalo `manageAccounts` vo Fáze 3.
 */
export const SETTINGS_TABS: { href: string; label: string; permission?: ManagerPermissionKey }[] = [
  { href: "/nastavenia/konta", label: "Kontá", permission: "manageAccounts" },
  { href: "/nastavenia/prevadzky", label: "Prevádzky" },
  { href: "/nastavenia/pozicie", label: "Pozície", permission: "managePositionsShifts" },
  { href: "/nastavenia/zmeny", label: "Šablóny smien", permission: "managePositionsShifts" },
  { href: "/nastavenia/pokrytie", label: "Pokrytie", permission: "manageRules" },
  { href: "/nastavenia/pravidla", label: "§ZP pravidlá", permission: "manageRules" },
  { href: "/nastavenia/zatvorenia", label: "Dni zatvorenia", permission: "manageRules" },
  { href: "/nastavenia/sviatky", label: "Sviatky" },
  { href: "/nastavenia/terminaly", label: "Terminály", permission: "manageTerminals" },
];
