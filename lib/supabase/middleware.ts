import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/prihlasenie",
  "/obnova-hesla",
  "/nastavit-heslo",
  "/auth/callback",
  "/manifest.webmanifest", // PWA manifest — prehliadač ho vie sondovať aj bez session cookie
];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/punch") || // terminál/HMAC autentifikácia, nie Supabase session
    pathname.startsWith("/api/cron") || // CRON_SECRET autentifikácia (Bearer, viď route.ts), nie Supabase session — Vercel Cron nemá prihlásenú session
    pathname === "/favicon.ico"
  );
}

/**
 * Obnoví Supabase session cookie pri každom requeste a presmeruje
 * neprihláseného používateľa na /prihlasenie. Toto je *auth* middleware —
 * `SET LOCAL app.user_id` pre RLS nastavuje samostatne lib/auth/session.ts
 * v rámci Server Component / Server Action / API route (middleware beží na
 * Edge runtime, kde nie je priame Postgres pripojenie).
 *
 * `supabase.auth.getUser()` je sieťové volanie na Supabase Auth API (overuje
 * JWT proti serveru, nie len lokálne dekóduje). Keďže ho tu robíme na KAŽDOM
 * requeste, výsledok si pošleme ďalej cez header `x-supabase-user-id` —
 * lib/auth/session.ts ho prečíta namiesto toho, aby volal getUser() ešte raz
 * (to by zdvojnásobilo sieťovú latenciu na každú navigáciu).
 */
export async function updateSession(request: NextRequest) {
  // Vyčisti prípadný klientom podvrhnutý header PRED overením — nižšie ho
  // nastavíme nanovo len vtedy, keď getUser() naozaj vráti platného usera.
  request.headers.delete("x-supabase-user-id");

  let cookiesToForward: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToForward = cookiesToSet;
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    request.headers.set("x-supabase-user-id", user.id);
  }

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/prihlasenie";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next({ request });
  cookiesToForward.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  return response;
}
