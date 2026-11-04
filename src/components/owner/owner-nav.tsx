"use client";

import { CalendarDays, ClipboardList, LayoutDashboard, Package, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/dashboard/preorders", label: "Preorder", icon: ClipboardList },
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
      <ul className="grid grid-cols-5 lg:flex lg:gap-1">
        {NAV_ITEMS.map(({ href, label, icon: NavIcon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-[10px] py-1.5 text-xs transition-colors max-[359px]:text-[11px] sm:text-sm lg:flex-row lg:gap-2 lg:px-3 ${
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
