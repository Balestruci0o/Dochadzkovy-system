import { describe, expect, it } from "vitest";
import { DEFAULT_MANAGER_PERMISSIONS, hasManagerPermission } from "@/lib/auth/manager-permissions";
import { SETTINGS_TABS } from "./settings-nav";

/**
 * Regresný test — DVAKRÁT (Fáza 2: Kontá/prevadzky redirect, Fáza 3: Kontá
 * samotné) sa stalo presne to isté: nová pravomoc sa zapojila do RLS a
 * requirePermission(), ale SETTINGS_TABS (jediný zdroj pravdy pre taby AJ
 * pre `/nastavenia` index redirect) sa zabudol aktualizovať — manažér s
 * NOVOU pravomocou potom nevidel svoj tab a bol tichým redirectom odhodený
 * až na "/dnes". Tento test zamyká, že KAŽDÝ balíček, čo appka dnes reálne
 * vynucuje (RLS + requirePermission), má ZODPOVEDAJÚCI tab v SETTINGS_TABS.
 */
describe("SETTINGS_TABS — každý zapojený balíček MUSÍ mať svoj tab (inak tichý redirect na /dnes)", () => {
  const WIRED_PERMISSIONS = ["managePositionsShifts", "manageRules", "manageTerminals", "manageAccounts"] as const;

  it.each(WIRED_PERMISSIONS)("balíček '%s' odomyká aspoň jeden tab", (permission) => {
    const matchingTabs = SETTINGS_TABS.filter((tab) => tab.permission === permission);
    expect(matchingTabs.length).toBeGreaterThan(0);
  });

  it("manažér s KAŽDÝM jedným zo zapojených balíčkov vidí aspoň jeden tab (žiadny balíček ho nenechá 'bez prístupu')", () => {
    for (const permission of WIRED_PERMISSIONS) {
      const permissions = { ...DEFAULT_MANAGER_PERMISSIONS, [permission]: true };
      const visible = SETTINGS_TABS.filter((tab) => (tab.permission ? hasManagerPermission("manager", permissions, tab.permission) : false));
      expect(visible.length).toBeGreaterThan(0);
    }
  });

  it("manažér BEZ žiadneho balíčka nevidí ŽIADEN tab (default, spätná kompatibilita)", () => {
    const visible = SETTINGS_TABS.filter((tab) => (tab.permission ? hasManagerPermission("manager", DEFAULT_MANAGER_PERMISSIONS, tab.permission) : false));
    expect(visible).toHaveLength(0);
  });

  it("owner vidí VŠETKY taby, vrátane owner-only (Prevádzky, Sviatky)", () => {
    const visible = SETTINGS_TABS.filter((tab) => (tab.permission ? hasManagerPermission("owner", DEFAULT_MANAGER_PERMISSIONS, tab.permission) : true));
    expect(visible).toHaveLength(SETTINGS_TABS.length);
  });
});
