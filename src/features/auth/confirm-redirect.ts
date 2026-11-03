import { LOGIN_PATH } from "@/lib/supabase/proxy";

export const RECOVERY_FAILED_URL = "/forgot-password?notice=recovery_failed";

/** Tujuan setelah link email dibuka. Ditentukan dari tipe link, bukan dari URL kiriman browser, agar tidak jadi open redirect. */
export function resolveConfirmRedirect(type: string | null, confirmed: boolean): string {
  if (type === "recovery") return confirmed ? "/reset-password" : RECOVERY_FAILED_URL;
  return confirmed ? "/dashboard" : `${LOGIN_PATH}?notice=confirm_failed`;
}
