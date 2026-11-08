-- PM05: both authorized entry points use the core publication rules and frozen terms.
BEGIN;

CREATE FUNCTION private.publish_preorder_canonical(p_business_id uuid,p_preorder_id uuid,p_expected_version integer)
RETURNS public.preorders LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 v_preorder public.preorders;
 v_item public.preorder_items;
 v_capacity public.production_capacity;
 v_product public.products;
 v_business public.businesses;
 v_committed_units bigint;
BEGIN
 SELECT * INTO v_preorder FROM public.preorders
 WHERE id=p_preorder_id AND business_id=p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREORDER_NOT_FOUND'; END IF;
 IF p_expected_version IS NULL OR v_preorder.version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'PREORDER_VERSION_CONFLICT';
 END IF;
 IF v_preorder.status<>'draft' THEN RAISE EXCEPTION 'PREORDER_NOT_DRAFT'; END IF;

 SELECT * INTO v_item FROM public.preorder_items WHERE preorder_id=p_preorder_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREORDER_INPUT_INVALID'; END IF;
 SELECT * INTO v_capacity FROM public.production_capacity WHERE id=v_item.capacity_id FOR UPDATE;
 SELECT * INTO v_product FROM public.products WHERE id=v_item.product_id;
 SELECT * INTO v_business FROM public.businesses WHERE id=p_business_id;
 IF NOT v_product.is_active THEN RAISE EXCEPTION 'PREORDER_PRODUCT_INACTIVE'; END IF;
 IF v_preorder.starts_at>=v_preorder.ends_at OR v_preorder.ends_at>v_capacity.intake_cutoff_at
  OR v_capacity.intake_cutoff_at>=v_capacity.fulfillment_window_end_at OR v_preorder.ends_at<=now() THEN
  RAISE EXCEPTION 'PREORDER_SCHEDULE_INVALID';
 END IF;
 SELECT coalesce(sum(quantity),0) INTO v_committed_units FROM public.capacity_reservations
 WHERE capacity_id=v_capacity.id AND (state='allocated' OR (state='held' AND expires_at>now()));
 IF v_item.quota_units>v_capacity.total_units-v_committed_units THEN
  RAISE EXCEPTION 'PREORDER_QUOTA_OVER_CAPACITY';
 END IF;

 UPDATE public.preorder_items SET base_price_snapshot_idr=v_product.base_price_idr,
  product_name_snapshot=v_product.name,sku_snapshot=v_product.sku WHERE id=v_item.id;
 BEGIN
  UPDATE public.preorders SET status='published',published_at=now(),pickup_terms_snapshot=jsonb_build_object(
   'pickup_instructions',v_business.pickup_instructions,'public_contact',v_business.public_contact,
   'intake_cutoff_at',v_capacity.intake_cutoff_at,'fulfillment_window_end_at',v_capacity.fulfillment_window_end_at)
  WHERE id=p_preorder_id RETURNING * INTO v_preorder;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PREORDER_DATE_TAKEN';
 END;
 RETURN v_preorder;
END $$;
REVOKE ALL ON FUNCTION private.publish_preorder_canonical(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.publish_preorder(p_business_id uuid,p_preorder_id uuid,p_expected_version integer,p_actor_user_id uuid DEFAULT NULL)
RETURNS public.preorders LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 RETURN private.publish_preorder_canonical(p_business_id,p_preorder_id,p_expected_version);
END $$;

CREATE OR REPLACE FUNCTION public.publish_preorder(p_preorder_id uuid,p_expected_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM private.publish_preorder_canonical(private.current_owner_business(),p_preorder_id,p_expected_version);
END $$;

COMMIT;
