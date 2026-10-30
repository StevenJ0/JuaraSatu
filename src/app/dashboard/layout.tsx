import Link from "next/link";
import { Brand } from "@/components/brand";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Ringkasan" },
  { href: "/dashboard/business", label: "Profil Usaha" },
] as const;

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const business = await getCurrentBusinessProfile();

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <Brand href="/dashboard" />
            <p className="truncate border-l border-line pl-4 text-sm font-semibold text-ink">{business.name}</p>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-subtle"
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
