import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Restore local synthetic public fixtures; never provision Auth or rotate existing credentials.
const root=resolve('.');const container='supabase_db_campaign-lab';
const ownerArguments=process.argv.slice(2);
assert.ok(ownerArguments.length<=1&&ownerArguments.every(arg=>arg.startsWith('--owner-a-user-id=')),'Only --owner-a-user-id=<existing Auth UUID> is supported');
const ownerA=z.uuid().parse(ownerArguments[0]?.slice('--owner-a-user-id='.length)??'11111111-1111-4111-8111-111111111111').toLowerCase();
assert.notEqual(ownerA,'22222222-2222-4222-8222-222222222222','Owners must remain separate');
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
const labels=z.record(z.string(),z.string()).parse(JSON.parse(docker(['inspect',container,'--format','{{json .Config.Labels}}'])));
assert.equal(labels['com.supabase.cli.project'],'campaign-lab');assert.equal(resolve(labels['com.supabase.cli.workdir']).toLowerCase(),root.toLowerCase());
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321','Refuse a nonlocal application target');
const sql=input=>docker(['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input).trim();
assert.equal(sql('SELECT current_database()'),'postgres');
const expected=[{id:ownerA,email:ownerArguments.length?null:'owner-a@campaign-lab.example.test'},{id:'22222222-2222-4222-8222-222222222222',email:'owner-b@campaign-lab.example.test'}];
const users=z.array(z.object({id:z.uuid(),email:z.string(),usable:z.boolean()})).length(2).parse(JSON.parse(sql(`SELECT json_agg(json_build_object('id',id,'email',email,'usable',email_confirmed_at IS NOT NULL AND (banned_until IS NULL OR banned_until<=clock_timestamp())) ORDER BY id) FROM auth.users WHERE id IN ('${expected[0].id}','${expected[1].id}');`)));
for(const account of expected){const actual=users.find(user=>user.id===account.id);assert.ok(actual&&(!account.email||actual.email===account.email)&&actual.usable,'Expected existing usable Auth account required; no Auth user is created or changed');}
const authDigest=()=>sql("SELECT md5(string_agg(id::text||':'||coalesce(email,'')||':'||coalesce(encrypted_password,'')||':'||coalesce(email_confirmed_at::text,'')||':'||coalesce(banned_until::text,''),'|' ORDER BY id)) FROM auth.users;");
const beforeAuth=authDigest();
sql(`SELECT set_config('campaign_lab.seed_owner_a','${ownerA}',false);\n${readFileSync('supabase/seed.sql','utf8')}`);
assert.equal(authDigest(),beforeAuth,'Seed must not change any Auth identity/credential');
console.log('PASS official public seed applied; existing Auth users/credentials preserved');
execFileSync(process.execPath,['scripts/prepare-campaign-execution.mjs','--discussion',...ownerArguments],{cwd:root,encoding:'utf8',stdio:'inherit',windowsHide:true});
assert.equal(authDigest(),beforeAuth);
const Fixture=z.object({businessId:z.uuid(),ownerUserId:z.uuid(),productId:z.uuid(),capacityId:z.uuid(),preorderId:z.uuid(),itemId:z.uuid(),fulfillmentDate:z.iso.date()});
const fixtures=z.array(Fixture).length(2).parse(JSON.parse(readFileSync('node_modules/.cache/campaign-discussion/preorders.json','utf8')));
const verified=[];
for(const[index,f]of fixtures.entries()){assert.equal(f.ownerUserId,expected[index].id);assert.equal(f.businessId,index===0?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');const rows=z.array(z.object({businessId:z.uuid(),ownerUserId:z.uuid(),productId:z.uuid(),capacityId:z.uuid(),preorderId:z.uuid(),itemId:z.uuid(),status:z.literal('published'),basePriceIdr:z.literal(120000),targetUnits:z.literal(40),quotaUnits:z.literal(40),capacityUnits:z.literal(40),startsAt:z.string(),endsAt:z.string(),cutoffAt:z.string(),fulfillmentDate:z.iso.date(),validWindow:z.literal(true),noOrdersOrReservations:z.literal(true)})).length(1).parse(JSON.parse(sql(`
 SELECT json_agg(json_build_object('businessId',b.id,'ownerUserId',m.user_id,'productId',p.id,'capacityId',cap.id,'preorderId',po.id,'itemId',i.id,'status',po.status,
  'basePriceIdr',i.base_price_snapshot_idr,'targetUnits',i.target_units,'quotaUnits',i.quota_units,'capacityUnits',cap.total_units,'startsAt',po.starts_at,'endsAt',po.ends_at,'cutoffAt',cap.intake_cutoff_at,'fulfillmentDate',po.fulfillment_date,
  'validWindow',po.starts_at<clock_timestamp() AND po.ends_at>clock_timestamp()+interval '2 days' AND po.ends_at<=cap.intake_cutoff_at AND po.fulfillment_date=cap.fulfillment_date,
  'noOrdersOrReservations',NOT EXISTS(SELECT 1 FROM public.orders WHERE preorder_id=po.id) AND NOT EXISTS(SELECT 1 FROM public.capacity_reservations WHERE preorder_item_id=i.id)))
 FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id AND m.role='owner' JOIN public.preorders po ON po.business_id=b.id
 JOIN public.preorder_items i ON i.preorder_id=po.id AND i.business_id=b.id JOIN public.products p ON p.id=i.product_id AND p.business_id=b.id
 JOIN public.production_capacity cap ON cap.id=i.capacity_id AND cap.business_id=b.id AND cap.product_id=p.id
 WHERE b.id='${f.businessId}' AND b.is_demo AND m.user_id='${f.ownerUserId}' AND po.id='${f.preorderId}' AND i.id='${f.itemId}' AND p.id='${f.productId}' AND cap.id='${f.capacityId}';`)));
 verified.push(rows[0]);}
const tables=['businesses','business_members','products','production_capacity','preorders','preorder_items','campaigns','campaign_ai_sessions','campaign_ai_messages','ai_generations','campaign_blueprints','campaign_tasks','campaign_contents','campaign_costs','campaign_evaluations','campaign_memories','orders','payments','capacity_reservations','job_runs'];
const counts=JSON.parse(sql(`SELECT json_build_object(${tables.map(table=>`'${table}',(SELECT count(*) FROM public.${table})`).join(',')});`));
mkdirSync('node_modules/.cache/bruno-recovery',{recursive:true});writeFileSync('node_modules/.cache/bruno-recovery/ready.json',JSON.stringify({target:'local campaign-lab',fixtures:verified,counts},null,2));
console.log(JSON.stringify({fixtures:verified,counts},null,2));
