import { Brand } from "@/components/brand";
import { OwnerNav } from "@/components/owner/owner-nav";
import { OwnerTheme } from "@/components/owner/owner-theme";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const business = await getCurrentBusinessProfile();

  return (
    <OwnerTheme className="flex flex-col">
      {business.isDemo && (
        <p className="border-b border-dashed border-[var(--owner-sim-border)] bg-[var(--owner-sim-bg)] px-4 py-1 text-center text-sm text-[color:var(--owner-sim-fg)]">
          Data sintetis untuk demonstrasi.
        </p>
      )}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 lg:py-3">
          <Brand href="/dashboard" />
          <OwnerNav className="order-last w-full lg:order-none lg:w-auto" />
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {/* Di layar lebar menu satu baris dengan logo, jadi nama usaha disembunyikan agar tetap muat. Nama tetap ada di Ringkasan. */}
            <p className="hidden max-w-48 truncate text-sm font-medium text-ink sm:block lg:hidden">{business.name}</p>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </OwnerTheme>
  );
}
