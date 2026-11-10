"use client";

import { CalendarDays, ChevronDown, ClipboardList, LayoutDashboard, Package, ReceiptText, Store, Megaphone } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/dashboard/preorders", label: "Preorder", icon: ClipboardList },
  { href: "/dashboard/campaigns", label: "Campaign AI", icon: Megaphone },
  { href: "/dashboard/orders", label: "Pesanan", icon: ReceiptText },
  { href: "/dashboard/products", label: "Produk", icon: Package },
  { href: "/dashboard/capacity", label: "Kapasitas", icon: CalendarDays },
  { href: "/dashboard/business", label: "Profil", icon: Store },
] as const;
/** Di HP hanya baris pertama yang tampil: menu sebanyak ini ditambah tombol "Lainnya". */
const MOBILE_VISIBLE_COUNT = 3;

const TILE_CLASS =
  "flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-[10px] py-1.5 text-[11px] transition-colors max-[359px]:text-[10px] max-[359px]:tracking-tight sm:text-sm lg:flex-row lg:gap-1.5 lg:px-2.5";

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function tileState(active: boolean): string {
  return active ? "bg-[var(--owner-highlight)] font-semibold text-brand" : "font-medium text-muted hover:bg-subtle hover:text-ink";
}

/**
 * HP: satu baris berisi tiga menu dan tombol "Lainnya" yang membuka baris kedua ke bawah (mendorong isi halaman).
 * Baris kedua tertutup lagi saat pindah halaman atau menekan Esc. Layar sedang ke atas: semua menu langsung tampil.
 */
export function OwnerNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  // Menyimpan halaman tempat baris kedua dibuka, sehingga pindah halaman otomatis menutupnya.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const isOpen = openedAt === pathname;
  const hiddenActive = !isOpen && NAV_ITEMS.slice(MOBILE_VISIBLE_COUNT).some((item) => isActive(pathname, item.href));

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedAt(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  return (
    <nav aria-label="Menu utama" className={className}>
      <ul className="grid grid-cols-4 sm:grid-cols-7 lg:flex lg:gap-1">
        {NAV_ITEMS.map(({ href, label, icon: NavIcon }, index) => {
          const active = isActive(pathname, href);
          return (
            <Fragment key={href}>
              <li className={index >= MOBILE_VISIBLE_COUNT && !isOpen ? "hidden sm:block" : undefined}>
                <Link href={href} aria-current={active ? "page" : undefined} className={`${TILE_CLASS} ${tileState(active)}`}>
                  <NavIcon aria-hidden size={18} strokeWidth={1.5} className="shrink-0" />
                  {label}
                </Link>
              </li>
              {index === MOBILE_VISIBLE_COUNT - 1 && (
                <li className="sm:hidden">
                  {/* Disorot bila halaman aktif ada di baris yang tertutup, agar posisi pengguna tetap terlihat. */}
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenedAt(isOpen ? null : pathname)}
                    className={`${TILE_CLASS} text-[11px]! ${hiddenActive ? "font-semibold!" : "font-medium!"} ${tileState(hiddenActive)}`}
                  >
                    <ChevronDown aria-hidden size={18} strokeWidth={1.5} className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    {isOpen ? "Tutup" : "Lainnya"}
                  </button>
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
