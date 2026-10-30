import { describe, expect, it } from "vitest";
import { isProtectedPath } from "@/lib/supabase/proxy";

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/dashboard/products", "/dashboard/orders/123", "/onboarding"])("melindungi %s", (pathname) => {
    expect(isProtectedPath(pathname)).toBe(true);
  });

  it.each(["/", "/login", "/c/brownies-sabtu", "/dashboardx"])("tidak melindungi %s", (pathname) => {
    expect(isProtectedPath(pathname)).toBe(false);
  });
});
