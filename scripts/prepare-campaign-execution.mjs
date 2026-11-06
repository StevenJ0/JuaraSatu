// Add isolated, future-valid synthetic data; never reset or rewrite historical preorders/blueprints.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const db = "supabase_db_campaign-lab";
const docker = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const labels = JSON.parse(docker(["inspect", db, "--format", "{{json .Config.Labels}}"]));
assert.equal(labels["com.supabase.cli.project"], "campaign-lab");
assert.equal(resolve(labels["com.supabase.cli.workdir"]).toLowerCase(), resolve(".").toLowerCase());
const sql = (input) => docker(["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], input);
const evaluation = process.argv.includes("--evaluation");
const memory = process.argv.includes("--memory");
const discussion = process.argv.includes("--discussion");
const ownerArgument = process.argv.find(arg=>arg.startsWith('--owner-a-user-id='));
const ownerA = (ownerArgument?.slice('--owner-a-user-id='.length) ?? '11111111-1111-4111-8111-111111111111').toLowerCase();
assert.match(ownerA,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
assert.notEqual(ownerA,'22222222-2222-4222-8222-222222222222');
assert.ok([memory,evaluation,discussion].filter(Boolean).length<=1,"Select one fixture namespace");
const label = discussion ? "Slice 4 regression" : memory ? "Slice 8" : evaluation ? "Slice 7" : "Slice 6"; const skuPrefix = discussion ? "S4" : memory ? "S8" : evaluation ? "S7" : "S6";
const cache = discussion ? "node_modules/.cache/campaign-discussion" : memory ? "node_modules/.cache/business-memory" : evaluation ? "node_modules/.cache/campaign-evaluation" : "node_modules/.cache/campaign-execution";
const manifest = `${cache}/${evaluation || memory || discussion ? "preorders" : "scenarios"}.json`;
if (existsSync(manifest)) {
  const prior = JSON.parse(readFileSync(manifest, "utf8"));
  assert.ok(Array.isArray(prior) && prior.length === 2 && prior.every((s) => /^[a-f0-9-]{36}$/.test(s.preorderId)));
  const rows = JSON.parse(sql(`SELECT coalesce(json_agg(p),'[]'::json) FROM (SELECT id,status,ends_at>clock_timestamp()+interval '2 days' AS usable FROM public.preorders WHERE id IN (${prior.map((s) => `'${s.preorderId}'`).join(",")})) p;`));
  if (prior[0].ownerUserId===ownerA && prior[1].ownerUserId==='22222222-2222-4222-8222-222222222222' && rows?.length === 2 && rows.every((row) => row.status === "published" && row.usable)) { console.log(`PASS existing isolated ${label} fixtures remain valid; history unchanged`); process.exit(0); }
}
const scenarios = [];
for (const [letter, owner] of [["a", ownerA], ["b", "22222222-2222-4222-8222-222222222222"]]) {
  const businessId = letter === "a" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  assert.equal(sql(`SELECT count(*) FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id WHERE b.id='${businessId}' AND b.is_demo AND m.user_id='${owner}' AND m.role='owner';`), "1");
  // Cache may be stale after TRUNCATE or absent; recover an existing usable namespace before appending data.
  const reusable=JSON.parse(sql(`SELECT coalesce(json_agg(f),'[]'::json) FROM (
    SELECT b.id AS "businessId",m.user_id AS "ownerUserId",p.id AS "productId",cap.id AS "capacityId",po.id AS "preorderId",i.id AS "itemId",po.fulfillment_date AS "fulfillmentDate"
    FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id JOIN public.preorders po ON po.business_id=b.id
    JOIN public.preorder_items i ON i.preorder_id=po.id AND i.business_id=b.id JOIN public.products p ON p.id=i.product_id AND p.business_id=b.id
    JOIN public.production_capacity cap ON cap.id=i.capacity_id AND cap.business_id=b.id AND cap.product_id=p.id
    WHERE b.id='${businessId}' AND b.is_demo AND m.user_id='${owner}' AND m.role='owner' AND p.sku LIKE '${skuPrefix}-%'
      AND po.status='published' AND po.starts_at<clock_timestamp() AND po.ends_at>clock_timestamp()+interval '2 days' AND po.ends_at<=cap.intake_cutoff_at
      AND i.target_units=40 AND i.quota_units=40 AND i.base_price_snapshot_idr=120000 AND cap.total_units=40 AND po.fulfillment_date=cap.fulfillment_date
      AND NOT EXISTS(SELECT 1 FROM public.orders WHERE preorder_id=po.id)
      AND NOT EXISTS(SELECT 1 FROM public.capacity_reservations WHERE preorder_item_id=i.id)
    ORDER BY po.created_at DESC,po.id LIMIT 1) f;`));
  if(reusable.length){scenarios.push(reusable[0]);continue;}
  const id = { businessId, ownerUserId: owner, productId: randomUUID(), capacityId: randomUUID(), preorderId: randomUUID(), itemId: randomUUID() };
  const date = sql(`SELECT d::date FROM generate_series(((clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date+9)::timestamp,((clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date+39)::timestamp,interval '1 day') d WHERE NOT EXISTS(SELECT 1 FROM public.preorders WHERE business_id='${businessId}' AND fulfillment_date=d::date AND status='published') ORDER BY d LIMIT 1;`);
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  sql(`BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role';
    INSERT INTO public.products(id,business_id,name,sku,base_price_idr,variable_cost_idr,cost_quality) VALUES
     ('${id.productId}','${businessId}','Paket ${label} sintetis ${letter.toUpperCase()}','${skuPrefix}-${id.productId}',120000,${letter === "a" ? "75000,'verified'" : "NULL,'unknown'"});
    INSERT INTO public.production_capacity(id,business_id,product_id,fulfillment_date,total_units,intake_cutoff_at,fulfillment_window_end_at) VALUES
     ('${id.capacityId}','${businessId}','${id.productId}','${date}',40,clock_timestamp()+interval '7 days','${date}T18:00:00+07:00');
    INSERT INTO public.preorders(id,business_id,name,slug,status,fulfillment_date,starts_at,ends_at) VALUES
     ('${id.preorderId}','${businessId}','${label} sintetis ${letter.toUpperCase()}','${discussion ? "slice4" : memory ? "slice8" : evaluation ? "slice7" : "slice6"}-${id.preorderId}','draft','${date}',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '6 days');
    INSERT INTO public.preorder_items(id,business_id,preorder_id,product_id,capacity_id,target_units,quota_units,base_price_snapshot_idr,product_name_snapshot,sku_snapshot) VALUES
     ('${id.itemId}','${businessId}','${id.preorderId}','${id.productId}','${id.capacityId}',40,40,120000,'Paket ${label} sintetis ${letter.toUpperCase()}','${skuPrefix}-${id.productId}');
    SELECT public.publish_preorder('${businessId}','${id.preorderId}',1,'${owner}'); COMMIT;`);
  scenarios.push({ ...id, fulfillmentDate: date });
}
mkdirSync(cache, { recursive: true }); writeFileSync(manifest, JSON.stringify(scenarios, null, 2));
console.log(`PASS two isolated ${label} scenarios ready; six-day window, no orders/payments, old records preserved`);
