"use client";

export default function SimulatorError({ retry }: { retry: () => void }) {
  return <main lang="id" className="p-6">
    <h1 className="text-2xl font-semibold">Preview belum dapat dimuat</h1>
    <p role="alert" className="my-4">Terjadi kendala saat memuat simulator. Coba muat ulang preview.</p>
    <button type="button" onClick={retry} className="min-h-12 cursor-pointer rounded-lg border px-4 focus-visible:outline-2 focus-visible:outline-offset-4">Coba lagi</button>
  </main>;
}
