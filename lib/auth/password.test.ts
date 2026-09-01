import { afterEach, describe, expect, it, vi } from "vitest";
import { validatePassword } from "./password";

describe("validatePassword", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("odmietne heslo kratšie ako 12 znakov", async () => {
    const result = await validatePassword("krátke1234");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/12 znakov/);
  });

  it("odmietne heslo, ktoré HaveIBeenPwned pozná ako uniknuté", async () => {
    // Vypočítame skutočný SHA-1 sufix testovacieho hesla a necháme fetch
    // vrátiť presne tento sufix — testuje sa naša logika parsovania
    // odpovede, nie konkrétny reálny únik.
    const { createHash } = await import("node:crypto");
    const password = "toto-heslo-uniklo-2024";
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const suffix = sha1.slice(5);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`${suffix}:42\r\nOTHERSUFFIX0000000000000000000:1`, { status: 200 })),
    );

    const result = await validatePassword(password);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/uniklo|únik/i);
  });

  it("prijme dostatočne dlhé heslo, ktoré HIBP nepozná", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`AAAA1111BBBB2222CCCC3333DDDD4440:1`, { status: 200 })),
    );

    const result = await validatePassword("celkom-nahodne-heslo-9385");
    expect(result.valid).toBe(true);
  });

  it("keď je HaveIBeenPwned nedostupné, heslo aj tak prejde (fail-open pre výpadok tretej strany)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await validatePassword("dostatocne-dlhe-heslo-123");
    expect(result.valid).toBe(true);
  });
});
