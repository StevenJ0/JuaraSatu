// Menutup preorder dengan alasan, dicatat di domain_events (schema v2.1 §16.3).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicOrderSchema } from "@/features/orders/schemas";
import { createPrivateOrderToken, placePublicOrder } from "@/features/orders/service";
import { findPreorderCloseNote, findPublicPreorder } from "@/features/preorders/repository";
import { closePreorder } from "@/features/preorders/service";
import { anon, cleanupOwners, createOwner, createPublishedPreorder, service, sql, type Owner } from "./helpers";

const stamp = Date.now();
const PREFIX = "cls";
let A: Owner;
let B: Owner;

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
  B = await createOwner(PREFIX, "b", stamp);
});

afterAll(() => {
  sql(`begin; set local session_replication_role = replica;
    delete from public.domain_events where business_id in (select id from public.businesses where slug like '${PREFIX}-%-${stamp}');
    commit;`);
  cleanupOwners(PREFIX, stamp);
});

const versionOf = (id: string) => Number(sql(`select version from public.preorders where id = '${id}'`));
const statusOf = (id: string) => sql(`select status from public.preorders where id = '${id}'`);
const eventsOf = (id: string) => Number(sql(`select count(*) from public.domain_events where entity_id = '${id}'`));

describe("tutup preorder dengan alasan", () => {
  it("status dan catatan berubah bersama, alasan dirapikan", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    expect(await closePreorder(A.client, target.id, versionOf(target.id), "  Kuota produksi sudah cukup ")).toEqual({ kind: "done" });

    expect(statusOf(target.id)).toBe("closed");
    expect(sql(`select entity_type || '|' || event_type || '|' || actor_type || '|' || (actor_user_id = '${A.userId}') || '|' || (business_id = '${A.businessId}') from public.domain_events where entity_id = '${target.id}'`)).toBe("preorder|preorder_closed|owner|true|true");
    expect(await findPreorderCloseNote(A.client, A.businessId, target.id)).toMatchObject({ reason: "Kuota produksi sudah cukup" });
  });

  it.each([["kosong", ""], ["spasi", "   "], ["terlalu panjang", "x".repeat(501)]])("alasan %s ditolak tanpa mengubah apa pun", async (_label, reason) => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    expect(await closePreorder(A.client, target.id, versionOf(target.id), reason)).toEqual({ kind: "rejected", violation: "INPUT_INVALID" });
    expect(statusOf(target.id)).toBe("published");
    expect(eventsOf(target.id)).toBe(0);
  });

  it("tanpa parameter alasan sama sekali juga ditolak", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const { error } = await A.client.rpc("close_preorder", { p_preorder_id: target.id, p_expected_version: versionOf(target.id) });
    expect(error?.message).toContain("PREORDER_INPUT_INVALID");
    expect(statusOf(target.id)).toBe("published");
  });

  it("urutan pesan galat lama tetap: draf tetap NOT_PUBLISHED, tab lama tetap VERSION_CONFLICT", async () => {
    const draft = createPublishedPreorder(A, PREFIX, stamp, { status: "draft" });
    expect(await closePreorder(A.client, draft.id, versionOf(draft.id), "")).toEqual({ kind: "rejected", violation: "NOT_PUBLISHED" });
    const target = createPublishedPreorder(A, PREFIX, stamp);
    expect(await closePreorder(A.client, target.id, versionOf(target.id) + 1, "")).toEqual({ kind: "rejected", violation: "VERSION_CONFLICT" });
  });

  it("ditutup dua kali bersamaan: satu berhasil, satu catatan", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const current = versionOf(target.id);
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => closePreorder(A.client, target.id, current, `Alasan ${index}`)));
    expect(results.filter((result) => result.kind === "done").length).toBe(1);
    expect(eventsOf(target.id)).toBe(1);
  });

  it("setelah ditutup: pembeli melihat tutup, pesanan lama tetap ada", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const order = await placePublicOrder(service, publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `cls-key-${stamp}-abcdef`, privateToken: createPrivateOrderToken(), customerName: "P", customerEmail: "cls@example.com", customerContact: "", quantity: 1, expectedUnitPriceIdr: 120000 }), 900);
    expect(order.kind).toBe("ok");
    await closePreorder(A.client, target.id, versionOf(target.id), "Batas pesan dimajukan");
    expect(await findPublicPreorder(service, target.slug)).toMatchObject({ availability: "closed", orderableUnits: 0 });
    expect(sql(`select count(*) from public.orders where preorder_id = '${target.id}' and order_status = 'pending_payment'`)).toBe("1");
  });
});

describe("akses domain_events", () => {
  it("usaha lain tidak bisa menutup dan tidak bisa membaca catatannya", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    expect(await closePreorder(B.client, target.id, versionOf(target.id), "x")).toEqual({ kind: "rejected", violation: "NOT_FOUND" });
    await closePreorder(A.client, target.id, versionOf(target.id), "Rahasia usaha A");
    expect(await findPreorderCloseNote(B.client, B.businessId, target.id)).toBeNull();
    expect(await findPreorderCloseNote(B.client, A.businessId, target.id)).toBeNull();
    expect((await B.client.from("domain_events").select("id").eq("entity_id", target.id)).data).toEqual([]);
  });

  it("pemilik, tamu, dan server tidak bisa menulis atau mengubah langsung", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    await closePreorder(A.client, target.id, versionOf(target.id), "Catatan asli");
    const row = { business_id: A.businessId, entity_type: "preorder", entity_id: target.id, event_type: "preorder_closed", actor_type: "owner", safe_details_json: { reason: "palsu" } };
    expect((await A.client.from("domain_events").insert(row)).error).not.toBeNull();
    expect((await anon.from("domain_events").insert(row)).error).not.toBeNull();
    expect((await anon.from("domain_events").select("id")).error).not.toBeNull();
    expect((await A.client.from("domain_events").update({ safe_details_json: { reason: "diubah" } }).eq("entity_id", target.id)).error).not.toBeNull();
    expect((await service.from("domain_events").update({ safe_details_json: { reason: "diubah" } }).eq("entity_id", target.id)).error).not.toBeNull();
    expect((await service.from("domain_events").delete().eq("entity_id", target.id)).error).not.toBeNull();
    expect(await findPreorderCloseNote(A.client, A.businessId, target.id)).toMatchObject({ reason: "Catatan asli" });
    expect(eventsOf(target.id)).toBe(1);
  });

  it("server tidak bisa menutup preorder", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    expect((await service.rpc("close_preorder", { p_preorder_id: target.id, p_expected_version: 1, p_reason: "x" })).error).not.toBeNull();
    expect((await anon.rpc("close_preorder", { p_preorder_id: target.id, p_expected_version: 1, p_reason: "x" })).error).not.toBeNull();
    expect(statusOf(target.id)).toBe("published");
  });

  it("command key yang sama untuk entitas yang sama ditolak", () => {
    const entity = crypto.randomUUID();
    const insert = () => sql(`insert into public.domain_events (business_id, entity_type, entity_id, command_key, event_type, actor_type) values ('${A.businessId}', 'preorder', '${entity}', 'cmd-1', 'uji', 'system')`);
    insert();
    expect(insert).toThrow();
  });
});
