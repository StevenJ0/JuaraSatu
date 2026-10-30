import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";

export const LOGIN_PATH = "/login";

const PROTECTED_PREFIXES = ["/dashboard"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Menyegarkan session Supabase di setiap request dan mengarahkan user tanpa session dari halaman terlindungi.
 * Ini hanya pemeriksaan awal; otorisasi sesungguhnya (kepemilikan business) tetap dicek di server.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims memvalidasi JWT; jangan sisipkan logic lain sebelum pemanggilan ini agar refresh token tidak hilang.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);

  if (!isAuthenticated && isProtectedPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.search = "";
    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return response;
}
