"use client";

import { CalendarDays, LayoutDashboard, Package, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/dashboard/products", label: "Produk", icon: Package },
  { href: "/dashboard/capacity", label: "Kapasitas", icon: CalendarDays },
  { href: "/dashboard/business", label: "Profil", icon: Store },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OwnerNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Menu utama" className={className}>
      <ul className="grid grid-cols-4 gap-1 md:flex">
        {NAV_ITEMS.map(({ href, label, icon: NavIcon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-[10px] px-1 py-1.5 text-sm transition-colors md:flex-row md:gap-2 md:px-3 ${
                  active
                    ? "bg-[var(--owner-highlight)] font-semibold text-brand"
                    : "font-medium text-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                <NavIcon aria-hidden size={18} strokeWidth={1.5} className="shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
