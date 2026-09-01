import { redirect } from "next/navigation";
import { getLandingPath } from "@/lib/auth/landing";
import { requireUser } from "@/lib/auth/session";

export default async function Home() {
  const user = await requireUser();
  redirect(getLandingPath(user.role));
}
