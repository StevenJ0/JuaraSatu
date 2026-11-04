// Cukup untuk batas 10.000 unit; angka di atasnya tetap bisa diketik agar server memberi pesan yang jelas.
const MAX_DIGITS = 5;

/** Isian jumlah unit hanya berisi angka. Nol di depan dibuang, tapi "0" sendiri tetap boleh. */
export function sanitizeUnitsInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.slice(0, MAX_DIGITS);
}
