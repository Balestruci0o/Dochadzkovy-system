import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Zhoduj všetky cesty okrem statických súborov a obrázkov Next.js.
     */
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
