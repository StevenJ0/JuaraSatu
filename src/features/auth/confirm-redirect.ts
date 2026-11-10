import { LOGIN_PATH } from "@/lib/supabase/proxy";

/** Tujuan setelah link verifikasi email dibuka. Tetap, bukan dari URL kiriman browser, agar tidak jadi open redirect. */
export function resolveConfirmRedirect(confirmed: boolean): string {
  return confirmed ? "/dashboard" : `${LOGIN_PATH}?notice=confirm_failed`;
}
