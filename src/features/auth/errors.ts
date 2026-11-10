const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email atau password salah.",
  email_not_confirmed: "Email belum diverifikasi. Buka link verifikasi yang dikirim ke email Anda, atau kirim ulang di bawah.",
  weak_password: "Password terlalu lemah. Gunakan kombinasi yang lebih kuat.",
  over_email_send_rate_limit: "Terlalu banyak email dikirim. Coba lagi beberapa saat lagi.",
  over_request_rate_limit: "Terlalu banyak percobaan. Coba lagi beberapa saat lagi.",
  signup_disabled: "Pendaftaran akun sedang dinonaktifkan.",
};

const FALLBACK_MESSAGE = "Terjadi kesalahan pada layanan autentikasi. Coba lagi.";

/** Pesan aman untuk user; tidak meneruskan pesan mentah provider. */
export function toAuthErrorMessage(code: string | undefined): string {
  return (code && AUTH_ERROR_MESSAGES[code]) || FALLBACK_MESSAGE;
}
