import type { UserRole } from "./session";

const LANDING_BY_ROLE: Record<UserRole, string> = {
  owner: "/dnes",
  manager: "/dnes",
  accountant: "/vykazy",
  employee: "/moja-dochadzka",
};

/** Kam poslať používateľa danej role, keď nemáme konkrétny cieľ (`next`). */
export function getLandingPath(role: UserRole): string {
  return LANDING_BY_ROLE[role];
}
