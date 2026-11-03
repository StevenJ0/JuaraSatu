// `businesses.timezone` selalu Asia/Jakarta di MVP dan WIB tidak punya DST, sehingga offset-nya tetap.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const WIB_TIME_ZONE = "Asia/Jakarta";
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: WIB_TIME_ZONE,
});
const DATE_ONLY_FORMAT = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Nilai `datetime-local` (YYYY-MM-DDTHH:mm, WIB) untuk instant tersebut. */
export function toWibDateTimeInput(instant: string): string {
  return new Date(Date.parse(instant) + WIB_OFFSET_MS).toISOString().slice(0, 16);
}

/** Mengubah nilai `datetime-local` WIB menjadi ISO UTC; tanggal yang tidak ada di kalender (31 Feb) ditolak. */
export function parseWibDateTime(local: string): string | null {
  if (!LOCAL_DATE_TIME_PATTERN.test(local)) return null;
  const instant = new Date(`${local}:00+07:00`);
  if (Number.isNaN(instant.getTime())) return null;
  const iso = instant.toISOString();
  return toWibDateTimeInput(iso) === local ? iso : null;
}

export function isValidDateOnly(value: string): boolean {
  return DATE_ONLY_PATTERN.test(value) && parseWibDateTime(`${value}T00:00`) !== null;
}

/** Tanggal kalender WIB dari sebuah instant. */
export function wibDateOf(instant: string): string {
  return toWibDateTimeInput(instant).slice(0, 10);
}

export function formatWibDateTime(instant: string): string {
  return `${DATE_TIME_FORMAT.format(new Date(instant))} WIB`;
}

/** Kolom `date` tidak punya zona waktu, jadi diformat sebagai UTC agar harinya tidak bergeser. */
export function formatDateOnly(date: string): string {
  return DATE_ONLY_FORMAT.format(new Date(`${date}T00:00:00Z`));
}
