import { createBrowserClient } from "@supabase/ssr";

/**
 * Klient pre browser — jediné miesto, kde ho appka smie použiť, je
 * app/auth/callback (spracovanie tokenov z pozývacieho/reset odkazu, ktoré
 * Supabase posiela v URL fragmente `#access_token=...` — ten sa NIKDY
 * neposiela na server, takže ho vieme prečítať len client-side).
 *
 * Toto NIE JE cesta na bežné DB queries — len na dokončenie auth handshaku.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
