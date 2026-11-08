/** PRD v2.1 §14: pure field validation, without database or provider effects. */
export const INPUT_LIMITS = Object.freeze({
  customerNameMax: 120,
  emailMax: 254,
  quantityMin: 1,
  quantityMax: 10_000,
  moneyMaxIdr: 1_000_000_000,
  discountMaxBps: 9_999,
  preorderSlugMin: 3,
  preorderSlugMax: 160,
});

export type ValidationReason =
  | "required"
  | "type"
  | "length"
  | "format"
  | "range"
  | "unsafe_characters";

/** Internal helper result; not an HTTP response or an authorization decision. */
export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issue: { code: "VALIDATION_ERROR"; reason: ValidationReason; message: string } };

// Reject control/format characters before trim, including CRLF and bidi controls.
const unsafeText = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// WHATWG HTML single email syntax; not mailbox existence/deliverability validation.
// https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address
const emailPattern = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function invalid(reason: ValidationReason, message: string): ValidationResult<never> {
  return { success: false, issue: { code: "VALIDATION_ERROR", reason, message } };
}

function requiredText(value: unknown): ValidationResult<string> {
  if (value === null || value === undefined) return invalid("required", "Nilai wajib diisi.");
  if (typeof value !== "string") return invalid("type", "Nilai harus berupa teks.");
  if (unsafeText.test(value)) return invalid("unsafe_characters", "Teks mengandung karakter kontrol yang tidak diizinkan.");
  const trimmed = value.trim();
  if (!trimmed) return invalid("required", "Nilai wajib diisi.");
  return { success: true, value: trimmed };
}

function boundedInteger(value: unknown, min: number, max: number, message: string): ValidationResult<number> {
  if (typeof value !== "number") return invalid("type", "Nilai harus berupa angka, tanpa konversi otomatis.");
  if (!Number.isSafeInteger(value) || value < min || value > max) return invalid("range", message);
  return { success: true, value };
}

export function validateCustomerName(value: unknown): ValidationResult<string> {
  const result = requiredText(value);
  if (!result.success) return result;
  if ([...result.value].length > INPUT_LIMITS.customerNameMax) return invalid("length", "Nama maksimal 120 karakter.");
  return result;
}

/** Required only for public checkout; manual-order optionality belongs to its use case. */
export function validateCustomerEmail(value: unknown): ValidationResult<string> {
  const result = requiredText(value);
  if (!result.success) return result;
  if (result.value.length > INPUT_LIMITS.emailMax) return invalid("length", "Email maksimal 254 karakter.");
  if (!emailPattern.test(result.value)) return invalid("format", "Format email tidak valid.");
  // Preserve local-part case; this validator does not establish identity/hash policy.
  return result;
}

export function validateQuantity(value: unknown): ValidationResult<number> {
  return boundedInteger(value, INPUT_LIMITS.quantityMin, INPUT_LIMITS.quantityMax, "Jumlah harus bilangan bulat 1–10.000.");
}

/** Zero is valid for known zero costs. Missing/unknown costs must remain distinct. */
export function validateMoneyIdr(value: unknown): ValidationResult<number> {
  return boundedInteger(value, 0, INPUT_LIMITS.moneyMaxIdr, "Nilai rupiah harus bilangan bulat 0–1.000.000.000.");
}

export function validatePositiveMoneyIdr(value: unknown): ValidationResult<number> {
  return boundedInteger(value, 1, INPUT_LIMITS.moneyMaxIdr, "Harga harus bilangan bulat 1–1.000.000.000 rupiah.");
}

/** Shape only; known cost/positive contribution checks belong to the business service. */
export function validateDiscountBps(value: unknown): ValidationResult<number> {
  return boundedInteger(value, 0, INPUT_LIMITS.discountMaxBps, "Diskon harus bilangan bulat 0–9.999 bps.");
}

/** Preorder/campaign maximum; do not reuse for the shorter business slug column. */
export function validatePreorderSlug(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") return invalid("type", "Slug harus berupa teks.");
  if (value.length < INPUT_LIMITS.preorderSlugMin || value.length > INPUT_LIMITS.preorderSlugMax) {
    return invalid("length", "Slug harus sepanjang 3–160 karakter.");
  }
  if (unsafeText.test(value) || !/^[a-z0-9-]+$/.test(value)) {
    return invalid("format", "Slug hanya memakai huruf kecil, angka, dan tanda hubung tanpa spasi.");
  }
  return { success: true, value };
}
