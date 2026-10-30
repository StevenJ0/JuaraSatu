"use client";

import { useEffect, useRef } from "react";
import { landingNavigation } from "@/config/site";
import styles from "./landing.module.css";

/** Native disclosure works without hydration; JavaScript adds Escape/outside close. */
export function MobileNavigation() {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) {
        if (menu.current) menu.current.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  function closeMenu() {
    if (menu.current) menu.current.open = false;
  }

  return (
    <details className={styles.mobileMenu} ref={menu} onKeyDown={(event) => {
      if (event.key === "Escape") {
        closeMenu();
        menu.current?.querySelector("summary")?.focus();
      }
    }}>
      <summary aria-label="Menu navigasi">
        <span>Menu</span>
        <span className={styles.menuGlyph} aria-hidden="true"><i /><i /></span>
      </summary>
      <nav aria-label="Navigasi ponsel">
        {landingNavigation.map((item) => (
          <a key={item.href} href={item.href} onClick={closeMenu}>{item.label}</a>
        ))}
        <a href="#contoh-penggunaan" onClick={closeMenu}>Lihat contoh alur</a>
      </nav>
    </details>
  );
}
