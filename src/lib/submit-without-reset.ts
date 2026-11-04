import { startTransition, type FormEvent } from "react";

/**
 * Lewat `<form action>` saja, React mereset form setelah action selesai: dropdown kembali ke opsi awal dan file yang
 * dipilih hilang, walau server menolak isian lain. Dipasang di `onSubmit` agar isian bertahan saat gagal validasi.
 */
export function submitWithoutReset(action: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  };
}
