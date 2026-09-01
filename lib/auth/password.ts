import { createHash } from "node:crypto";

export type PasswordCheckResult = { valid: true } | { valid: false; error: string };

const MIN_LENGTH = 12;

/**
 * Heslo: min. 12 znakov + kontrola proti HaveIBeenPwned (k-anonymity API).
 * Nikdy neposiela celé heslo — len
 * prvých 5 znakov SHA-1 hashu.
 */
export async function validatePassword(password: string): Promise<PasswordCheckResult> {
  if (password.length < MIN_LENGTH) {
    return { valid: false, error: `Heslo musí mať aspoň ${MIN_LENGTH} znakov.` };
  }

  const pwned = await isPasswordPwned(password);
  if (pwned) {
    return {
      valid: false,
      error: "Toto heslo sa objavilo pri známom úniku dát. Zvoľ, prosím, iné heslo.",
    };
  }

  return { valid: true };
}

async function isPasswordPwned(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  let response: Response;
  try {
    response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  } catch {
    // HaveIBeenPwned nedostupné — neblokujeme registráciu kvôli výpadku
    // tretej strany, len preskočíme túto kontrolu.
    return false;
  }

  if (!response.ok) return false;

  const body = await response.text();
  return body.split("\n").some((line) => line.trim().startsWith(suffix));
}
