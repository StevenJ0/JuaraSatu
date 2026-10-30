import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/features/auth/session";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getCurrentUserId()) redirect("/dashboard");

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12 font-sans dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center text-lg font-bold text-zinc-900 dark:text-zinc-50">
          Campaign Lab
        </Link>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {children}
        </div>
      </div>
    </main>
  );
}
