const IDR_FORMAT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** `bigint` untuk total lintas pesanan yang bisa melewati batas aman Number. */
export function formatIdr(value: number | bigint): string {
  return `Rp${IDR_FORMAT.format(value)}`;
}

/** Format saat mengetik: hanya digit yang dipakai, kosong tetap kosong agar tidak terbaca Rp0. */
export function formatIdrInput(raw: string, maxDigits = 10): string {
  const digits = raw.replace(/\D/g, "").slice(0, maxDigits);
  return digits === "" ? "" : formatIdr(Number(digits));
}
