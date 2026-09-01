import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { htmlToPlainText, sendEmail } from "./resend";

/**
 * Spam-diagnostika (klient nahlásil doručenie do spamu): chýbajúci
 * text/plain fallback bol jeden z reálne nájdených nedostatkov —
 * `sendEmail` teraz VŽDY posiela aj `text`, odvodený z `html` na jednom
 * mieste (nie v každej šablóne zvlášť).
 */

const sendMock = vi.fn<(params: unknown) => Promise<{ data: { id: string } | null; error: null }>>();
sendMock.mockResolvedValue({ data: { id: "test-mock" }, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

describe("htmlToPlainText", () => {
  it("odstráni HTML značky, zachová text odkazu AJ jeho URL", () => {
    const html = `<p>Ahoj Jana,</p><p><a href="https://app.example.com/x">Nastaviť heslo</a></p>`;
    const text = htmlToPlainText(html);
    expect(text).toContain("Ahoj Jana,");
    expect(text).toContain("Nastaviť heslo (https://app.example.com/x)");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("<a");
  });

  it("dekóduje bežné HTML entity", () => {
    expect(htmlToPlainText("<p>A &amp; B &nbsp; C</p>")).toBe("A & B   C".replace(/\s+/g, " ").trim());
  });
});

describe("sendEmail — vždy posiela AJ text/plain (nie len HTML)", () => {
  // `sendEmail` bez RESEND_API_KEY len vypíše obsah do konzoly a resend
  // balík vôbec nezavolá (zámerný "stub" režim, viď resend.ts) — tieto testy
  // overujú SKUTOČNÉ odoslanie cez (mockovaný) resend balík, takže potrebujú
  // kľúč nastavený.
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "test-resend-api-key");
  });

  afterEach(() => {
    sendMock.mockClear();
    vi.unstubAllEnvs();
    delete process.env.EMAIL_REPLY_TO;
  });

  it("s RESEND_API_KEY (mockovaný resend balík) → posiela html AJ text", async () => {
    await sendEmail({ to: "test@example.com", subject: "Test predmet", html: "<p>Obsah emailu</p>" });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0] as { html: string; text: string; replyTo?: string };
    expect(call.html).toBe("<p>Obsah emailu</p>");
    expect(call.text).toBe("Obsah emailu");
    expect(call.replyTo).toBeUndefined(); // EMAIL_REPLY_TO nenastavená → hlavička sa vôbec neposiela
  });

  it("s EMAIL_REPLY_TO nastavenou → pošle sa aj replyTo", async () => {
    process.env.EMAIL_REPLY_TO = "podpora@example.com";
    await sendEmail({ to: "test@example.com", subject: "Test", html: "<p>x</p>" });

    const call = sendMock.mock.calls[0][0] as { replyTo?: string };
    expect(call.replyTo).toBe("podpora@example.com");
  });
});
