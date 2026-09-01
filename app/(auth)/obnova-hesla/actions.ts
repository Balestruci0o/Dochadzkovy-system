"use server";

import { passwordResetEmailHtml } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ResetRequestState = { submitted?: boolean; error?: string };

export async function requestPasswordResetAction(
  _prevState: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    return { error: "Zadaj email." };
  }

  const admin = createSupabaseAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/nastavit-heslo`;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  // Zámerne nerozlišujeme v odpovedi, či email v systéme existuje —
  // inak by formulár prezradil, ktoré emaily sú zaregistrované.
  if (!error && data?.properties?.action_link) {
    await sendEmail({
      to: email,
      subject: "Obnova hesla — dochádzkový systém",
      html: passwordResetEmailHtml({ link: data.properties.action_link }),
    });
  }

  return { submitted: true };
}
