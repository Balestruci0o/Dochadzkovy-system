"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyEmailOtp } from "@/lib/auth/email-otp";
import { getSupabaseSessionId } from "@/lib/auth/mfa";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/shared/client-ip";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StepUpState = { error?: string };

export async function verifyStepUpAction(
  _prevState: StepUpState,
  formData: FormData,
): Promise<StepUpState> {
  const user = await requireUser();
  const code = String(formData.get("code") ?? "").trim();
  const next = String(formData.get("next") ?? "/");

  if (!code) {
    return { error: "Zadaj overovací kód." };
  }

  const supabase = await createSupabaseServerClient();
  const sessionId = await getSupabaseSessionId(supabase);
  if (!sessionId) {
    return { error: "Session sa nepodarila overiť, prihlás sa znova." };
  }

  const ip = getClientIp(await headers());
  const result = await verifyEmailOtp({ userId: user.id, sessionId, code, ip });
  if (!result.ok) return { error: result.error };

  redirect(next || "/");
}
