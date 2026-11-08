import "server-only";
import { z } from "zod";
import type { EmailMessage } from "@/features/paid-email/template";

/** Satu kirim. `idempotencyKey` sama untuk ulangan job yang sama, agar provider yang mendukungnya tidak mengirim dua kali. */
export type EmailSender = { send(message: EmailMessage, idempotencyKey: string): Promise<{ providerReference: string }> };

export class EmailSendError extends Error {
  constructor(readonly code: "EMAIL_PROVIDER_REJECTED" | "EMAIL_PROVIDER_UNAVAILABLE") {
    super(code);
    this.name = "EmailSendError";
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 10_000;

async function post(fetcher: Fetcher, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new EmailSendError("EMAIL_PROVIDER_UNAVAILABLE");
  }
  // 4xx berarti permintaan ditolak (alamat, domain, kunci). 5xx dan 429 boleh diulang.
  if (!response.ok) throw new EmailSendError(response.status >= 500 || response.status === 429 ? "EMAIL_PROVIDER_UNAVAILABLE" : "EMAIL_PROVIDER_REJECTED");
  try {
    return await response.json();
  } catch {
    throw new EmailSendError("EMAIL_PROVIDER_UNAVAILABLE");
  }
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email) lewat HTTP, tanpa dependency baru. */
export function createResendSender(apiKey: string, from: string, fetcher: Fetcher = fetch): EmailSender {
  return {
    async send(message, idempotencyKey) {
      const data = await post(fetcher, "https://api.resend.com/emails", { Authorization: `Bearer ${apiKey}`, "Idempotency-Key": idempotencyKey },
        { from, to: [message.to], subject: message.subject, text: message.text, html: message.html });
      const parsed = z.object({ id: z.string().min(1).max(128) }).safeParse(data);
      if (!parsed.success) throw new EmailSendError("EMAIL_PROVIDER_UNAVAILABLE");
      return { providerReference: parsed.data.id };
    },
  };
}

/** Mailpit milik Supabase lokal, hanya untuk pengembangan. Email tidak keluar dari laptop. */
export function createMailpitSender(baseUrl: string, from: string, fetcher: Fetcher = fetch): EmailSender {
  return {
    async send(message) {
      const data = await post(fetcher, new URL("/api/v1/send", baseUrl).href, {},
        { From: { Email: from }, To: [{ Email: message.to }], Subject: message.subject, Text: message.text, HTML: message.html });
      const parsed = z.object({ ID: z.string().min(1).max(128) }).safeParse(data);
      if (!parsed.success) throw new EmailSendError("EMAIL_PROVIDER_UNAVAILABLE");
      return { providerReference: parsed.data.ID };
    },
  };
}

const envSchema = z.discriminatedUnion("EMAIL_PROVIDER", [
  z.object({ EMAIL_PROVIDER: z.literal("resend"), RESEND_API_KEY: z.string().min(10), EMAIL_FROM: z.string().min(3).max(200) }),
  z.object({
    EMAIL_PROVIDER: z.literal("mailpit"),
    // Hanya alamat lokal, agar konfigurasi pengembangan tidak bisa mengirim ke server lain.
    MAILPIT_URL: z.string().regex(/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/).default("http://127.0.0.1:54324"),
    EMAIL_FROM: z.string().min(3).max(200).default("noreply@juarasatu.local"),
  }),
]);

/** Null bila provider email belum dipilih atau isinya salah. Job email lalu tetap mengantre, tidak hilang. */
export function loadEmailSender(source: Record<string, string | undefined> = process.env): EmailSender | null {
  const parsed = envSchema.safeParse({
    EMAIL_PROVIDER: source.EMAIL_PROVIDER,
    RESEND_API_KEY: source.RESEND_API_KEY,
    EMAIL_FROM: source.EMAIL_FROM || undefined,
    MAILPIT_URL: source.MAILPIT_URL || undefined,
  });
  if (!parsed.success) return null;
  return parsed.data.EMAIL_PROVIDER === "resend"
    ? createResendSender(parsed.data.RESEND_API_KEY, parsed.data.EMAIL_FROM)
    : createMailpitSender(parsed.data.MAILPIT_URL, parsed.data.EMAIL_FROM);
}
