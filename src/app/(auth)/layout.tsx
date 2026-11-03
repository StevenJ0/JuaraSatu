import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { getCurrentUserId } from "@/features/auth/session";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getCurrentUserId()) redirect("/dashboard");

  return <AuthShell>{children}</AuthShell>;
}
