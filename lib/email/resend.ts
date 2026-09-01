import { Resend } from "resend";
import { brandServer } from "@/lib/branding/config";

type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Odvodí jednoduchú textovú verziu z HTML — spam filtre (a časť mailových
 * klientov) očakávajú OBOJE (`text/plain` aj `text/html`), nielen HTML.
 * Zámerne JEDNO miesto (tu, nie v každej šablóne zvlášť) — všetky šablóny
 * (`lib/email/templates.ts`) sú jednoduché (odsek + jeden odkaz), takže
 * odvodená verzia je vždy čitateľná, netreba udržiavať dve paralelné sady.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<\/(p|div|h[1-6])>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Odošle email cez Resend. Kým nie je RESEND_API_KEY nastavená (napr. iný
 * dev bez kľúča), namiesto odoslania len vypíše obsah do server konzoly —
 * flow (pozvánka, reset hesla, Blok 11 notifikácie) je funkčný end-to-end,
 * len bez reálneho doručenia — NIKDY nespadne. `EMAIL_FROM` je env
 * premenná zámerne (nie zadrátovaná) — doména sa bude meniť na klientovu,
 * to nesmie znamenať zásah do kódu. `EMAIL_REPLY_TO` je VOLITEĽNÁ — bez nej
 * Resend hlavičku `Reply-To` vôbec nepošle (bežné mailové klienty potom
 * odpovedajú na `from`, čo je úplne v poriadku, kým `dochadzka@...`
 * niekto sleduje).
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const text = htmlToPlainText(params.html);

  if (!apiKey) {
    console.log(
      `[email:stub] RESEND_API_KEY nie je nastavená — email sa NEODOSLAL, len vypisujem obsah:`,
    );
    console.log(`  Komu: ${params.to}`);
    console.log(`  Predmet: ${params.subject}`);
    console.log(`  Telo (text):\n${text}`);
    return;
  }

  const from = brandServer.emailFrom;
  const replyTo = process.env.EMAIL_REPLY_TO;
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    throw new Error(`Odoslanie emailu zlyhalo: ${error.message}`);
  }
}
