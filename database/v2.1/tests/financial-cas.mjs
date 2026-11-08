import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Only the existing labelled, networkless harness supplies this SQL port; no target/URL is accepted.
export async function runFinancialCas(h) {
  const { sql, json, functions } = h;
  const owner=randomUUID(), foreign=randomUUID(), outsider=randomUUID(), business=randomUUID(), other=randomUUID();
  const auth=(id=owner)=>`SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${id}';`;
  const server="SET ROLE service_role; SET request.jwt.claim.role='service_role'; SET request.jwt.claim.sub='';";
  let sequence=0, groups=0, rejected=0;
  const pass=t=>console.log(`PASS F1 ${++groups}: ${t}`);
  sql(`INSERT INTO auth.users(id,email) VALUES('${owner}','${owner}@example.invalid'),('${foreign}','${foreign}@example.invalid'),('${outsider}','${outsider}@example.invalid');
    INSERT INTO public.businesses(id,name,slug,category,pickup_instructions,is_demo) VALUES
    ('${business}','F1 synthetic','${business}','Food','Synthetic pickup',true),('${other}','F1 foreign','${other}','Food','Synthetic pickup',true);
    INSERT INTO public.business_members(business_id,user_id) VALUES('${business}','${owner}'),('${other}','${foreign}');`);
  const tables=["orders","order_items","capacity_reservations","payments","payment_events","domain_events","job_runs","order_events","order_production_costs","preorders","preorder_items","production_capacity","products"];
  const snapshot=()=>json(`SELECT json_build_object(${tables.map(t=>`'${t}',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.${t} x WHERE business_id='${business}')`).join(",")});`);
  const reject=(query,pattern)=>{const before=snapshot();assert.throws(()=>sql(query),pattern);assert.deepEqual(snapshot(),before);rejected++;};
  const version=(table,id)=>Number(sql(`SELECT version FROM public.${table} WHERE id='${id}';`));
  function fixture({base=100,status="published",cost=null}={}) {
    const f={id:randomUUID(),item:randomUUID(),product:randomUUID(),capacity:randomUUID(),base,slug:randomUUID()};
    f.date=sql(`SELECT (current_date+${1300+ ++sequence})::text;`);
    sql(`INSERT INTO public.products(id,business_id,name,sku,base_price_idr,variable_cost_idr,cost_quality)
      VALUES('${f.product}','${business}','F1 synthetic','${f.product}',${base},${cost??"NULL"},'${cost===null?"unknown":"verified"}');
      INSERT INTO public.production_capacity(id,business_id,product_id,fulfillment_date,total_units,intake_cutoff_at,fulfillment_window_end_at)
      VALUES('${f.capacity}','${business}','${f.product}','${f.date}',10000,now()+interval '5 days','${f.date} 18:00+07');
      INSERT INTO public.preorders(id,business_id,name,slug,status,fulfillment_date,starts_at,ends_at)
      VALUES('${f.id}','${business}','F1 synthetic','${f.slug}','draft','${f.date}',now()-interval '1 hour',now()+interval '4 days');
      INSERT INTO public.preorder_items(id,business_id,preorder_id,product_id,capacity_id,target_units,quota_units,base_price_snapshot_idr,product_name_snapshot,sku_snapshot)
      VALUES('${f.item}','${business}','${f.id}','${f.product}','${f.capacity}',1,10000,${base},'F1 synthetic','${f.product}');`);
    if(status!=="draft") sql(`${auth()} SELECT public.publish_preorder('${f.id}',1);`);
    if(status==="closed") sql(`${auth()} SELECT public.close_preorder('${f.id}',${version("preorders",f.id)},'F1 close');`);
    return f;
  }
  const request=()=>({key:randomUUID(),hash:randomUUID().replaceAll("-","").repeat(2),token:randomUUID().replaceAll("-","").repeat(2)});
  function expression(path,f,qty=1,r=request(),price=f.base) {
    if(path==="manual") return `public.create_manual_order('${f.id}',${qty},'F1 synthetic',NULL,NULL,true,'${r.key}','${r.hash}')`;
    if(path==="standalone") return `public.create_standalone_manual_order('${f.capacity}',${qty},'F1 synthetic',NULL,NULL,true,'${r.key}','${r.hash}')`;
    return `public.create_preorder_order('${f.slug}',${qty},'F1 synthetic','f1@example.invalid',NULL,'${r.token}','${r.key}','${r.hash}',${price},900,NULL)`;
  }
  const call=(path,f,qty=1,r=request(),price=f.base)=>json(`${path==="public"?server:auth()} SELECT ${expression(path,f,qty,r,price)};`);
  const privateExpression=(f,qty,bps)=>`private.insert_order((SELECT p FROM public.preorders p WHERE id='${f.id}'),
    (SELECT i FROM public.preorder_items i WHERE id='${f.item}'),'public','midtrans_sandbox',NULL,'pending_payment',
    'F1 synthetic','f1@example.invalid',NULL,${qty},'${request().token}','${randomUUID()}','${request().hash}',
    'held',now()+interval '15 minutes',${bps},NULL,NULL)`;

  const over=fixture({base:600000000});
  const before=snapshot();
  assert.equal(json(`BEGIN; ${auth()} SELECT ${expression("manual",over,2)}; ROLLBACK;`).total_idr,1200000000);
  assert.deepEqual(snapshot(),before);
  const oldOrder=call("manual",fixture());
  sql(`BEGIN; ${auth()} SELECT public.advance_fulfillment('${oldOrder.order_id}',NULL,'confirm'); ROLLBACK;`);
  console.log("REPRODUCED before F1: subtotal1.2b accepted; owner NULL version transition accepted (both rolled back)");
  const historicalRequest=request(),historical=call("manual",over,2,historicalRequest),dataBeforeMigration=snapshot();

  const prior=functions();
  const metadata=()=>json(`SELECT json_agg(json_build_object('id',p.oid,'args',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),
    'owner',p.proowner,'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,'volatility',p.provolatile) ORDER BY p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f';`);
  const metaBefore=metadata();
  sql(h.migrationSql);
  assert.deepEqual(snapshot(),dataBeforeMigration);
  assert.equal(call("manual",over,2,historicalRequest).order_id,historical.order_id);
  assert.deepEqual(snapshot(),dataBeforeMigration);
  assert.deepEqual(metadata(),metaBefore);
  const after=functions(),changed=[];
  assert.equal(after.length,prior.length);
  for(const p of prior) {const a=after.find(f=>f.id===p.id);assert.ok(a);assert.deepEqual({...a,body:p.body},p);if(a.body!==p.body)changed.push(p.name);}
  assert.deepEqual(changed.sort(),["discount_per_unit","insert_order","lock_order","lock_owned_preorder"]);
  pass("four private bodies only; public signatures/defaults/returns/owners/ACLs/security/path and unrelated functions unchanged");

  for(const path of ["manual","standalone","public"]) {
    for(const [base,qty,cost] of [[1,1,null],[100000,10000,0],[1000000000,1,null],[12345,3,null]]) {
      const f=fixture({base,cost}),r=request(),o=call(path,f,qty,r);
      assert.equal(o.total_idr,base*qty);
      const stored=json(`SELECT to_jsonb(i) FROM public.order_items i WHERE order_id='${o.order_id}';`);
      assert.equal(stored.base_unit_price_idr,base);assert.equal(stored.line_total_idr,base*qty);
      assert.equal(stored.variable_cost_per_unit_idr,cost);assert.equal(stored.discount_bps_snapshot,0);
      assert.equal(call(path,f,qty,r).order_id,o.order_id);assert.equal(call(path,f,qty,r).replayed,true);
      reject(`${path==="public"?server:auth()} SELECT ${expression(path,f,qty,{...r,hash:"c".repeat(64)})};`,/IDEMPOTENCY_CONFLICT/);
    }
    for(const [base,qty] of [[1000000001,1],[142857143,7],[600000000,2],["9223372036854775807",10000]]) {
      const f=fixture({base});reject(`${path==="public"?server:auth()} SELECT ${expression(path,f,qty)};`,/P0001[\s\S]*VALIDATION_ERROR/);
    }
    const f=fixture();
    for(const qty of [0,-1,10001,"NULL"]) reject(`${path==="public"?server:auth()} SELECT ${expression(path,f,qty)};`,/VALIDATION_ERROR/);
    pass(`${path}: min/normal/exact1b/quantity10000/unknown and zero cost/replay pass; subtotal+1/1.2b/bigint overflow inputs reject atomically`);
  }
  const discounted=fixture({base:10003});
  const d=json(`SELECT to_jsonb(${privateExpression(discounted,3,3333)});`);
  assert.deepEqual([d.subtotal_idr,d.discount_total_idr,d.total_idr],[30009,9999,20010]);
  assert.equal(sql(`SELECT discount_per_unit_idr FROM public.order_items WHERE order_id='${d.id}';`),"3333");
  reject(`SELECT ${privateExpression(over,2,9000)};`,/VALIDATION_ERROR/);
  for(const qty of [0,-1,10001,2147483647,"NULL"]) reject(`SELECT ${privateExpression(discounted,qty,0)};`,/VALIDATION_ERROR/);
  const maxDiscount=fixture({base:1000000000});
  const maxResult=json(`SELECT to_jsonb(${privateExpression(maxDiscount,1,9999)});`);
  assert.deepEqual([maxResult.subtotal_idr,maxResult.discount_total_idr,maxResult.total_idr],[1000000000,999900000,100000]);
  const badCost=fixture({cost:1000000001});
  reject(`${auth()} SELECT ${expression("manual",badCost)};`,/VALIDATION_ERROR/);
  for(const bps of [-1,10000,2147483647,"NULL"]) reject(`SELECT ${privateExpression(discounted,1,bps)};`,/VALIDATION_ERROR/);
  const small=fixture();
  reject(`${server} SELECT ${expression("public",small,1,request(),101)};`,/OFFER_CHANGED/);
  reject(`${server} SELECT ${expression("public",small,1,request(),"'bad'::bigint")};`,/22P02/);
  reject(`${server} SELECT ${expression("public",small,1,request(),"NULL")};`,/VALIDATION_ERROR/);
  pass("real shared private insertion preserves floor-per-unit discount; low discounted final cannot hide invalid subtotal; malformed quote rejected, server price remains authority");

  function late() {
    const f=fixture(),r=request(),o=call("public",f,1,r);
    const p=json(`${server} SELECT public.claim_payment_attempt('${r.token}');`);
    sql(`UPDATE public.capacity_reservations SET expires_at=now()-interval '1 second' WHERE order_id='${o.order_id}';`);
    assert.equal(json(`${server} SELECT public.apply_verified_payment('${p.provider_order_id}','${randomUUID()}','${r.hash}','settlement','F1-${randomUUID()}',100,now());`).outcome,"review");
    return {o:o.order_id,p:p.payment_id};
  }
  function expired() {
    const f=fixture(),o=call("public",f);
    sql(`UPDATE public.orders SET payment_due_at=now()-interval '1 second' WHERE id='${o.order_id}';
      UPDATE public.capacity_reservations SET expires_at=now()-interval '1 second' WHERE order_id='${o.order_id}';`);
    return o.order_id;
  }
  const orderCases=[];
  const advance=call("manual",fixture()).order_id;
  orderCases.push({name:"advance_fulfillment",id:advance,expr:v=>`public.advance_fulfillment('${advance}',${v},'confirm')`});
  const cancel=call("manual",fixture()).order_id;
  orderCases.push({name:"expire_or_cancel_order cancel",id:cancel,expr:v=>`public.expire_or_cancel_order('${cancel}',${v},'cancel','F1 cancel','F1 sandbox refund note')`});
  const exp=expired();orderCases.push({name:"expire_or_cancel_order owner expire",id:exp,expr:v=>`public.expire_or_cancel_order('${exp}',${v},'expire',NULL,NULL)`});
  for(const action of ["accept","decline"]) {
    const l=late();orderCases.push({name:`${action}_late_payment`,id:l.o,expr:v=>action==="accept"?`public.accept_late_payment('${l.o}',${v},'${l.p}')`:`public.decline_late_payment('${l.o}',${v},'F1 declined')`});
  }
  const cost=call("manual",fixture()).order_id;
  sql(`${auth()} SELECT public.advance_fulfillment('${cost}',${version("orders",cost)},'confirm');`);
  sql(`${auth()} SELECT public.advance_fulfillment('${cost}',${version("orders",cost)},'start_production');`);
  orderCases.push({name:"resolve_production_cost",id:cost,expr:v=>`public.resolve_production_cost('${cost}',${v},0,'verified','F1 zero cost')`});
  for(const c of orderCases) {
    const v=version("orders",c.id);
    for(const bad of ["NULL",0,-1,v+100]) reject(`${auth()} SELECT ${c.expr(bad)};`,/VERSION_CONFLICT/);
    reject(`${auth(foreign)} SELECT ${c.expr(v)};`,/NOT_FOUND/);
    reject(`${auth(outsider)} SELECT ${c.expr(v)};`,/42501/);
    reject(`SET ROLE anon; SELECT ${c.expr(v)};`,/42501/);
    if(!c.name.startsWith("expire_or_cancel_order")) reject(`${server} SELECT ${c.expr(v)};`,/42501/);
    sql(`${auth()} SELECT ${c.expr(v)};`);
    if(c.name!=="expire_or_cancel_order owner expire") reject(`${auth()} SELECT ${c.expr(v)};`,/VERSION_CONFLICT|ORDER_STATE_INVALID/);
    pass(`${c.name}: owner NULL/zero/negative/stale/foreign/missing membership/anon denied with full snapshots unchanged; current version succeeds`);
  }

  const preorderCases=[];
  for(const [name,status] of [["cancel_preorder_draft","draft"],["cancel_published_preorder","published"],["close_preorder","published"],["complete_preorder","closed"],["save_preorder_draft","draft"],["publish_preorder core","draft"],["publish_preorder legacy","draft"]]) {
    const f=fixture({status});
    const expr=v=>name==="save_preorder_draft"?`public.save_preorder_draft('${f.id}',${v},NULL,'F1 edited','${f.capacity}',1,10000,now()-interval '1 hour',now()+interval '4 days')`
      :name==="publish_preorder legacy"?`public.publish_preorder('${business}','${f.id}',${v},NULL)`
      :name==="publish_preorder core"?`public.publish_preorder('${f.id}',${v})`
      :`public.${name}('${f.id}',${v}${name==="close_preorder"?",'F1 reason'":""})`;
    preorderCases.push({name,f,expr});
  }
  for(const c of preorderCases) {
    const v=version("preorders",c.f.id);
    for(const bad of ["NULL",0,-1,v+100]) reject(`${auth()} SELECT ${c.expr(bad)};`,/PREORDER_VERSION_CONFLICT/);
    reject(`${auth(foreign)} SELECT ${c.expr(v)};`,c.name==="publish_preorder legacy"?/42501[\s\S]*FORBIDDEN/:/NOT_FOUND/);
    reject(`${auth(outsider)} SELECT ${c.expr(v)};`,/42501/);
    reject(`SET ROLE anon; SELECT ${c.expr(v)};`,/42501/);
    if(c.name!=="publish_preorder legacy") reject(`${server} SELECT ${c.expr(v)};`,/42501/);
    sql(`${auth()} SELECT ${c.expr(v)};`);
    reject(`${auth()} SELECT ${c.expr(v)};`,/PREORDER_VERSION_CONFLICT/);
    pass(`${c.name}: direct owner invalid/stale versions and foreign/anon/service boundaries fenced; exact current version persists`);
  }
  const fresh=request(),draft=fixture({status:"draft"});
  const created=sql(`${auth()} SELECT public.save_preorder_draft(NULL,NULL,'${fresh.key}','F1 new','${draft.capacity}',1,10000,now(),now()+interval '4 days');`);
  assert.match(created,/^[a-f0-9-]{36}$/);
  const system=expired(),systemBefore=snapshot();
  reject(`${auth()} SELECT public.expire_or_cancel_order('${system}',NULL,'expire',NULL,NULL);`,/VERSION_CONFLICT/);
  reject(`SET ROLE authenticated; SET request.jwt.claim.role='service_role'; SET request.jwt.claim.sub=''; SELECT public.expire_or_cancel_order('${system}',NULL,'expire',NULL,NULL);`,/VERSION_CONFLICT/);
  reject(`${server} SET request.jwt.claim.sub='${owner}'; SELECT public.expire_or_cancel_order('${system}',NULL,'expire',NULL,NULL);`,/VERSION_CONFLICT/);
  reject(`${server} SET request.jwt.claim.role=''; SELECT public.expire_or_cancel_order('${system}',NULL,'expire',NULL,NULL);`,/VERSION_CONFLICT/);
  assert.deepEqual(snapshot(),systemBefore);
  sql(`${server} SELECT public.expire_or_cancel_order('${system}',NULL,'expire',NULL,NULL);`);
  assert.equal(sql(`SELECT order_status FROM public.orders WHERE id='${system}';`),"expired");
  const replay=snapshot();sql(`${server} SELECT public.expire_or_cancel_order('${system}',NULL,'expire',NULL,NULL);`);assert.deepEqual(snapshot(),replay);
  reject(`${server} SELECT public.expire_or_cancel_order('${system}',NULL,'cancel','F1',NULL);`,/VALIDATION_ERROR/);
  reject(`${server} SELECT private.lock_order('${system}',NULL,NULL);`,/42501/);
  const invalid=call("manual",fixture()).order_id;
  reject(`${auth()} SELECT public.advance_fulfillment('${invalid}',${version("orders",invalid)},'fulfill');`,/ORDER_STATE_INVALID/);
  pass("new draft may omit non-existent version; genuine service expiry NULL/replay works; forged JWT role, versionless owner and private-helper access fail; invalid lifecycle atomic");
  console.log(`PASS F1 final: ${groups} focused groups; ${rejected} rejected statements with identical before/after snapshots across13 related tables`);
  return {groups,rejected};
}
