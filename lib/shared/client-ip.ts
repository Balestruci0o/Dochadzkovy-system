/** Klientská IP z preposielacích hlavičiek (Vercel/proxy ich nastavuje podľa TCP spojenia). */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip");
}
