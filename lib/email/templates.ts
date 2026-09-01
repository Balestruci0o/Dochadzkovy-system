import { brandServer } from "@/lib/branding/config";

const WRAPPER = (title: string, body: string) => `
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1c1b19;">
  <h1 style="font-size: 20px; margin-bottom: 16px;">${title}</h1>
  ${body}
  <p style="font-size: 12px; color: #9c988e; margin-top: 32px;">${brandServer.emailFooter}</p>
</div>
`;

export function inviteEmailHtml(params: { fullName: string; link: string }) {
  return WRAPPER(
    "Pozvánka do dochádzkového systému",
    `
    <p>Ahoj ${params.fullName},</p>
    <p>bol/a si pozvaný/á do dochádzkového systému firmy ${brandServer.name}. Klikni na
    odkaz nižšie a nastav si heslo:</p>
    <p><a href="${params.link}" style="display:inline-block;padding:10px 18px;background:#E0700F;color:#fff;text-decoration:none;border-radius:8px;">Nastaviť heslo</a></p>
    <p>Ak si o pozvánku nežiadal/a, tento email ignoruj.</p>
    `,
  );
}

/** 2FA (owner-only) — jednorazový 6-miestny prihlasovací kód namiesto TOTP. */
export function otpCodeEmailHtml(params: { fullName: string; code: string; ttlMinutes: number }) {
  return WRAPPER(
    "Prihlasovací kód",
    `
    <p>Ahoj ${params.fullName},</p>
    <p>tvoj prihlasovací kód do dochádzkového systému je:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:6px;text-align:center;margin:20px 0;">${params.code}</p>
    <p>Kód platí ${params.ttlMinutes} minút a dá sa použiť len raz.</p>
    <p>Ak si sa neprihlasoval/a ty, tento email ignoruj — bez hesla sa nikto do účtu nedostane.</p>
    `,
  );
}

/** Blok 14 — potvrdzovací kód pri mazaní konfigurácie/zamestnanca (rovnaký vzor ako 2FA, iný text). */
export function destructiveActionCodeEmailHtml(params: { fullName: string; code: string; ttlMinutes: number; actionLabel: string }) {
  return WRAPPER(
    "Potvrdenie zmazania",
    `
    <p>Ahoj ${params.fullName},</p>
    <p>niekto (dúfajme že ty) sa chystá natrvalo zmazať: <b>${params.actionLabel}</b>.</p>
    <p>Ak to naozaj chceš urobiť, zadaj tento potvrdzovací kód:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:6px;text-align:center;margin:20px 0;">${params.code}</p>
    <p>Kód platí ${params.ttlMinutes} minút a dá sa použiť len raz.</p>
    <p>Ak si o zmazanie nežiadal/a ty, tento email ignoruj — bez kódu sa nič nezmaže.</p>
    `,
  );
}

export function passwordResetEmailHtml(params: { link: string }) {
  return WRAPPER(
    "Obnova hesla",
    `
    <p>Niekto (dúfajme že ty) požiadal o obnovenie hesla do dochádzkového systému.</p>
    <p><a href="${params.link}" style="display:inline-block;padding:10px 18px;background:#E0700F;color:#fff;text-decoration:none;border-radius:8px;">Nastaviť nové heslo</a></p>
    <p>Ak si o obnovu nežiadal/a, tento email ignoruj — heslo zostane nezmenené.</p>
    `,
  );
}

/** Blok 11 — dovolenka/PN/OČR/paragraf schválená alebo zamietnutá (s dôvodom, ak je zamietnutá). */
export function absenceDecisionEmailHtml(params: { approved: boolean; kindLabel: string; period: string; decisionNote: string | null; link: string }) {
  const color = params.approved ? "#7E9082" : "#C0392B";
  const verdict = params.approved ? "schválená" : "zamietnutá";
  return WRAPPER(
    `Žiadosť o ${params.kindLabel.toLowerCase()} ${verdict}`,
    `
    <p>Tvoja žiadosť o <b>${params.kindLabel.toLowerCase()}</b> (${params.period}) bola
    <b style="color:${color};">${verdict}</b>.</p>
    ${params.decisionNote ? `<p><b>Dôvod:</b> ${params.decisionNote}</p>` : ""}
    <p><a href="${params.link}" style="display:inline-block;padding:10px 18px;background:#E0700F;color:#fff;text-decoration:none;border-radius:8px;">Zobraziť moje žiadosti</a></p>
    `,
  );
}

/** Blok 11 — nový rozvrh zverejnený. */
export function schedulePublishedEmailHtml(params: { workplaceName: string; year: number; month: number; link: string }) {
  return WRAPPER(
    "Nový rozvrh zverejnený",
    `
    <p>Rozvrh pre <b>${params.workplaceName}</b> na ${params.month}/${params.year} je zverejnený.</p>
    <p><a href="${params.link}" style="display:inline-block;padding:10px 18px;background:#E0700F;color:#fff;text-decoration:none;border-radius:8px;">Zobraziť môj rozvrh</a></p>
    `,
  );
}

/**
 * Generický fallback — pre notifikácie bez vlastnej šablóny (nová žiadosť
 * na schválenie, diera v rozvrhu, žiadosť/vybavenie opravy razítka). Bod 2
 * zadania: KAŽDÁ udalosť, čo ide in-app, musí vedieť ísť aj mailom — bez
 * tohto by tieto typy notifikácií, aj keď by si ich niekto zapol, nikdy
 * neprišli mailom.
 */
export function genericNotificationEmailHtml(params: { title: string; body: string | null; link: string | null }) {
  return WRAPPER(
    params.title,
    `
    ${params.body ? `<p>${params.body}</p>` : ""}
    ${params.link ? `<p><a href="${params.link}" style="display:inline-block;padding:10px 18px;background:#E0700F;color:#fff;text-decoration:none;border-radius:8px;">Otvoriť</a></p>` : ""}
    `,
  );
}
