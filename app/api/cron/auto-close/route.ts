import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAutoClose } from "@/lib/punch/auto-close";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(header);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * GET /api/cron/auto-close — Vercel Cron volá GET-om (nedá sa
 * zmeniť na POST cez `vercel.json`) s `Authorization: Bearer <CRON_SECRET>`
 * pridaným automaticky. Bez správneho tajomstva 401 — inak by ktokoľvek
 * mohol hocikedy prepísať cudziu dochádzku na "auto-uzavretú".
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Neautorizované." }, { status: 401 });
  }

  const { closedCount } = await runAutoClose();
  return NextResponse.json({ closedCount });
}
