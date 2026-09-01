import { createClient } from "@supabase/supabase-js";

/**
 * Supabase admin klient (secret/service kľúč) — vie vytvárať auth
 * používateľov, generovať pozývacie odkazy (`auth.admin.generateLink`) a pod.
 *
 * Použiť LEN v server-side kóde (Server Actions, Route Handlers, skripty).
 * Nikdy neposielaj `SUPABASE_SECRET_KEY` do klienta.
 */
export function createSupabaseAdminClient() {
  if (!process.env.SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY nie je nastavená");
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
