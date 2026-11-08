/**
 * Niat checkout per tab (PRD §Token): token privat 32 byte dan kunci idempotensi dibuat browser sebelum kirim, lalu disimpan di
 * sessionStorage. Kirim ulang setelah respons hilang memakai pasangan yang sama, jadi database mengembalikan pesanan yang sama.
 */
export type CheckoutIntent = { token: string; idempotencyKey: string };

const TOKEN_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createCheckoutIntent(): CheckoutIntent {
  return { token: toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))), idempotencyKey: crypto.randomUUID() };
}

function isIntent(value: unknown): value is CheckoutIntent {
  if (typeof value !== "object" || value === null) return false;
  const token = "token" in value ? value.token : undefined;
  const key = "idempotencyKey" in value ? value.idempotencyKey : undefined;
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) && typeof key === "string" && key.length >= 16 && key.length <= 128;
}

// sessionStorage bisa tidak tersedia (mode privat, diblokir). Tanpa itu checkout tetap jalan, hanya tidak bertahan saat tab dimuat ulang.
function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Diabaikan, lihat catatan di atas.
  }
}

const intentKey = (slug: string) => `checkout-intent:${slug}`;
const refKey = (slug: string) => `checkout-ref:${slug}`;
const lastOrderKey = (slug: string) => `checkout-last-order:${slug}`;

export function loadCheckoutIntent(slug: string): CheckoutIntent {
  const stored = read(intentKey(slug));
  if (stored !== null) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (isIntent(parsed)) return parsed;
    } catch {
      // Isi rusak diganti niat baru.
    }
  }
  const intent = createCheckoutIntent();
  write(intentKey(slug), JSON.stringify(intent));
  return intent;
}

/** Setelah pesanan tercatat, niat dibuang agar pesanan berikutnya di tab yang sama tidak dianggap kirim ulang. */
export function finishCheckoutIntent(slug: string, token: string): CheckoutIntent {
  write(lastOrderKey(slug), token);
  const next = createCheckoutIntent();
  write(intentKey(slug), JSON.stringify(next));
  return next;
}

export function loadLastOrderToken(slug: string): string | null {
  const token = read(lastOrderKey(slug));
  return token !== null && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** Tautan kampanye hanya berlaku untuk tab ini (PRD §Attribution). Server tetap memeriksa keabsahannya saat pesanan dibuat. */
export function rememberAttributionRef(slug: string, ref: string | null): string | null {
  if (ref !== null && /^[a-z0-9-]{1,200}$/.test(ref)) {
    write(refKey(slug), ref);
    return ref;
  }
  return read(refKey(slug));
}
