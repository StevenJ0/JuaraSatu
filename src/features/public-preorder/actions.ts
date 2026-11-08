"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { OrderRepositoryError, type OrderViolation } from "@/features/orders/repository";
import { placePublicOrder } from "@/features/orders/service";
import { clientAddress, takeLimit } from "@/features/public-preorder/rate-limit.server";
import { CHECKOUT_FIELDS, checkoutFormSchema, type CheckoutField } from "@/features/public-preorder/schemas";
import { readTextFields } from "@/lib/form-state";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export type CheckoutResult =
  | { status: "ok" }
  | { status: "rejected"; code: OrderViolation | "FAILED" | "RATE_LIMITED"; message: string; fieldErrors?: Partial<Record<CheckoutField, string[]>> };

const FAILED_MESSAGE = "Pesanan belum terkirim. Coba kirim lagi, pesananmu tidak akan tercatat dua kali.";

const VIOLATION_MESSAGES: Record<OrderViolation, string> = {
  VALIDATION_ERROR: "Isian belum valid. Periksa lagi lalu kirim.",
  ORDER_NOT_FOUND: "Preorder ini tidak ditemukan. Periksa kembali tautannya.",
  VERSION_CONFLICT: FAILED_MESSAGE,
  ORDER_STATE_INVALID: FAILED_MESSAGE,
  PREORDER_NOT_OPEN: "Preorder ini sedang tidak menerima pesanan.",
  CAPACITY_UNAVAILABLE: "Sisa kuota tidak cukup untuk jumlah ini. Kurangi jumlahnya atau muat ulang halaman.",
  OFFER_CHANGED: "Harga baru saja berubah. Periksa harga terbaru di halaman ini, lalu kirim lagi.",
  IDEMPOTENCY_CONFLICT: "Form ini sudah dipakai untuk pesanan sebelumnya dengan isian berbeda.",
  SCHEDULE_CLOSED: "Preorder ini sedang tidak menerima pesanan.",
  PRODUCT_INACTIVE: "Preorder ini sedang tidak menerima pesanan.",
  REFUND_NOTE_REQUIRED: FAILED_MESSAGE,
};

/**
 * Checkout pembeli tanpa akun (FR-ORD-01..03). Harga, total, usaha, dan status ditentukan database. Token privat dan kunci
 * idempotensi dibuat browser sebelum kirim, sehingga kirim ulang setelah respons hilang mendapat pesanan yang sama.
 */
export async function placeBuyerOrderAction(formData: FormData): Promise<CheckoutResult> {
  const parsed = checkoutFormSchema.safeParse(readTextFields(formData, CHECKOUT_FIELDS));
  if (!parsed.success) {
    return { status: "rejected", code: "VALIDATION_ERROR", message: VIOLATION_MESSAGES.VALIDATION_ERROR, fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    const client = createSupabaseServiceRoleClient();
    // Dicek sebelum pesanan dibuat, karena setiap pesanan menahan slot sampai tenggat bayar.
    if ((await takeLimit(client, "checkout", clientAddress(await headers()))) === "limited") {
      return { status: "rejected", code: "RATE_LIMITED", message: "Terlalu banyak pesanan dari jaringan ini. Coba lagi beberapa menit lagi." };
    }
    const outcome = await placePublicOrder(client, parsed.data);
    if (outcome.kind === "rejected") return { status: "rejected", code: outcome.violation, message: VIOLATION_MESSAGES[outcome.violation] };
    return { status: "ok" };
  } catch (error) {
    // Hanya kode galat. Nama, email, kontak, dan token pembeli tidak boleh masuk log.
    console.error("[checkout] placePublicOrder gagal", { code: error instanceof OrderRepositoryError ? error.code : undefined });
    return { status: "rejected", code: "FAILED", message: FAILED_MESSAGE };
  }
}
