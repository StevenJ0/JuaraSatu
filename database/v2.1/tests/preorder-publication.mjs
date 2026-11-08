import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

// Only the networkless disposable A1/A2 harness calls this module with --a3.
export async function runPreorderPublication(h) {
  const { sql, json, connection, waitFor, functions } = h;
  const owner=randomUUID(), foreign=randomUUID(), business=randomUUID(), otherBusiness=randomUUID();
  const pickup="Ambil di Gerai Melati — pintu timur.\nSabtu, 10.00–15.00 WIB; bawa bukti pesanan ☕.";
  const lit=v=>`'${v.replaceAll("'","''")}'`;
  const auth=(id=owner)=>`SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${id}';`;
  const server="SET ROLE service_role; SET request.jwt.claim.role='service_role';";
  let sequence=0, groups=0, races=0;
  const pass=t=>console.log(`PASS A3 ${++groups}: ${t}`);
  sql(`INSERT INTO auth.users(id,email) VALUES('${owner}','${owner}@example.invalid'),('${foreign}','${foreign}@example.invalid');
    INSERT INTO public.businesses(id,name,slug,category,pickup_instructions,public_contact,is_demo) VALUES
    ('${business}','A3 disposable','${business}','Fashion',${lit(pickup)},NULL,true),
    ('${otherBusiness}','A3 foreign','${otherBusiness}','Fashion','Foreign pickup',NULL,true);
    INSERT INTO public.business_members(business_id,user_id) VALUES('${business}','${owner}'),('${otherBusiness}','${foreign}');`);

  function fixture(options={}) {
    const f={ id:randomUUID(),item:randomUUID(),product:randomUUID(),capacity:randomUUID(),businessId:business,
      price:120123,quota:5,total:10,...options };
    f.slug=`a3-${f.id}`;
    f.date=f.date ?? sql(`SELECT (current_date+${100+ ++sequence})::text;`);
    sql(`INSERT INTO public.products(id,business_id,name,sku,base_price_idr,variable_cost_idr,cost_quality)
      VALUES('${f.product}','${business}','Paket Melati ☕','${f.product}',${f.price},NULL,'unknown');
      INSERT INTO public.production_capacity(id,business_id,product_id,fulfillment_date,total_units,intake_cutoff_at,fulfillment_window_end_at)
      VALUES('${f.capacity}','${business}','${f.product}','${f.date}',${f.total},now()+interval '5 days','${f.date} 18:00+07');
      INSERT INTO public.preorders(id,business_id,name,slug,status,fulfillment_date,starts_at,ends_at)
      VALUES('${f.id}','${business}','A3 preorder','${f.slug}','draft','${f.date}',now()-interval '1 hour',now()+interval '4 days');
      INSERT INTO public.preorder_items(id,business_id,preorder_id,product_id,capacity_id,target_units,quota_units,base_price_snapshot_idr,product_name_snapshot,sku_snapshot)
      VALUES('${f.item}','${business}','${f.id}','${f.product}','${f.capacity}',1,${f.quota},1,'Draft fact','Draft SKU');`);
    return f;
  }
  const version=f=>Number(sql(`SELECT version FROM public.preorders WHERE id='${f.id}';`));
  const expr=(f,path="core",v=version(f),actor=owner,bid=business)=>path==="core"
    ? `public.publish_preorder('${f.id}',${v})` : `public.publish_preorder('${bid}','${f.id}',${v},${actor ? `'${actor}'` : "NULL"})`;
  const publish=(f,path="core",v=version(f),context=auth())=>path==="core"
    ? sql(`${context} SELECT ${expr(f,path,v)};`) : json(`${context} SELECT to_jsonb(${expr(f,path,v)});`);
  const state=f=>json(`SELECT json_build_object('preorder',to_jsonb(p),'item',to_jsonb(i),'capacity',to_jsonb(c))
    FROM public.preorders p JOIN public.preorder_items i ON i.preorder_id=p.id JOIN public.production_capacity c ON c.id=i.capacity_id WHERE p.id='${f.id}';`);
  const reject=(f,query,pattern)=>{const before=state(f);assert.throws(()=>sql(query),pattern);assert.deepEqual(state(f),before);};
  function evidence(f) {
    const row=json(`SELECT to_jsonb(p)||jsonb_build_object('businesses',to_jsonb(b),'preorder_items',jsonb_build_array(
      to_jsonb(i)||jsonb_build_object('products',to_jsonb(prod),'production_capacity',to_jsonb(c)||jsonb_build_object('capacity_reservations','[]'::jsonb))))
      FROM public.preorders p JOIN public.businesses b ON b.id=p.business_id JOIN public.preorder_items i ON i.preorder_id=p.id
      JOIN public.products prod ON prod.id=i.product_id JOIN public.production_capacity c ON c.id=i.capacity_id WHERE p.id='${f.id}';`);
    return { row,offer:json(`SELECT public.read_preorder_offer('${f.id}');`),id:f.id,businessId:business,slug:f.slug,price:f.price,
      pickup,contact:row.pickup_terms_snapshot?.public_contact ?? null };
  }
  function check(f) {
    const s=state(f), terms=s.preorder.pickup_terms_snapshot;
    assert.deepEqual(Object.keys(terms).sort(),["fulfillment_window_end_at","intake_cutoff_at","pickup_instructions","public_contact"]);
    assert.equal(terms.pickup_instructions,pickup); assert.equal(typeof terms.intake_cutoff_at,"string");
    assert.equal(Date.parse(terms.intake_cutoff_at),Date.parse(s.capacity.intake_cutoff_at));
    assert.equal(Date.parse(terms.fulfillment_window_end_at),Date.parse(s.capacity.fulfillment_window_end_at));
    assert.equal(s.preorder.status,"published"); assert.ok(s.preorder.published_at);
    assert.equal(s.item.base_price_snapshot_idr,f.price); assert.equal(s.item.product_name_snapshot,"Paket Melati ☕");
    assert.equal(s.item.sku_snapshot,f.product); assert.equal(s.capacity.total_units,f.total);
    return s;
  }
  function reserve(f,quantity,state="allocated",expiry="1 hour") {
    const order=randomUUID(), item=randomUUID(), amount=quantity*f.price;
    sql(`BEGIN; INSERT INTO public.orders(id,business_id,public_order_number,source,customer_name,fulfillment_date,payment_mode,order_status,fulfillment_status,subtotal_idr,discount_total_idr,total_idr)
      VALUES('${order}','${business}','${order}','manual','A3 synthetic','${f.date}','external_manual','awaiting_confirmation','pending_confirmation',${amount},0,${amount});
      INSERT INTO public.order_items(id,business_id,order_id,product_id,product_name_snapshot,sku_snapshot,quantity,base_unit_price_idr,discount_bps_snapshot,discount_per_unit_idr,final_unit_price_idr,variable_cost_per_unit_idr,cost_quality_snapshot,line_total_idr)
      VALUES('${item}','${business}','${order}','${f.product}','Synthetic','${f.product}',${quantity},${f.price},0,0,${f.price},NULL,'unknown',${amount});
      INSERT INTO public.capacity_reservations(business_id,order_id,order_item_id,capacity_id,quantity,state,expires_at)
      VALUES('${business}','${order}','${item}','${f.capacity}',${quantity},'${state}',${state==="held" ? `now()+interval '${expiry}'` : "NULL"}); COMMIT;`);
  }

  const old=fixture(); publish(old,"legacy");
  assert.deepEqual(state(old).preorder.pickup_terms_snapshot,{pickupInstructions:pickup});
  const before=evidence(old);
  console.log("REPRODUCED before A3: legacy saved published row has pickupInstructions only; real core parser rejection checked below");
  const bypass=fixture(); reserve(bypass,6); publish(bypass,"legacy");
  assert.equal(state(bypass).preorder.status,"published");
  console.log("REPRODUCED before A3: legacy publication bypasses remaining-commitment quota check");

  const prior=functions(); sql(h.migrationSql); const after=functions();
  assert.equal(after.length,prior.length+1);
  for(const p of prior) {
    const a=after.find(f=>f.id===p.id); assert.ok(a);
    if(p.name==="publish_preorder") { assert.notEqual(a.body,p.body); assert.deepEqual({...a,body:p.body},p); }
    else assert.deepEqual(a,p);
  }
  const helper=after.find(f=>f.name==="publish_preorder_canonical");
  assert.ok(helper); assert.equal(helper.definer,false); assert.deepEqual(helper.config,['search_path=""']);
  pass("13 migrations; only two public publish bodies replaced and one private primitive added; old owner/ACL/security/return contracts preserved");
  assert.deepEqual(state(old).preorder.pickup_terms_snapshot,{pickupInstructions:pickup});
  pass("migration leaves pre-existing legacy published row unchanged; no speculative backfill");

  if (h.afterMigration) await h.afterMigration();

  const accepted=[];
  for(const [path,context] of [["core",auth()],["legacy",auth()],["legacy",server]]) {
    const f=fixture(), capacity=state(f).capacity;
    const returned=path==="legacy" && context!==server
      ? json(`${context} SELECT to_jsonb(public.publish_preorder('${business}','${f.id}',1));`)
      : publish(f,path,1,context);
    check(f); assert.deepEqual(state(f).capacity,capacity);
    if(path==="legacy") assert.deepEqual(returned,state(f).preorder);
    accepted.push(evidence(f));
    reject(f,`${context} SELECT ${expr(f,path,1)};`,/PREORDER_VERSION_CONFLICT/);
    reject(f,`${context} SELECT ${expr(f,path)};`,/PREORDER_NOT_DRAFT/);
    pass(`${path}/${context===server ? "trusted service actor" : "authenticated owner"}: canonical snapshot, frozen price, unchanged capacity and explicit duplicate refusal`);
  }

  sql(`UPDATE public.businesses SET public_contact='Hubungi gerai: 0812-TEST' WHERE id='${business}';`);
  const contact=fixture(); publish(contact); check(contact); accepted.push(evidence(contact));
  assert.equal(state(contact).preorder.pickup_terms_snapshot.public_contact,"Hubungi gerai: 0812-TEST");
  const frozen=state(contact);
  sql(`UPDATE public.products SET name='Nama baru',sku='${randomUUID()}',base_price_idr=999999,variable_cost_idr=0,cost_quality='verified' WHERE id='${contact.product}';
    UPDATE public.businesses SET pickup_instructions='Profil baru',public_contact=NULL WHERE id='${business}';`);
  assert.deepEqual(state(contact),frozen);
  reject(contact,`UPDATE public.preorders SET pickup_terms_snapshot='{}' WHERE id='${contact.id}';`,/FROZEN_PREORDER/);
  reject(contact,`UPDATE public.preorder_items SET base_price_snapshot_idr=2 WHERE id='${contact.item}';`,/FROZEN_PREORDER_SNAPSHOT/);
  reject(contact,`UPDATE public.production_capacity SET intake_cutoff_at=intake_cutoff_at+interval '1 hour' WHERE id='${contact.capacity}';`,/CAPACITY_SCHEDULE_FROZEN/);
  sql(`UPDATE public.businesses SET pickup_instructions=${lit(pickup)} WHERE id='${business}';`);
  pass("Unicode/punctuation/newline and NULL/non-NULL contact preserved; product/profile edits never rewrite frozen terms/price; existing freeze guards remain");

  for(const path of ["core","legacy"]) {
    for(const stateName of ["closed","completed","cancelled"]) {
      const f=fixture();sql(`UPDATE public.preorders SET status='${stateName}' WHERE id='${f.id}';`);
      reject(f,`${auth()} SELECT ${expr(f,path)};`,/PREORDER_NOT_DRAFT/);
    }
    const f=fixture();
    for(const invalid of ["NULL",0,999]) reject(f,`${auth()} SELECT ${expr(f,path,invalid)};`,/PREORDER_VERSION_CONFLICT/);
    sql(`UPDATE public.products SET is_active=false WHERE id='${f.product}';`);
    reject(f,`${auth()} SELECT ${expr(f,path)};`,/PREORDER_PRODUCT_INACTIVE/);
    const ended=fixture();sql(`UPDATE public.preorders SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id='${ended.id}';`);
    reject(ended,`${auth()} SELECT ${expr(ended,path)};`,/PREORDER_SCHEDULE_INVALID/);
  }
  pass("both entry points reject stale/NULL/zero versions, inactive product, elapsed schedule and non-draft lifecycle without partial mutation");

  const empty=fixture();
  const noItem={id:randomUUID()};
  sql(`INSERT INTO public.preorders(id,business_id,name,slug,status,fulfillment_date,starts_at,ends_at)
    VALUES('${noItem.id}','${business}','No item','${randomUUID()}','draft',current_date+700,now(),now()+interval '1 day');`);
  for(const path of ["core","legacy"]) reject(empty,`${auth()} SELECT ${expr(noItem,path,1)};`,/PREORDER_INPUT_INVALID/);
  assert.equal(sql(`SELECT status='draft' AND pickup_terms_snapshot IS NULL FROM public.preorders WHERE id='${noItem.id}';`),"t");
  reject(empty,`${auth(foreign)} SELECT ${expr(empty)};`,/PREORDER_NOT_FOUND/);
  reject(empty,`${auth(foreign)} SELECT ${expr(empty,"legacy")};`,/42501[\s\S]*FORBIDDEN/);
  reject(empty,`${auth()} SELECT ${expr(empty,"legacy",1,foreign)};`,/42501[\s\S]*FORBIDDEN/);
  for(const actor of [null,foreign]) reject(empty,`${server} SELECT ${expr(empty,"legacy",1,actor)};`,/42501[\s\S]*FORBIDDEN/);
  reject(empty,`${auth()} SELECT ${expr(empty,"legacy",1,owner,otherBusiness)};`,/42501[\s\S]*FORBIDDEN/);
  for(const role of ["anon","authenticated"]) {
    if(role==="anon") for(const path of ["core","legacy"]) reject(empty,`SET ROLE anon; SELECT ${expr(empty,path)};`,/42501[\s\S]*permission denied/);
    for(const path of ["core","legacy"]) reject(empty,`SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub=''; SELECT ${expr(empty,path)};`,/42501/);
  }
  reject(empty,`${server} SELECT ${expr(empty)};`,/42501[\s\S]*permission denied/);
  const missing=randomUUID();
  for(const path of ["core","legacy"]) reject(empty,`${auth(missing)} SELECT ${expr(empty,path)};`,/42501/);
  for(const role of ["anon","authenticated","service_role"]) {
    assert.equal(sql(`SELECT has_function_privilege('${role}','private.publish_preorder_canonical(uuid,uuid,integer)','EXECUTE');`),"f");
    reject(empty,`SET ROLE ${role}; SELECT private.publish_preorder_canonical('${business}','${empty.id}',1);`,/42501/);
  }
  pass("owner/business/actor isolation: foreign, spoofed actor, no session/member, anon, bare service core and private helper calls all denied");

  for(const path of ["core","legacy"]) {
    for(const reservation of ["allocated","held"]) {
      const f=fixture();reserve(f,6,reservation);
      reject(f,`${auth()} SELECT ${expr(f,path)};`,/PREORDER_QUOTA_OVER_CAPACITY/);
    }
    const boundary=fixture();reserve(boundary,5);publish(boundary,path);check(boundary);
    const expired=fixture();reserve(expired,6,"held","-1 second");publish(expired,path);check(expired);
  }
  pass("allocated/live-held commitment shortage denied on both paths; exact remaining-capacity boundary and expired-held exclusion succeed");

  const binding=fixture(), different=fixture();
  for(const assignment of [`capacity_id='${different.capacity}'`,`product_id='${different.product}'`,"quota_units=11"]) {
    reject(binding,`UPDATE public.preorder_items SET ${assignment} WHERE id='${binding.item}';`,/PREORDER_CAPACITY_MISMATCH/);
  }
  pass("existing product/date/capacity binding and quota-above-total guards reject malformed draft changes without mutation");

  async function blocked(first,second,pattern) {
    const tag=`a3-${randomUUID()}`;
    const a=connection(`BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL application_name='${tag}-a'; ${first} SELECT pg_sleep(2); COMMIT;`);
    await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}-a' AND wait_event='PgSleep');`);
    const b=connection(`BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL application_name='${tag}-b'; ${second} COMMIT;`);
    await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}-b' AND wait_event_type='Lock');`);
    const [one,two]=await Promise.all([a,b]); assert.equal(one.code,0,one.stderr);
    if(pattern) {assert.notEqual(two.code,0);assert.match(two.stderr,pattern);} else assert.equal(two.code,0,two.stderr);
    races++;
  }
  const same=fixture();
  await blocked(`${auth()} SELECT ${expr(same,"legacy",1)};`,`${auth()} SELECT ${expr(same,"core",1)};`,/PREORDER_VERSION_CONFLICT/);check(same);
  const win=fixture(), lose=fixture({date:win.date}), loserBefore=state(lose);
  await blocked(`${auth()} SELECT ${expr(win,"core",1)};`,`${server} SELECT ${expr(lose,"legacy",1)};`,/PREORDER_DATE_TAKEN/);
  check(win);assert.deepEqual(state(lose),loserBefore);
  pass("observed mixed-overload duplicate/conflicting-date races: one publication; loser rolls back snapshot, item price and capacity unchanged");
  const shrink=fixture({quota:8,total:10});
  // Increasing commitments while holding the real capacity lock must be visible to the waiting publisher.
  const used=fixture();
  reserve(shrink,2); // Initially 8 remaining; the concurrent shrink makes it 7.
  await blocked(`UPDATE public.production_capacity SET total_units=9 WHERE id='${shrink.capacity}';`,
    `${auth()} SELECT ${expr(shrink,"legacy",1)};`,/PREORDER_QUOTA_OVER_CAPACITY/);
  assert.equal(state(shrink).preorder.status,"draft");
  await blocked(`${auth()} SELECT ${expr(used,"core",1)};`,
    `UPDATE public.production_capacity SET intake_cutoff_at=intake_cutoff_at+interval '1 hour' WHERE id='${used.capacity}';`,/CAPACITY_SCHEDULE_FROZEN/);
  pass("capacity edit/publication lock contention revalidates commitments; schedule edits waiting behind successful publication remain forbidden");

  const mutable=fixture();
  const editTag=`a3-editor-${randomUUID()}`;
  const editing=connection(`BEGIN; SET LOCAL application_name='${editTag}';
    UPDATE public.products SET name='Concurrent product',base_price_idr=555555 WHERE id='${mutable.product}';
    UPDATE public.businesses SET pickup_instructions='Concurrent pickup' WHERE id='${business}'; SELECT pg_sleep(3); COMMIT;`);
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${editTag}' AND wait_event='PgSleep');`);
  const publishing=await connection(`BEGIN; SET LOCAL statement_timeout='2s'; ${auth()} SELECT ${expr(mutable,"core",1)}; COMMIT;`);
  assert.equal(publishing.code,0,publishing.stderr);
  assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${editTag}' AND wait_event='PgSleep');`),"t");
  const edited=await editing;assert.equal(edited.code,0,edited.stderr);
  const stable=state(mutable);
  assert.equal(stable.preorder.status,"published");
  assert.equal(stable.item.base_price_snapshot_idr,120123);
  assert.equal(stable.preorder.pickup_terms_snapshot.pickup_instructions,pickup);
  pass("overlapping product/profile edits preserve complete committed pre-edit facts; frozen snapshot is not rewritten after editor commit");

  const evidencePath=resolve(h.root,".next/cache",`a3-publication-${h.runId}.json`);
  mkdirSync(resolve(h.root,".next/cache"),{recursive:true});
  writeFileSync(evidencePath,JSON.stringify({before,after:accepted}));
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>["SYSTEMROOT","COMSPEC","PATH","TEMP","TMP","USERPROFILE","HOMEDRIVE","HOMEPATH","APPDATA","LOCALAPPDATA"].includes(key.toUpperCase())));
  Object.assign(env,{NODE_ENV:"test",NO_COLOR:"1",CAMPAIGN_GEMINI_SMOKE:"0",MEMORY_EMBEDDING_SMOKE:"0",GEMINI_METADATA_CHECK:"0",A3_PUBLICATION_FIXTURE:evidencePath});
  try {
    const script=`import {startVitest} from 'vitest/node'; const files=['tests/integration/preorder-publication-parser.test.ts']; const ctx=await startVitest('test',files,{config:'vitest.config.mts',include:files,watch:false,reporters:['json']}); if(!ctx) process.exitCode=1; else await ctx.close();`;
    const output=execFileSync(process.execPath,["--input-type=module","-e",script],{cwd:h.root,env,encoding:"utf8",stdio:["pipe","pipe","pipe"]});
    const results=JSON.parse(output.slice(output.indexOf("{")));
    assert.equal(results.numFailedTests,0);assert.equal(results.numPendingTests,0);assert.equal(results.numPassedTests,5);
    console.log("PASS A3 parser: 5 Vitest cases; real findPreorder/findPublicPreorder/findPreorderContext reject legacy and accept four SQL-produced canonical rows");
  } finally { unlinkSync(evidencePath); }
  pass("actual application parser parity verified offline with PostgreSQL-produced rows; no schema copy or live HTTP/provider");
  console.log(`PASS A3 final: ${groups} SQL groups, ${races} observed publication/capacity lock races, 1 observed MVCC editor overlap, 5 actual-reader Vitest cases`);
}
