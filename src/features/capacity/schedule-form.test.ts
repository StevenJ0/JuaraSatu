import { describe, expect, it } from "vitest";
import { combineWindowEnd, describeCapacitySchedule, suggestCapacitySchedule } from "@/features/capacity/schedule-form";

describe("combineWindowEnd", () => {
  it("menggabungkan tanggal dan jam", () => {
    expect(combineWindowEnd("2026-11-14", "17:00")).toBe("2026-11-14T17:00");
  });
});

describe("suggestCapacitySchedule", () => {
  const now = new Date("2026-11-04T03:00:00Z");

  it("menyarankan batas pesan malam sebelum tanggal pengambilan", () => {
    expect(suggestCapacitySchedule("2026-11-14", now)).toEqual({ intakeCutoff: "2026-11-13T20:00", endTime: "17:00" });
  });

  it("melewati pergantian bulan", () => {
    expect(suggestCapacitySchedule("2026-12-01", now).intakeCutoff).toBe("2026-11-30T20:00");
  });

  it("mengosongkan batas pesan yang sudah lewat", () => {
    expect(suggestCapacitySchedule("2026-11-04", now)).toEqual({ intakeCutoff: "", endTime: "17:00" });
  });

  it("tetap menyarankan bila batas pesan masih nanti malam", () => {
    expect(suggestCapacitySchedule("2026-11-05", now).intakeCutoff).toBe("2026-11-04T20:00");
  });

  it("tanggal kosong tidak menghasilkan batas pesan", () => {
    expect(suggestCapacitySchedule("", now)).toEqual({ intakeCutoff: "", endTime: "17:00" });
  });
});

describe("describeCapacitySchedule", () => {
  it("merangkum jadwal dalam satu kalimat", () => {
    expect(describeCapacitySchedule("2026-11-14", "2026-11-13T20:00", "17:00")).toBe(
      "Pembeli bisa memesan sampai 13 Nov 2026, 20.00 WIB, lalu mengambil pesanan pada Sabtu, 14 Nov paling lambat pukul 17.00 WIB.",
    );
  });

  it.each([
    ["", "2026-11-13T20:00", "17:00"],
    ["2026-11-14", "", "17:00"],
    ["2026-11-14", "2026-11-13T20:00", ""],
  ])("kosong bila isian belum lengkap: %j %j %j", (date, cutoff, time) => {
    expect(describeCapacitySchedule(date, cutoff, time)).toBeNull();
  });
});
