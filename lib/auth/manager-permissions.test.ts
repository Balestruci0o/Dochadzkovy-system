import { describe, expect, it } from "vitest";
import {
  DEFAULT_MANAGER_PERMISSIONS,
  hasManagerPermission,
  hasSettingsAccess,
  type ManagerPermissions,
} from "./manager-permissions";

/**
 * Granulárne pravomoci manažérov, Fáza 1 — čisté funkcie (žiadna DB). Vzor
 * lib/payroll/resolve-pay-mode.test.ts. SQL-level ekvivalent (RLS,
 * has_manager_permission(), anti-eskalácia) je v
 * lib/db/manager-permissions-rls.test.ts — TAM je jediný skutočný zdroj
 * pravdy pre bezpečnosť, toto sú len rýchle testy aplikačnej vrstvy.
 */

function perms(overrides: Partial<ManagerPermissions> = {}): ManagerPermissions {
  return { ...DEFAULT_MANAGER_PERMISSIONS, ...overrides };
}

describe("DEFAULT_MANAGER_PERMISSIONS — MUSÍ sedieť so stĺpcovými defaultmi migrácie 0047", () => {
  it("jediný default-true balíček je viewWages (dnešné manažérske správanie)", () => {
    expect(DEFAULT_MANAGER_PERMISSIONS).toEqual({
      managePositionsShifts: false,
      manageRules: false,
      manageAccounts: false,
      viewWages: true,
      editWages: false,
      manageTerminals: false,
    });
  });
});

describe("hasManagerPermission", () => {
  it("owner má VŽDY všetko, bez ohľadu na obsah permissions (aj prázdny/samé false objekt)", () => {
    const allFalse = perms({ viewWages: false });
    expect(hasManagerPermission("owner", allFalse, "manageAccounts")).toBe(true);
    expect(hasManagerPermission("owner", allFalse, "editWages")).toBe(true);
    expect(hasManagerPermission("owner", allFalse, "viewWages")).toBe(true);
  });

  it("manažér so žiadnym riadkom (default objekt) — len viewWages true, zvyšok false", () => {
    for (const key of Object.keys(DEFAULT_MANAGER_PERMISSIONS) as (keyof ManagerPermissions)[]) {
      expect(hasManagerPermission("manager", DEFAULT_MANAGER_PERMISSIONS, key)).toBe(key === "viewWages");
    }
  });

  it("manažér s konkrétnym udeleným balíčkom — presne ten je true, ostatné false", () => {
    const p = perms({ manageAccounts: true });
    expect(hasManagerPermission("manager", p, "manageAccounts")).toBe(true);
    expect(hasManagerPermission("manager", p, "manageRules")).toBe(false);
    expect(hasManagerPermission("manager", p, "managePositionsShifts")).toBe(false);
    expect(hasManagerPermission("manager", p, "editWages")).toBe(false);
    expect(hasManagerPermission("manager", p, "manageTerminals")).toBe(false);
  });

  it("employee/accountant — VŽDY false, aj keby `permissions` (nesprávne) obsahovalo samé true (funkcia si to musí vynútiť sama, nespoliehať sa na volajúceho)", () => {
    const allTrue: ManagerPermissions = {
      managePositionsShifts: true,
      manageRules: true,
      manageAccounts: true,
      viewWages: true,
      editWages: true,
      manageTerminals: true,
    };
    for (const key of Object.keys(allTrue) as (keyof ManagerPermissions)[]) {
      expect(hasManagerPermission("employee", allTrue, key)).toBe(false);
      expect(hasManagerPermission("accountant", allTrue, key)).toBe(false);
    }
  });
});

describe("hasSettingsAccess — ODVODENÝ z manage_* balíčkov (žiadny vlastný stĺpec)", () => {
  it("owner má vždy prístup", () => {
    expect(hasSettingsAccess("owner", DEFAULT_MANAGER_PERMISSIONS)).toBe(true);
  });

  it("manažér bez žiadneho nastavenia-balíčka (default) NEMÁ prístup", () => {
    expect(hasSettingsAccess("manager", DEFAULT_MANAGER_PERMISSIONS)).toBe(false);
  });

  it("manažér s ĽUBOVOĽNÝM jedným nastavenia-balíčkom MÁ prístup", () => {
    expect(hasSettingsAccess("manager", perms({ managePositionsShifts: true }))).toBe(true);
    expect(hasSettingsAccess("manager", perms({ manageRules: true }))).toBe(true);
    expect(hasSettingsAccess("manager", perms({ manageAccounts: true }))).toBe(true);
    expect(hasSettingsAccess("manager", perms({ manageTerminals: true }))).toBe(true);
  });

  it("viewWages/editWages NIE SÚ nastavenia-balíčky — samotné neodomknú Nastavenia (žijú mimo /nastavenia)", () => {
    expect(hasSettingsAccess("manager", perms({ viewWages: true, editWages: true }))).toBe(false);
  });

  it("employee/accountant — VŽDY false, aj keby `permissions` obsahovalo samé true", () => {
    const allTrue = perms({ managePositionsShifts: true, manageRules: true, manageAccounts: true, manageTerminals: true });
    expect(hasSettingsAccess("employee", allTrue)).toBe(false);
    expect(hasSettingsAccess("accountant", allTrue)).toBe(false);
  });
});
