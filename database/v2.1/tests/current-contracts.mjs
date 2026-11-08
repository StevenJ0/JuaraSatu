import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifySchemaColumns } from "./schema-contract.mjs";
import { verifyMigrationInventory, ACTIVE_MIGRATIONS } from "./migration-contract.mjs";
import { runConcurrency } from "./concurrency.mjs";

export async function verifyCurrentContracts(h) {
  const { sql, json, root } = h;
  const read=p=>readFileSync(resolve(root,p),"utf8");
  const business="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", foreign="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  const owner="SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';";
  const server="SET ROLE service_role; SET request.jwt.claim.role='service_role';";
  const invoke=expr=>json(`${server} SELECT ${expr};`);
  const reject=(query,pattern)=>assert.throws(()=>sql(query),pattern);
  let groups=0;
  const pass=t=>console.log(`PASS A4 ${++groups}: ${t}`);
  const catalog=json(read("database/v2.1/tests/catalog.sql"));
  assert.equal(catalog.tables.length,26);
  assert.ok(catalog.tables.every(t=>t.rls && !t.privileges.anon.select && !t.privileges.anon.insert && !t.privileges.anon.update && !t.privileges.anon.delete));
  assert.equal(catalog.columns.length,352);
  assert.ok(catalog.columns.some(c=>c.table==="businesses" && c.column==="categories" && c.type==="text[]" && !c.nullable));
  for(const fn of catalog.functions.filter(f=>f.definition.includes("SECURITY DEFINER"))) {
    assert.match(fn.definition,/SET search_path TO ''/); assert.equal(fn.privileges.anon,false,fn.name);
  }
  assert.equal(sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND pg_get_userbyid(p.proowner)<>'postgres';"),"0");
  const overloads=json("SELECT json_object_agg(proname,n) FROM (SELECT proname,count(*) n FROM pg_proc WHERE pronamespace='public'::regnamespace GROUP BY proname HAVING count(*)>1) f;");
  assert.deepEqual(overloads,{apply_verified_payment:2,claim_jobs:2,create_business_with_owner:2,publish_preorder:2});
  for(const signature of ["public.claim_jobs(text[],integer,integer)","public.claim_jobs(integer,integer,integer)",
    "public.publish_preorder(uuid,integer)","public.publish_preorder(uuid,uuid,integer,uuid)",
    "public.apply_verified_payment(text,text,text,text,text,bigint,timestamp with time zone)",
    "public.admit_ai_generation(uuid,uuid,uuid,text,text,text,text,uuid,uuid,integer,text,text,text,text,text,integer)"]) {
    assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NOT NULL;`),"t",signature);
  }
  pass("26 RLS tables/352 columns, categories, restricted definers, owners, exact four overload pairs and named RPC signatures");

  const grants=[
    ["businesses","UPDATE",["name","categories","description","public_contact","pickup_instructions"]],
    ["products","INSERT",["business_id","name","sku","description","photo_path","base_price_idr","variable_cost_idr","cost_quality","is_active"]],
    ["products","UPDATE",["name","sku","description","photo_path","base_price_idr","variable_cost_idr","cost_quality","is_active"]],
    ["production_capacity","INSERT",["business_id","product_id","fulfillment_date","total_units","intake_cutoff_at","fulfillment_window_end_at"]],
    ["production_capacity","UPDATE",["total_units","intake_cutoff_at","fulfillment_window_end_at"]],
  ];
  for(const [table,operation,allowed] of grants) {
    const columns=json(`SELECT json_agg(json_build_object('name',column_name,'allowed',has_column_privilege('authenticated','public.${table}',column_name,'${operation}'))) FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}';`);
    assert.deepEqual(columns.filter(c=>c.allowed).map(c=>c.name).sort(),allowed.slice().sort());
    assert.equal(sql(`SELECT has_table_privilege('authenticated','public.${table}','${operation}');`),"f");
  }
  assert.equal(sql(`${owner} SELECT count(*) FROM public.businesses;`),"1");
  reject(`${owner} UPDATE public.businesses SET is_demo=true WHERE id='${business}';`,/42501/);
  assert.equal(sql(`${owner} WITH changed AS (UPDATE public.businesses SET description='foreign attempt' WHERE id='${foreign}' RETURNING id) SELECT count(*) FROM changed;`),"0");
  sql(`BEGIN; ${owner} UPDATE public.businesses SET description='A4 allowed column' WHERE id='${business}'; ROLLBACK;`);
  pass("exact column INSERT/UPDATE grants, no table-wide owner writes; actual owner/foreign RLS and forbidden-column denial");

  const bucket=json("SELECT to_jsonb(b) FROM storage.buckets b WHERE id='product-photos';");
  assert.equal(bucket.public,true);assert.equal(bucket.file_size_limit,5242880);
  assert.deepEqual(bucket.allowed_mime_types,["image/jpeg","image/png","image/webp"]);
  const ownId=randomUUID(), foreignId=randomUUID();
  sql(`INSERT INTO storage.objects(id,bucket_id,name) VALUES('${foreignId}','product-photos','${foreign}/a4.webp');
    ${owner} INSERT INTO storage.objects(id,bucket_id,name) VALUES('${ownId}','product-photos','${business}/a4.webp');`);
  assert.equal(sql(`${owner} SELECT count(*) FROM storage.objects;`),"1");
  reject(`${owner} INSERT INTO storage.objects(bucket_id,name) VALUES('product-photos','${foreign}/forbidden.webp');`,/42501/);
  reject(`${owner} INSERT INTO storage.objects(bucket_id,name) VALUES('product-photos','not-a-business/image.webp');`,/42501/);
  assert.equal(sql(`${owner} WITH removed AS (DELETE FROM storage.objects WHERE id='${foreignId}' RETURNING id) SELECT count(*) FROM removed;`),"0");
  assert.equal(sql(`${owner} WITH removed AS (DELETE FROM storage.objects WHERE id='${ownId}' RETURNING id) SELECT count(*) FROM removed;`),"1");
  reject("SET ROLE anon; SELECT * FROM storage.objects;",/42501/);
  pass("Storage scaffold v1: bucket metadata and three actual owner policies evaluated under SQL roles, foreign/invalid paths denied; HTTP service not simulated");

  reject(`UPDATE public.businesses SET categories=ARRAY['Fashion','fashion'] WHERE id='${business}';`,/23514/);
  const triggers=catalog.triggers.map(t=>t.name);
  for(const name of ["preorder_guard","preorder_item_guard","capacity_guard","capacity_commitment_guard","reservation_guard","business_category_sync"]) assert.ok(triggers.includes(name),name);
  for(const table of ["orders","order_items","capacity_reservations","payments","payment_events","campaign_memories","job_runs"]) {
    assert.ok(catalog.constraints.some(c=>c.table===table && c.kind==="f"),table);
    assert.ok(catalog.constraints.some(c=>c.table===table && c.kind==="c"),table);
  }
  assert.ok(catalog.indexes.some(i=>i.indexname==="preorders_one_published" && i.indexdef.includes("UNIQUE")));
  assert.ok(catalog.extensions.some(e=>e.name==="vector" && e.schema==="extensions"));
  assert.ok(catalog.extensions.some(e=>e.name==="pgtap" && e.schema==="extensions"));
  pass("category constraint, FK/CHECK families, publication/capacity/reservation triggers, published-date uniqueness and vector/pgTAP extensions");

  const product=randomUUID(),capacity=randomUUID(),preorder=randomUUID(),item=randomUUID(),slug=`a4-${preorder}`;
  sql(`INSERT INTO public.products(id,business_id,name,sku,base_price_idr,variable_cost_idr,cost_quality) VALUES('${product}','${business}','A4 synthetic','${product}',120000,75000,'verified');
    INSERT INTO public.production_capacity(id,business_id,product_id,fulfillment_date,total_units,intake_cutoff_at,fulfillment_window_end_at)
      VALUES('${capacity}','${business}','${product}',current_date+900,10,now()+interval '5 days',now()+interval '901 days');
    INSERT INTO public.preorders(id,business_id,name,slug,status,fulfillment_date,starts_at,ends_at)
      VALUES('${preorder}','${business}','A4 synthetic','${slug}','draft',current_date+900,now()-interval '1 hour',now()+interval '4 days');
    INSERT INTO public.preorder_items(id,business_id,preorder_id,product_id,capacity_id,target_units,quota_units,base_price_snapshot_idr,product_name_snapshot,sku_snapshot)
      VALUES('${item}','${business}','${preorder}','${product}','${capacity}',2,10,120000,'A4 synthetic','${product}');
    ${owner} SELECT public.publish_preorder('${preorder}',1);`);
  const hash=randomUUID().replaceAll("-","").repeat(2),key=randomUUID();
  const orderExpr=(keyValue=key,price=120000)=>`public.create_preorder_order('${slug}',2,'A4 synthetic','a4@example.invalid',NULL,'${hash}','${keyValue}','${hash}',${price},900,NULL)`;
  const order=invoke(orderExpr());assert.equal(order.total_idr,240000);assert.equal(order.replayed,false);
  assert.equal(invoke(orderExpr()).order_id,order.order_id);assert.equal(invoke(orderExpr()).replayed,true);
  reject(`${server} SELECT ${orderExpr(randomUUID(),1)};`,/OFFER_CHANGED/);
  assert.equal(sql(`SELECT count(*) FROM public.orders WHERE preorder_id='${preorder}';`),"1");
  const attempt=invoke(`public.claim_payment_attempt('${hash}')`);assert.equal(attempt.amount_idr,240000);
  const event=randomUUID();
  const payment=`public.apply_verified_payment('${attempt.provider_order_id}','${event}','${hash}','settlement','A4-SYNTHETIC-NO-PROVIDER',240000,now())`;
  const applied=invoke(payment);assert.equal(applied.outcome,"applied");
  assert.equal(invoke(payment).outcome,"duplicate");
  assert.equal(sql(`SELECT count(*) FROM public.payment_events WHERE payment_id='${attempt.payment_id}' AND provider_event_key='${event}';`),"1");
  assert.equal(sql(`SELECT count(*) FROM public.job_runs WHERE entity_id='${order.order_id}' AND job_type='send_paid_email';`),"1");
  assert.equal(sql(`SELECT state FROM public.capacity_reservations WHERE order_id='${order.order_id}';`),"allocated");
  assert.equal(sql(`SELECT order_status FROM public.orders WHERE id='${order.order_id}';`),"awaiting_confirmation");
  pass("real core SQL persistence only: server-priced order, idempotent replay, hold→allocation, synthetic payment event dedupe and one durable email job; no callback/provider/delivery");

  await runConcurrency(sql,h.connection);
  pass("existing current-schema concurrency: last capacity slot, generation replay/stale version and distinct typed worker claims");

  reject("BEGIN; CREATE TABLE public.a4_rollback_probe(id integer); SELECT 1/0; COMMIT;",/22012/);
  assert.equal(sql("SELECT to_regclass('public.a4_rollback_probe') IS NULL;"),"t");
  for(const files of [ACTIVE_MIGRATIONS.slice(1),[...ACTIVE_MIGRATIONS,"99999999999999_unreviewed.sql"]]) assert.throws(()=>verifyMigrationInventory(files));
  pass("SQL error propagates and transaction rolls back DDL; missing or unreviewed migrations fail the inventory gate");

  const docs=read("docs/schema.md"), compared=verifySchemaColumns(docs,catalog.columns), drift=compared.filter(c=>c.classification!=="MATCH");
  const directory=resolve(root,"node_modules/.cache/database-v21",h.runId);mkdirSync(directory,{recursive:true});
  const inventory=h.applied.map(file=>({file,sha256:createHash("sha256").update(read(`supabase/migrations/${file}`)).digest("hex"),status:"APPLIED",transaction:"explicit or harness wrapper"}));
  writeFileSync(resolve(directory,"catalog.json"),JSON.stringify(catalog,null,2));
  writeFileSync(resolve(directory,"schema-comparison.json"),JSON.stringify({source:"docs/schema.md",execution:"PASS",schema:drift.length ? "DRIFT" : "MATCH",compared,drift},null,2));
  console.log(`SCHEMA COMPARATOR: execution PASS; ${compared.length-drift.length} MATCH; ${JSON.stringify(drift)}; strict comparison ${drift.length ? "FAIL (PM13)" : "PASS"}`);
  assert.deepEqual(drift,[],"Schema documentation differs from the active migration chain");
  assert.ok(verifySchemaColumns(docs,[...catalog.columns,{table:"businesses",column:"a4_unexpected",type:"text",nullable:true}]).some(c=>c.name==="businesses.a4_unexpected" && c.classification==="EXTRA"));
  assert.ok(verifySchemaColumns(docs,catalog.columns.filter(c=>!(c.table==="businesses" && c.column==="name"))).some(c=>c.name==="businesses.name" && c.classification==="MISSING"));
  assert.ok(verifySchemaColumns(docs,catalog.columns.map(c=>c.table==="businesses" && c.column==="name" ? {...c,type:"integer"}:c)).some(c=>c.name==="businesses.name" && c.classification==="MISMATCH"));
  assert.ok(verifySchemaColumns(docs,catalog.columns.map(c=>c.table==="businesses" && c.column==="name" ? {...c,nullable:true}:c)).some(c=>c.name==="businesses.name" && c.classification==="MISMATCH"));
  assert.ok(verifySchemaColumns(docs,catalog.columns.map(c=>c.table==="businesses" && c.column==="id" ? {...c,default:null}:c)).some(c=>c.name==="businesses.id" && c.classification==="MISMATCH"));
  pass("strict comparator matches all columns and detects EXTRA/MISSING/type/nullability/default mismatches");
  const summary={runId:h.runId,container:h.container,layer1:"PASS",layer2:"NOT EXECUTED",groups,comparator:"PASS",docs:"MATCH",drift,
    migrations:inventory,checkpoint:{through:"20261104092000",assertions:100,assertion65:"PASS",memoryLegacyGroups:7},durationMs:Date.now()-h.started};
  writeFileSync(resolve(directory,"summary.json"),JSON.stringify(summary,null,2));
  writeFileSync(resolve(root,"node_modules/.cache/database-v21/latest.json"),JSON.stringify({directory},null,2));
  console.log(`ARTIFACT ${directory}`);
  return summary;
}
