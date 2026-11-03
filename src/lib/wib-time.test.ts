import { describe, expect, it } from "vitest";
import {
  formatDateOnly,
  formatWibDateTime,
  isValidDateOnly,
  parseWibDateTime,
  toWibDateTimeInput,
  wibDateOf,
} from "@/lib/wib-time";

describe("parseWibDateTime", () => {
  it("mengubah WIB menjadi UTC", () => {
    expect(parseWibDateTime("2026-11-07T17:00")).toBe("2026-11-07T10:00:00.000Z");
  });

  it("menangani waktu yang mundur ke hari sebelumnya di UTC", () => {
    expect(parseWibDateTime("2026-11-07T03:00")).toBe("2026-11-06T20:00:00.000Z");
  });

  it.each(["2026-02-31T10:00", "2026-13-01T10:00", "2026-11-07T25:00", "2026-11-07", "besok", ""])(
    "menolak %j",
    (value) => {
      expect(parseWibDateTime(value)).toBeNull();
    },
  );
});

describe("toWibDateTimeInput", () => {
  it("bolak-balik tanpa bergeser, termasuk format timestamptz dari database", () => {
    expect(toWibDateTimeInput("2026-11-07T10:00:00+00:00")).toBe("2026-11-07T17:00");
  });
});

describe("wibDateOf", () => {
  it("memakai tanggal WIB, bukan tanggal UTC", () => {
    expect(wibDateOf("2026-11-06T20:00:00Z")).toBe("2026-11-07");
  });
});

describe("isValidDateOnly", () => {
  it("menolak tanggal yang tidak ada di kalender", () => {
    expect(isValidDateOnly("2026-11-07")).toBe(true);
    expect(isValidDateOnly("2026-02-31")).toBe(false);
    expect(isValidDateOnly("07-11-2026")).toBe(false);
  });
});

describe("format tampilan", () => {
  it("menampilkan jam WIB", () => {
    expect(formatWibDateTime("2026-11-07T07:30:00Z")).toBe("7 Nov 2026, 14.30 WIB");
  });

  it("hari tidak bergeser untuk kolom date", () => {
    expect(formatDateOnly("2026-11-07")).toBe("Sabtu, 7 Nov");
  });
});
