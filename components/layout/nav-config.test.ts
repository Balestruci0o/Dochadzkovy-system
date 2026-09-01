import { describe, expect, it } from "vitest";
import { DEFAULT_MANAGER_PERMISSIONS, type ManagerPermissions } from "@/lib/auth/manager-permissions";
import { getNavForRole } from "./nav-config";

function perms(overrides: Partial<ManagerPermissions> = {}): ManagerPermissions {
  return { ...DEFAULT_MANAGER_PERMISSIONS, ...overrides };
}

describe("getNavForRole", () => {
  it("manažér BEZ nastavenia-balíčka (default): Dnes / Kalendár smien / Prehľad pípnutí / Žiadosti / Zamestnanci / Výkazy a exporty / Pomoc — ŽIADNE Nastavenia", () => {
    expect(getNavForRole("manager", DEFAULT_MANAGER_PERMISSIONS).map((n) => n.label)).toEqual([
      "Dnes",
      "Kalendár smien",
      "Prehľad pípnutí",
      "Žiadosti",
      "Zamestnanci",
      "Výkazy a exporty",
      "Pomoc",
    ]);
  });

  it("manažér S ĽUBOVOĽNÝM nastavenia-balíčkom vidí navyše 'Nastavenia' (nie 'História zmien' — tá je owner-only navždy)", () => {
    for (const p of ["managePositionsShifts", "manageRules", "manageAccounts", "manageTerminals"] as const) {
      const labels = getNavForRole("manager", perms({ [p]: true })).map((n) => n.label);
      expect(labels).toContain("Nastavenia");
      expect(labels).not.toContain("História zmien");
    }
  });

  it("viewWages/editWages samotné NEODOMKNÚ 'Nastavenia' (nie sú nastavenia-balíčky)", () => {
    const labels = getNavForRole("manager", perms({ viewWages: true, editWages: true })).map((n) => n.label);
    expect(labels).not.toContain("Nastavenia");
  });

  it("zamestnanec: Moja dochádzka / Môj rozvrh / Moje žiadosti / Pípanie / Pomoc", () => {
    expect(getNavForRole("employee", DEFAULT_MANAGER_PERMISSIONS).map((n) => n.label)).toEqual([
      "Moja dochádzka",
      "Môj rozvrh",
      "Moje žiadosti",
      "Pípanie",
      "Pomoc",
    ]);
  });

  it("Pomoc vidí úplne každá rola vrátane účtovníčky", () => {
    for (const role of ["owner", "manager", "employee", "accountant"] as const) {
      expect(getNavForRole(role, DEFAULT_MANAGER_PERMISSIONS).some((n) => n.href === "/pomoc")).toBe(true);
    }
  });

  it("owner: to čo manažér BEZ balíčkov + História zmien (audit log) + Nastavenia — owner ich má VŽDY, bez ohľadu na permissions objekt", () => {
    const managerLabels = getNavForRole("manager", DEFAULT_MANAGER_PERMISSIONS).map((n) => n.label);
    const ownerLabels = getNavForRole("owner", DEFAULT_MANAGER_PERMISSIONS).map((n) => n.label);
    expect(ownerLabels).toEqual([...managerLabels, "História zmien", "Nastavenia"]);
  });
});
