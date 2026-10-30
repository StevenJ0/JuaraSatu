import Link from "next/link";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Ringkasan" },
  { href: "/dashboard/business", label: "Profil Usaha" },
] as const;

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const business = await getCurrentBusinessProfile();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">
              Campaign Lab
            </p>
            <p className="truncate font-semibold text-zinc-900 dark:text-zinc-50">{business.name}</p>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {item.label}
              </Link>
            ))}
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
