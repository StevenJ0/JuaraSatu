CREATE EXTENSION pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
BEGIN;
SELECT no_plan();
SELECT is((SELECT count(*)::integer FROM pg_tables WHERE schemaname='public'),26,'exactly26 application tables');
SELECT is((SELECT count(*)::integer FROM information_schema.columns WHERE table_schema='public'),351,'all351 target columns');
SELECT is((SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity),26,'RLS enabled on every application table');
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.prosecdef AND NOT coalesce(p.proconfig,'{}') @> ARRAY['search_path=""']),0,'definers have fixed empty search_path');
SELECT ok(NOT has_table_privilege('anon','public.orders','SELECT'),'anon cannot read order PII');
SELECT ok(NOT has_table_privilege('authenticated','public.payments','UPDATE'),'owner cannot directly mark paid');
SELECT ok(NOT has_table_privilege('authenticated','public.campaign_blueprints','UPDATE'),'owner cannot directly set approved');
SELECT ok(NOT has_function_privilege('authenticated','public.finalize_ai_generation(uuid,uuid,uuid,integer,jsonb,uuid)','EXECUTE'),'only server finalizes provider output');
SELECT is((SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a WHERE a.attrelid='public.campaign_memories'::regclass AND a.attname='embedding'),'vector(768)','memory dimensions fixed768');
SELECT ok(to_regclass('public.knowledge_documents') IS NULL AND to_regclass('public.knowledge_chunks') IS NULL,'no deprecated global knowledge tables');
CREATE SCHEMA test;
GRANT USAGE ON SCHEMA test TO authenticated,service_role;
CREATE TABLE test.state(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test.state TO authenticated,service_role;
CREATE FUNCTION test.versions(cid uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('campaignVersion',c.version,'preorderVersion',p.version,'preorderItemVersion',i.version,
  'productVersion',pr.version,'capacityVersion',cap.version)
 FROM public.campaigns c JOIN public.preorders p ON p.id=c.preorder_id JOIN public.preorder_items i ON i.preorder_id=p.id
 JOIN public.products pr ON pr.id=i.product_id JOIN public.production_capacity cap ON cap.id=i.capacity_id WHERE c.id=cid;
$$;
CREATE FUNCTION test.blueprint(pid uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('schemaVersion',1,'preorderId',pid,'contextHash',repeat('a',64),
  'marketingApproach','scheduled_reminder','offer',jsonb_build_object('type','normal_price','discountBps',0),
  'executionWindow',jsonb_build_object('startsAt',now()-interval '15 minutes','endsAt',now()+interval '8 hours'),
  'budgetCapIdr',50000,'targetAdditionalUnits',8,'primaryKpi','paid_units_in_window',
  'tasks',jsonb_build_array(jsonb_build_object('key','announce','title','Pengingat sintetis','channel','whatsapp','dueAt',now()+interval '1 hour')),
  'contents',jsonb_build_array(jsonb_build_object('key','caption','channel','whatsapp','type','caption','body','Data pengujian sintetis.')));
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test TO authenticated,service_role;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT is((SELECT count(*)::integer FROM public.businesses),1,'owner sees only own business');
SELECT is((SELECT count(*)::integer FROM public.preorders),1,'owner sees only own preorder');
SELECT throws_ok($$INSERT INTO public.products(business_id,name,sku,base_price_idr,cost_quality) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','x','x',1,'unknown')$$,'42501',NULL,'direct owner writes denied');
SELECT lives_ok($$SELECT public.create_ai_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',repeat('a',64))$$,'create owner session');
SELECT throws_ok($$SELECT public.create_ai_session('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',gen_random_uuid(),repeat('a',64))$$,'42501',NULL,'cannot create foreign business session');
SELECT throws_ok($$SELECT public.create_ai_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',gen_random_uuid(),repeat('a',64))$$,'23503',NULL,'composite FK rejects foreign preorder even with owned business');
INSERT INTO test.state VALUES('claim',public.claim_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',1,repeat('a',64),'request-one',repeat('b',64),'fake-model','Pertanyaan sintetis'));
SELECT is((SELECT value->>'status' FROM test.state WHERE key='claim'),'claimed','claim first request');
SELECT is((SELECT version FROM public.campaign_ai_sessions WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'),2,'claim increments version');
SELECT is(public.claim_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',1,repeat('a',64),'request-one',repeat('b',64),'fake-model','Pertanyaan sintetis')->>'status','running','duplicate request replays running');
SELECT is((SELECT count(*)::integer FROM public.campaign_ai_messages),1,'duplicate did not append user twice');
SELECT throws_ok($$SELECT public.claim_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',1,repeat('a',64),'request-one',repeat('c',64),'fake-model','changed')$$,'40001',NULL,'different input same key conflicts');
SELECT throws_ok($$SELECT public.claim_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',1,repeat('a',64),'request-two',repeat('c',64),'fake-model','next')$$,'40001',NULL,'stale version rejected');
SELECT throws_ok($$SELECT public.refresh_ai_session_context('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',2,repeat('c',64))$$,'40001',NULL,'cannot change context during running generation');
SET LOCAL request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SELECT is((SELECT count(*)::integer FROM public.campaign_ai_messages),0,'other owner cannot read messages');
SELECT is((SELECT count(*)::integer FROM public.ai_generations),0,'other owner cannot read generation');
RESET ROLE;
SELECT throws_ok($$SET LOCAL ROLE anon; SELECT * FROM public.campaign_ai_sessions$$,'42501',NULL,'guest cannot read private sessions');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
INSERT INTO test.state VALUES('output',jsonb_build_object('schemaVersion',1,'businessId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
 'preorderId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','sessionId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
 'requestKey','request-one','contextHash',repeat('a',64),'proposalVersion',2,'state','proposed','options','[]'::jsonb,'reply','Jawaban sintetis, belum disetujui.'));
SELECT throws_ok($$SELECT public.finalize_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
 (SELECT (value->>'generationId')::uuid FROM test.state WHERE key='claim'),2,
 jsonb_set((SELECT value FROM test.state WHERE key='output'),'{contextHash}',to_jsonb(repeat('f',64))),
 '11111111-1111-4111-8111-111111111111')$$,'23514',NULL,'invalid provider binding aborts finalization');
SELECT is((SELECT count(*)::integer FROM public.campaign_ai_messages WHERE role='assistant'),0,'aborted finalization leaves no assistant message');
SELECT lives_ok($$SELECT public.finalize_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
 (SELECT (value->>'generationId')::uuid FROM test.state WHERE key='claim'),2,(SELECT value FROM test.state WHERE key='output'),'11111111-1111-4111-8111-111111111111')$$,'finalization transaction succeeds');
SELECT is((SELECT version FROM public.campaign_ai_sessions WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'),3,'finalization increments version');
SELECT is((SELECT count(*)::integer FROM public.campaign_ai_messages),2,'one user and one assistant message');
SELECT lives_ok($$SELECT public.finalize_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
 (SELECT (value->>'generationId')::uuid FROM test.state WHERE key='claim'),2,(SELECT value FROM test.state WHERE key='output'),'11111111-1111-4111-8111-111111111111')$$,'duplicate finalization replays');
SELECT is((SELECT count(*)::integer FROM public.campaign_ai_messages),2,'replay did not duplicate assistant');
INSERT INTO test.state VALUES('failure',public.claim_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',3,repeat('a',64),'request-two',repeat('c',64),'fake-model','Retry eksplisit','discussion','11111111-1111-4111-8111-111111111111'));
SELECT lives_ok($$SELECT public.fail_ai_generation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
 (SELECT (value->>'generationId')::uuid FROM test.state WHERE key='failure'),4,'PROVIDER_TIMEOUT','11111111-1111-4111-8111-111111111111')$$,'provider failure recorded atomically');
SELECT is((SELECT count(*)::integer FROM public.campaign_ai_messages WHERE role='assistant'),1,'failed provider did not invent assistant success');
SELECT throws_ok($$UPDATE public.campaign_ai_messages SET body_text='changed'$$,'23514',NULL,'messages immutable');
-- CAMPAIGN_TESTS
SELECT lives_ok($$SELECT public.publish_preorder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',1,'11111111-1111-4111-8111-111111111111')$$,'publish preorder freezes product snapshots');
SELECT throws_ok($$UPDATE public.preorder_items SET base_price_snapshot_idr=1 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'$$,'23514',NULL,'frozen preorder price cannot change');
SELECT lives_ok($$UPDATE public.products SET base_price_idr=130000 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'$$,'catalog price remains editable');
SELECT is((SELECT base_price_snapshot_idr FROM public.preorder_items WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'),120000::bigint,'catalog edit did not change frozen price');
INSERT INTO test.state VALUES('bad-blueprint',to_jsonb(public.save_blueprint_revision('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',repeat('a',64),
 jsonb_set(test.blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),'{contents}',
  jsonb_build_array(test.blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4')#>'{contents,0}',test.blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4')#>'{contents,0}')),
 NULL,'11111111-1111-4111-8111-111111111111')));
SELECT throws_ok($$SELECT public.approve_blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
 test.versions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),repeat('a',64),'11111111-1111-4111-8111-111111111111')$$,'23505',NULL,'duplicate content rolls back approval transaction');
SELECT is((SELECT approval_status FROM public.campaign_blueprints WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8'),'proposed','approval flag rolled back');
SELECT is((SELECT count(*)::integer FROM public.campaign_tasks),0,'materialized tasks rolled back with invalid content');
SELECT is((SELECT count(*)::integer FROM public.campaign_contents),0,'contents rolled back atomically');
SELECT lives_ok($$SELECT public.save_blueprint_revision('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
 2,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',repeat('a',64),test.blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),NULL,'11111111-1111-4111-8111-111111111111')$$,'save new revision without editing old version');
SELECT throws_ok($$SELECT public.approve_blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
 '{}'::jsonb,repeat('a',64),'11111111-1111-4111-8111-111111111111')$$,'40001',NULL,'stale/missing source versions rejected');
SELECT lives_ok($$SELECT public.approve_blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
 test.versions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),repeat('a',64),'11111111-1111-4111-8111-111111111111')$$,'approve and materialize valid revision');
SELECT is((SELECT status FROM public.campaigns WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),'draft','approval did not publish');
SELECT lives_ok($$SELECT public.approve_blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
 '{}'::jsonb,repeat('a',64),'11111111-1111-4111-8111-111111111111')$$,'approval replay is idempotent');
SELECT is((SELECT count(*)::integer FROM public.campaign_tasks),1,'approval replay did not duplicate tasks');
SELECT throws_ok($$UPDATE public.campaign_blueprints SET blueprint_json='{}' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'$$,'23514',NULL,'approved blueprint payload immutable');
SELECT throws_ok($$SELECT public.approve_blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
 '{}'::jsonb,repeat('b',64),'11111111-1111-4111-8111-111111111111')$$,'40001',NULL,'approval replay with wrong context rejected');
SELECT is((SELECT count(*)::integer FROM public.campaign_contents),1,'approval replay did not duplicate contents');
SELECT lives_ok($$SELECT public.publish_campaign('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
 test.versions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),'11111111-1111-4111-8111-111111111111')$$,'publish explicitly after approval');
SELECT is((SELECT baseline_json->>'baseline_preorder_paid_units' FROM public.campaigns WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),'0','baseline uses real DB paid units, not fixture forecast');
SELECT throws_ok($$UPDATE public.campaigns SET discount_bps=500 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'$$,'23514',NULL,'published config immutable');
-- Clone a draft from the published campaign to verify uniqueness under a second valid approval.
INSERT INTO public.campaigns(id,business_id,preorder_id,name,slug,status,offer_type,marketing_approach,discount_bps,
 budget_cap_idr,primary_kpi,target_additional_units,starts_at,ends_at,costs_completeness)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',business_id,preorder_id,'Second synthetic','second-synthetic','draft',offer_type,
 marketing_approach,discount_bps,budget_cap_idr,primary_kpi,target_additional_units,starts_at,ends_at,costs_completeness
FROM public.campaigns WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
SELECT public.save_blueprint_revision('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',1,
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',repeat('a',64),test.blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),NULL,'11111111-1111-4111-8111-111111111111');
SELECT public.approve_blueprint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
 test.versions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10'),repeat('a',64),'11111111-1111-4111-8111-111111111111');
SELECT throws_ok($$SELECT public.publish_campaign('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',
 test.versions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10'),'11111111-1111-4111-8111-111111111111')$$,'23505',NULL,'second published campaign prevented');
SELECT is((SELECT count(*)::integer FROM public.campaigns WHERE status='published'),1,'only one published campaign remains');
SELECT throws_ok($$UPDATE public.campaign_blueprints SET approval_status='discarded' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'$$,'23514',NULL,'published blueprint cannot be discarded');
SELECT lives_ok($$SELECT public.close_campaign('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
 (SELECT version FROM public.campaigns WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),'11111111-1111-4111-8111-111111111111')$$,'close campaign is separate atomic command');
SELECT throws_ok($$SELECT public.record_campaign_evaluation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12','final','{}',NULL,'[]',now(),'11111111-1111-4111-8111-111111111111')$$,'23514',NULL,'final evaluation needs confirmed cost completeness');
UPDATE public.campaigns SET costs_completeness='confirmed_complete' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
SELECT lives_ok($$SELECT public.record_campaign_evaluation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12','final','{"paid_units":0,"is_sandbox_data":true}',NULL,'[]',now(),'11111111-1111-4111-8111-111111111111')$$,'save final evaluation even without AI analysis');
SELECT throws_ok($$UPDATE public.campaign_evaluations SET metrics_json='{}'$$,'23514',NULL,'evaluation history append-only');
INSERT INTO public.campaign_memories(id,business_id,campaign_id,source_evaluation_id,source_blueprint_id,source_version,
 summary_text,lessons_json,limitations_json,content_hash,review_status,embedding_status,embedding_version)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',1,'Pengalaman sintetis tanpa klaim kausal.','[]','[]',repeat('d',64),'draft','queued',1);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SELECT is((SELECT count(*)::integer FROM public.match_campaign_memories('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array_fill(1::real,ARRAY[768])::extensions.vector,
 'synthetic-embedding-model','synthetic-profile-768',1)),0,'unapproved memory excluded from retrieval');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
SELECT lives_ok($$SELECT public.approve_campaign_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13',repeat('d',64),
 'synthetic-embedding-model','synthetic-profile-768','11111111-1111-4111-8111-111111111111')$$,'owner approval queues durable memory job');
SELECT public.approve_campaign_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13',repeat('d',64),
 'synthetic-embedding-model','synthetic-profile-768','11111111-1111-4111-8111-111111111111');
SELECT is((SELECT count(*)::integer FROM public.job_runs WHERE job_type='embed_memory'),1,'memory approval replay deduplicates job');
SELECT throws_ok($$UPDATE public.campaign_memories SET summary_text='changed' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13'$$,'23514',NULL,'approved memory source immutable');
SELECT lives_ok($$SELECT public.complete_memory_indexing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13',repeat('d',64),1,
 'synthetic-embedding-model','synthetic-profile-768',array_fill(1::real,ARRAY[768])::extensions.vector)$$,'index compatible synthetic768 vector');
SELECT throws_ok($$SELECT public.complete_memory_indexing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13',repeat('d',64),1,
 'synthetic-embedding-model','synthetic-profile-768',array_fill(1::real,ARRAY[3])::extensions.vector)$$,'22023',NULL,'wrong dimension rejected');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SELECT is((SELECT count(*)::integer FROM public.match_campaign_memories('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array_fill(1::real,ARRAY[768])::extensions.vector,
 'synthetic-embedding-model','synthetic-profile-768',1)),1,'retrieve own approved ready memory');
SELECT is((SELECT count(*)::integer FROM public.match_campaign_memories('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array_fill(1::real,ARRAY[768])::extensions.vector,
 'wrong-model','synthetic-profile-768',1)),0,'incompatible embedding model excluded');
SELECT is((SELECT count(*)::integer FROM public.match_campaign_memories('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array_fill(1::real,ARRAY[768])::extensions.vector,
 'synthetic-embedding-model','wrong-profile',1)),0,'incompatible profile excluded');
SET LOCAL request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SELECT is((SELECT count(*)::integer FROM public.campaign_memories),0,'other business cannot read private memory');
SELECT throws_ok($$SELECT public.match_campaign_memories('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array_fill(1::real,ARRAY[768])::extensions.vector,
 'synthetic-embedding-model','synthetic-profile-768',1)$$,'42501',NULL,'cross-tenant retrieval denied before ranking');
-- PAYMENT_AND_JOB_TESTS
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
INSERT INTO public.orders(id,business_id,preorder_id,public_order_number,private_token_hash,idempotency_key,request_hash,source,
 customer_name,customer_email,fulfillment_date,payment_mode,order_status,fulfillment_status,subtotal_idr,discount_total_idr,total_idr,payment_due_at)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','SYNTHETIC-ORDER-ONE',repeat('e',64),
 'synthetic-order-one',repeat('f',64),'public','Synthetic buyer','buyer@example.test',current_date+3,'midtrans_sandbox','pending_payment','pending_confirmation',240000,0,240000,now()+interval '15 minutes');
INSERT INTO public.order_items(id,business_id,order_id,preorder_item_id,product_id,product_name_snapshot,sku_snapshot,quantity,
 base_unit_price_idr,discount_bps_snapshot,discount_per_unit_idr,final_unit_price_idr,variable_cost_per_unit_idr,cost_quality_snapshot,line_total_idr)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Paket Sintetis A','SYN-A',2,120000,0,0,120000,75000,'verified',240000);
INSERT INTO public.capacity_reservations(business_id,order_id,order_item_id,preorder_item_id,capacity_id,quantity,state,expires_at)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',2,'held',now()+interval '15 minutes');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.payments(id,business_id,order_id,provider,provider_order_id,attempt_number,amount_idr,status,is_active_attempt)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20','midtrans_sandbox','SIMULATED-GATEWAY-ONE',1,240000,'pending',true);
SELECT throws_ok($$INSERT INTO public.payments(business_id,order_id,provider,provider_order_id,attempt_number,amount_idr,status,is_active_attempt)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20','midtrans_sandbox','SIMULATED-GATEWAY-TWO',2,240000,'pending',true)$$,'23505',NULL,'at most one active payment attempt');
-- SIMULATED trusted gateway input only: this does not verify a real Midtrans signature or payment.
SELECT is((SELECT count(*)::integer FROM public.payments WHERE order_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20' AND applied_at IS NOT NULL),0,'pending unverified attempt has no applied payment');
SELECT throws_ok($$SELECT public.apply_verified_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22','SIMULATED-GATEWAY-ONE','invalid-status',repeat('1',64),240000,NULL,now())$$,'23514',NULL,'missing verified provider status rejected');
SELECT is(public.apply_verified_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22','SIMULATED-GATEWAY-ONE','synthetic-settlement',repeat('1',64),240000,'settlement',now()),'applied','apply simulated verified fact atomically');
SELECT is(public.apply_verified_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22','SIMULATED-GATEWAY-ONE','synthetic-settlement',repeat('1',64),240000,'settlement',now()),'applied','webhook retry replays without effects');
SELECT is((SELECT count(*)::integer FROM public.job_runs WHERE job_type='send_paid_email'),1,'one durable email job');
SELECT is((SELECT sum(quantity)::integer FROM public.capacity_reservations WHERE state='allocated'),2,'held becomes allocated without double counting');
SELECT is((SELECT fulfillment_status FROM public.orders WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20'),'confirmed','payment does not mark fulfilled');
SELECT is((SELECT count(*)::integer FROM public.order_events WHERE event_type='payment_applied'),1,'one payment application audit');
SELECT throws_ok($$SELECT public.apply_verified_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22','SIMULATED-GATEWAY-ONE','synthetic-settlement',repeat('2',64),240000,'settlement',now())$$,'40001',NULL,'same event key different hash rejected');
SELECT throws_ok($$UPDATE public.payments SET applied_at=NULL WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22'$$,'23514',NULL,'cannot unset applied payment');
INSERT INTO public.payments(id,business_id,order_id,provider,provider_order_id,attempt_number,amount_idr,status,is_active_attempt)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa23','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20','midtrans_sandbox','SIMULATED-GATEWAY-TWO',2,240000,'pending',false);
SELECT is(public.apply_verified_payment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa23','SIMULATED-GATEWAY-TWO','synthetic-duplicate-paid',repeat('2',64),240000,'settlement',now()),'requires_review','second settlement is a fact for review, not another allocation');
SELECT is((SELECT count(*)::integer FROM public.job_runs WHERE job_type='send_paid_email'),1,'duplicate paid attempt did not enqueue another success email');
SELECT throws_ok($$UPDATE public.payments SET applied_at=now() WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa23'$$,'23505',NULL,'at most one applied payment');
SELECT throws_ok($$UPDATE public.order_items SET final_unit_price_idr=1 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21'$$,'23514',NULL,'historical order pricing immutable');
SELECT throws_ok($$INSERT INTO public.capacity_reservations(business_id,order_id,order_item_id,preorder_item_id,capacity_id,quantity,state,expires_at)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',2,'held',now()+interval '1 minute')$$,'23505',NULL,'one reservation per order item');
SELECT throws_ok($$UPDATE public.production_capacity SET total_units=1 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'$$,'23514',NULL,'cannot shrink capacity below allocations/quota');
SELECT throws_ok($$UPDATE public.preorder_items SET target_units=1,quota_units=1 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'$$,'23514',NULL,'cannot shrink quota below allocations');
UPDATE public.orders SET attribution_campaign_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',production_started_at=now(),
 fulfillment_status='fulfilled',fulfilled_at=now() WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20';
SELECT throws_ok($$SELECT public.record_campaign_evaluation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa24','final','{}',NULL,'[]',now(),'11111111-1111-4111-8111-111111111111')$$,'23514',NULL,'final evaluation rejects missing production ledger');
INSERT INTO public.order_production_costs(business_id,order_item_id,cost_kind,quantity,cost_per_unit_idr,amount_idr,quality,incurred_at)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21','variable_production',2,75000,150000,'verified',now());
SELECT lives_ok($$SELECT public.record_campaign_evaluation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa24','final','{"is_sandbox_data":true}',NULL,'[]',now(),'11111111-1111-4111-8111-111111111111')$$,'final evaluation accepts resolved cohort and known full-quantity ledger');
INSERT INTO test.state SELECT 'job',to_jsonb(j) FROM public.claim_jobs(1,60,5) j;
SELECT is((SELECT value->>'status' FROM test.state WHERE key='job'),'running','job claimed with durable lease');
SELECT throws_ok($$SELECT public.finish_job((SELECT (value->>'id')::uuid FROM test.state WHERE key='job'),0,true)$$,'40001',NULL,'stale worker fence rejected');
SELECT lives_ok($$SELECT public.finish_job((SELECT (value->>'id')::uuid FROM test.state WHERE key='job'),1,true)$$,'current worker completes job');
SELECT lives_ok($$SELECT public.finish_job((SELECT (value->>'id')::uuid FROM test.state WHERE key='job'),1,true)$$,'completion acknowledgement replay is idempotent');
SELECT ok(public.take_rate_limit(repeat('9',64),date_trunc('minute',now()),now()+interval '1 minute',1),'first rate-limit request allowed');
SELECT ok(NOT public.take_rate_limit(repeat('9',64),date_trunc('minute',now()),now()+interval '1 minute',1),'second rate-limit request denied atomically');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
