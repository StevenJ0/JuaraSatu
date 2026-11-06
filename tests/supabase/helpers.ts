// Pembantu uji integrasi ke Supabase lokal sungguhan. Semua data uji berawalan khusus dan dibersihkan.
//
// Secara bawaan memakai `.env.local`. Isi TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_KEY, dan TEST_DB_CONTAINER
// untuk memakai stack terpisah. Uji berhenti bila alamatnya bukan lokal, jadi tidak bisa menyentuh Supabase Cloud.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function readEnvFile(): Record<string, string> {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variabel ${name} belum ada, uji integrasi dihentikan`);
  return value;
}

const env = readEnvFile();
export const url = required("URL Supabase", process.env.TEST_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL);
export const anonKey = required("anon key", process.env.TEST_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const serviceKey = required("service key", process.env.TEST_SUPABASE_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY);
const container = process.env.TEST_DB_CONTAINER ?? "supabase_db_GTNIC_Lomba";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) throw new Error("Bukan Supabase lokal, uji integrasi dihentikan");

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
export const service = createClient(url, serviceKey, clientOptions);
export const anon = createClient(url, anonKey, clientOptions);

export function sql(query: string): string {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-q"], {
    input: query,
    stdio: ["pipe", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export type Owner = { businessId: string; productId: string; client: SupabaseClient; userId: string };

/** Akun, usaha, dan satu produk sungguhan. `prefix` dipakai untuk membersihkan datanya. */
export async function createOwner(prefix: string, label: string, stamp: number, product: { cost?: number | null; price?: number } = {}): Promise<Owner> {
  const email = `${prefix}-check-${label}-${stamp}@example.com`;
  const password = "IntegrationCheck-Lokal-12345";
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const businessId = sql(`insert into public.businesses (name, slug, categories, description, public_contact, pickup_instructions)
    values ('Usaha ${label}', '${prefix}-${label}-${stamp}', array['Fashion'], 'Deskripsi ${label}', '0812-${label}', 'Ambil di toko ${label}') returning id`);
  sql(`insert into public.business_members (business_id, user_id) values ('${businessId}', '${data.user.id}')`);
  const cost = product.cost === undefined ? 75000 : product.cost;
  const quality = cost === null ? "unknown" : "estimated";
  const productId = sql(`insert into public.products (business_id, name, sku, description, photo_path, base_price_idr, variable_cost_idr, cost_quality)
    values ('${businessId}', 'Kaos ${label}', 'SKU${prefix}${stamp}${label}', 'Kaos katun', '${businessId}/foto.webp', ${product.price ?? 120000}, ${cost ?? "null"}, '${quality}') returning id`);
  const client = createClient(url, anonKey, clientOptions);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);
  return { businessId, productId, client, userId: data.user.id };
}

export type PreorderFixture = { id: string; itemId: string; slug: string; capacityId: string; date: string; owner: Owner };

let dayOffset = 400 + Math.floor(Math.random() * 2000);
let slugCount = 0;

export function createCapacity(owner: Owner, units: number): { capacityId: string; date: string } {
  dayOffset += 1;
  const date = new Date(Date.now() + dayOffset * 86400e3).toISOString().slice(0, 10);
  const capacityId = sql(`insert into public.production_capacity (business_id, product_id, fulfillment_date, total_units, intake_cutoff_at, fulfillment_window_end_at)
    values ('${owner.businessId}', '${owner.productId}', '${date}', ${units}, now() + interval '6 days', '${date} 17:00+07') returning id`);
  return { capacityId, date };
}

/** Kolom hash di schema wajib SHA-256 hex, jadi data uji memakai hash sungguhan. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Trigger baseline menolak preorder terbit tanpa item, jadi fixture dibuat draf dulu lalu statusnya diubah, seperti aplikasi. */
export function publishFixture(preorderId: string, status: string) {
  if (status === "draft") return;
  const publishedAt = status === "cancelled" ? "published_at" : "now()";
  sql(`update public.preorders set status = '${status}', published_at = ${publishedAt} where id = '${preorderId}'`);
}

export function createPublishedPreorder(
  owner: Owner,
  prefix: string,
  stamp: number,
  { quota = 40, capacity = 40, status = "published", capacityId, date }: { quota?: number; capacity?: number; status?: string; capacityId?: string; date?: string } = {},
): PreorderFixture {
  const schedule = capacityId && date ? { capacityId, date } : createCapacity(owner, capacity);
  slugCount += 1;
  const slug = `${prefix}-${stamp}-${slugCount}`;
  const terms = status === "draft"
    ? "null"
    : `jsonb_build_object('pickup_instructions', 'Ambil beku', 'public_contact', '0812-beku', 'intake_cutoff_at', now() + interval '6 days', 'fulfillment_window_end_at', '${schedule.date} 17:00+07'::timestamptz)`;
  const id = sql(`insert into public.preorders (business_id, name, slug, status, fulfillment_date, starts_at, ends_at, published_at, pickup_terms_snapshot)
    values ('${owner.businessId}', 'Preorder ${slugCount}', '${slug}', 'draft', '${schedule.date}', now() - interval '1 day', now() + interval '5 days', null, ${terms}) returning id`);
  const itemId = sql(`insert into public.preorder_items (business_id, preorder_id, product_id, capacity_id, target_units, quota_units, base_price_snapshot_idr, product_name_snapshot, sku_snapshot)
    values ('${owner.businessId}', '${id}', '${owner.productId}', '${schedule.capacityId}', ${Math.min(quota, 10)}, ${quota}, (select base_price_idr from public.products where id = '${owner.productId}'), 'Kaos beku', 'SKU-BEKU') returning id`);
  publishFixture(id, status);
  return { id, itemId, slug, capacityId: schedule.capacityId, date: schedule.date, owner };
}

/** Membersihkan semua data berawalan `prefix` dan `stamp`. Trigger dimatikan sementara karena riwayat bersifat append-only. */
export function cleanupOwners(prefix: string, stamp: number): void {
  sql(`begin;
    create temp table doomed on commit drop as select id from public.businesses where slug like '${prefix}-%-${stamp}';
    set local session_replication_role = replica;
    delete from public.domain_events where business_id in (select id from doomed);
    delete from public.job_runs where business_id in (select id from doomed);
    delete from public.payment_events where business_id in (select id from doomed);
    delete from public.payments where business_id in (select id from doomed);
    delete from public.order_production_costs where business_id in (select id from doomed);
    delete from public.capacity_reservations where business_id in (select id from doomed);
    delete from public.order_events where business_id in (select id from doomed);
    delete from public.order_items where business_id in (select id from doomed);
    delete from public.orders where business_id in (select id from doomed);
    delete from public.campaigns where business_id in (select id from doomed);
    delete from public.preorder_items where business_id in (select id from doomed);
    delete from public.preorders where business_id in (select id from doomed);
    delete from public.production_capacity where business_id in (select id from doomed);
    delete from public.products where business_id in (select id from doomed);
    delete from public.business_members where business_id in (select id from doomed);
    delete from public.businesses where id in (select id from doomed);
    delete from auth.users where email like '${prefix}-check-%-${stamp}@example.com';
    commit;`);
}
