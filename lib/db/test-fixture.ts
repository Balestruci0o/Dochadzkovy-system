import { afterAll, beforeAll } from "vitest";
import { adminDb } from "./admin";
import { organizations } from "./schema";
import { deleteOrgCascade } from "./org-cleanup";

export { deleteOrgCascade } from "./org-cleanup";

/**
 * Spoločná testovacia fixtúra: "založ si vlastnú organizáciu, upracc po
 * sebe" — bez tohto sa to dá zabudnúť (presne to sa dialo doteraz).
 * Použitie (nahrádza ručný `beforeAll`/`afterAll` pár):
 *
 *   const org = testOrg("moj-test");
 *   // ... v testoch: org.id
 *
 * Musí sa volať na NAJVYŠŠEJ úrovni test súboru (nie vnútri `describe`/`it`)
 * — presne tam, kde dnes stojí ručný `beforeAll`. Cleanup beží cez
 * `deleteOrgCascade` (`./org-cleanup.ts`) — pozri tam podrobné vysvetlenie
 * mechanizmu (self-healing FK resolution, append-only give-up).
 */
export function testOrg(namePrefix: string): { readonly id: string } {
  let orgId: string;

  beforeAll(async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `${namePrefix} ${crypto.randomUUID()}` }).returning();
    orgId = org.id;
  });

  afterAll(async () => {
    await deleteOrgCascade(orgId);
  });

  return {
    get id() {
      return orgId;
    },
  };
}
