/** Bentuk state yang dikembalikan Server Action ke form melalui `useActionState`. */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Kode error mesin, untuk memilih langkah lanjutan di UI tanpa mencocokkan teks pesan. */
  code?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** Nilai yang dikirim ulang agar input tidak kosong setelah gagal validasi. Jangan isi password. */
  values?: Record<string, string>;
};

export const initialFormState: FormState = { status: "idle" };

/** Mengambil field teks dari FormData; nilai non-teks (mis. File) atau kosong menjadi string kosong. */
export function readTextFields<const Key extends string>(
  formData: FormData,
  keys: readonly Key[],
): Record<Key, string> {
  const entries = keys.map((key) => {
    const value = formData.get(key);
    return [key, typeof value === "string" ? value : ""] as const;
  });
  return Object.fromEntries(entries) as Record<Key, string>;
}
