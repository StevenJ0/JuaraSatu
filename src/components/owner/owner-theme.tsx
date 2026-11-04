import type { ReactNode } from "react";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./owner-theme.css";

const ownerFont = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-owner" });
const ownerMonoFont = JetBrains_Mono({ subsets: ["latin"], variable: "--font-owner-mono" });

/** Pembungkus tema pemilik. Dipasang per layout agar landing dan halaman pembeli tidak ikut berubah. */
export function OwnerTheme({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`owner-theme ${ownerFont.variable} ${ownerMonoFont.variable} ${className}`}>{children}</div>;
}
