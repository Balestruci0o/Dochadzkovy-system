import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase klient pre Server Components / Server Actions / Route Handlers.
 * Beží pod anon (publishable) kľúčom — identitu nesie session cookie,
 * autorizácia ide cez Supabase Auth. Toto sa používa LEN na auth operácie
 * (login, logout, reset hesla, MFA) — bežné DB queries idú cez lib/db
 * (Drizzle + `SET LOCAL app.user_id`).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Volané zo Server Component bez možnosti zápisu cookie —
            // middleware.ts session aj tak obnoví pri ďalšom requeste.
          }
        },
      },
    },
  );
}
