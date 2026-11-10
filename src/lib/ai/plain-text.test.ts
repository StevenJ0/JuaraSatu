import { describe, expect, it } from "vitest";
import { plainText } from "./plain-text";

describe("plainText", () => {
  it("removes bold, italic, headings, links and code but keeps the words", () => {
    expect(plainText("## Rencana\n**Konten nilai** dan *urgensi* lewat [tautan](https://contoh.id) `preorder`"))
      .toBe("Rencana\nKonten nilai dan urgensi lewat tautan preorder");
  });

  it("turns bullets into dots, keeps numbered lists and line breaks, and drops rules", () => {
    expect(plainText("Langkah:\n- Story Instagram\n* Pesan WhatsApp\n\n---\n\n\n1. Cek slot")).toBe("Langkah:\n• Story Instagram\n• Pesan WhatsApp\n\n1. Cek slot");
  });

  it("leaves hashtags, snake_case words, prices and plain sentences untouched", () => {
    const caption = "Porsi besar, dimasak hari itu. Harga Rp25.000 sampai 6 Nov.\n#AyamJuicy #preorder_tembalang";
    expect(plainText(caption)).toBe(caption);
    expect(plainText("Diskon 5 * 2 hari")).toBe("Diskon 5 * 2 hari");
  });
});
