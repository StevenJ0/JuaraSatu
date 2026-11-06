-- Synthetic only. Provision these two Auth fixture subjects before seeding a full Supabase stack.
-- Never insert fake payments or provider verification facts.
BEGIN;
DO $$ BEGIN
 IF (SELECT count(*) FROM auth.users WHERE id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'))<>2 THEN
  RAISE NOTICE 'Synthetic seed skipped: provision the two documented Auth fixture subjects first';
  RETURN;
 END IF;
 INSERT INTO public.businesses(id,name,slug,category,pickup_instructions,is_demo) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Dapur Sintetis A','synthetic-a','Makanan','Pickup sintetis; bukan usaha nyata',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Dapur Sintetis B','synthetic-b','Makanan','Pickup sintetis; bukan usaha nyata',true);
 INSERT INTO public.business_members(business_id,user_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','22222222-2222-4222-8222-222222222222');
 INSERT INTO public.products(id,business_id,name,sku,base_price_idr,variable_cost_idr,cost_quality) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Paket Sintetis A','SYN-A',120000,75000,'verified'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Paket Sintetis B','SYN-B',120000,NULL,'unknown');
 INSERT INTO public.production_capacity(id,business_id,product_id,fulfillment_date,total_units,intake_cutoff_at,fulfillment_window_end_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',current_date+3,40,now()+interval '2 days',now()+interval '3 days'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',current_date+3,40,now()+interval '2 days',now()+interval '3 days');
 INSERT INTO public.preorders(id,business_id,name,slug,status,fulfillment_date,starts_at,ends_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Preorder sintetis A','synthetic-po-a','draft',current_date+3,now()-interval '1 hour',now()+interval '1 day'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Preorder sintetis B','synthetic-po-b','draft',current_date+3,now()-interval '1 hour',now()+interval '1 day');
 INSERT INTO public.preorder_items(id,business_id,preorder_id,product_id,capacity_id,target_units,quota_units,base_price_snapshot_idr,product_name_snapshot,sku_snapshot) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',40,40,120000,'Paket Sintetis A','SYN-A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',40,40,120000,'Paket Sintetis B','SYN-B');
 INSERT INTO public.campaigns(id,business_id,preorder_id,name,slug,status,offer_type,marketing_approach,
  discount_bps,budget_cap_idr,primary_kpi,target_additional_units,starts_at,ends_at,costs_completeness) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','Pengingat sintetis','synthetic-campaign-a','draft','normal_price','scheduled_reminder',0,50000,'paid_units_in_window',8,now()-interval '30 minutes',now()+interval '12 hours','unreviewed'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','Pengingat sintetis','synthetic-campaign-b','draft','normal_price','scheduled_reminder',0,50000,'paid_units_in_window',8,now()-interval '30 minutes',now()+interval '12 hours','unreviewed');
END $$;
COMMIT;
