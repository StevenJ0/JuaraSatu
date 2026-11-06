-- Explicitly authorized Slice 5 addition: sourced draft + initial blueprint, no new table/column.
BEGIN;
CREATE FUNCTION public.create_campaign_with_initial_blueprint(
 p_business_id uuid,p_preorder_id uuid,p_campaign_id uuid,p_blueprint_id uuid,p_draft jsonb,
 p_blueprint_json jsonb,p_context_hash text,p_source_generation_id uuid,p_expected_source_versions jsonb,p_actor_user_id uuid)
RETURNS public.campaign_blueprints LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.preorder_items; cap public.production_capacity; po public.preorders; prod public.products;
 existing public.campaign_blueprints; camp public.campaigns; generation public.ai_generations; result public.campaign_blueprints; k text; facts jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 IF p_draft IS DISTINCT FROM jsonb_build_object('name',p_blueprint_json->>'campaignTitle','slug','campaign-'||p_campaign_id::text,
  'offerType',p_blueprint_json#>>'{offer,type}','marketingApproach',p_blueprint_json->>'marketingApproach',
  'discountBps',p_blueprint_json#>'{offer,discountBps}','budgetCapIdr',p_blueprint_json->'budgetCapIdr',
  'targetAdditionalUnits',p_blueprint_json->'targetAdditionalUnits','startsAt',p_blueprint_json#>>'{executionWindow,startsAt}',
  'endsAt',p_blueprint_json#>>'{executionWindow,endsAt}') OR p_expected_source_versions IS DISTINCT FROM p_blueprint_json->'sourceVersions' THEN
  RAISE EXCEPTION 'DRAFT_BLUEPRINT_MISMATCH' USING ERRCODE='23514'; END IF;
 -- One serialization key for the command, before checking whether an earlier attempt committed.
 PERFORM pg_advisory_xact_lock(hashtextextended('create-campaign:'||p_campaign_id::text,0));
 SELECT * INTO existing FROM public.campaign_blueprints WHERE id=p_blueprint_id;
 IF FOUND THEN
  IF existing.business_id IS DISTINCT FROM p_business_id OR existing.campaign_id IS DISTINCT FROM p_campaign_id OR
   existing.source_ai_generation_id IS DISTINCT FROM p_source_generation_id OR existing.blueprint_json IS DISTINCT FROM p_blueprint_json OR
   existing.context_hash IS DISTINCT FROM p_context_hash OR existing.blueprint_json->>'preorderId' IS DISTINCT FROM p_preorder_id::text THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN existing;
 END IF;
 IF EXISTS(SELECT 1 FROM public.campaigns WHERE id=p_campaign_id) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE preorder_id=p_preorder_id AND business_id=p_business_id;
 SELECT * INTO STRICT cap FROM public.production_capacity WHERE id=item.capacity_id FOR UPDATE;
 SELECT * INTO STRICT po FROM public.preorders WHERE id=p_preorder_id AND business_id=p_business_id FOR UPDATE;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE id=item.id FOR UPDATE;
 SELECT * INTO STRICT prod FROM public.products WHERE id=item.product_id FOR UPDATE;
 facts:=jsonb_build_object('capacityVersion',cap.version,'preorderVersion',po.version,'preorderItemVersion',item.version,'productVersion',prod.version);
 FOREACH k IN ARRAY ARRAY['capacityVersion','preorderVersion','preorderItemVersion','productVersion'] LOOP
  IF facts->>k IS DISTINCT FROM p_expected_source_versions->>k THEN RAISE EXCEPTION 'STALE_FACT_VERSIONS' USING ERRCODE='40001'; END IF;
 END LOOP;
 IF po.status<>'published' OR po.ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'PREORDER_NOT_PUBLISHABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT generation FROM public.ai_generations WHERE id=p_source_generation_id AND business_id=p_business_id AND preorder_id=p_preorder_id;
 IF generation.status<>'success' OR generation.session_id IS NULL OR generation.campaign_id IS NOT NULL OR
  p_blueprint_json->>'businessId' IS DISTINCT FROM p_business_id::text OR p_blueprint_json->>'campaignId' IS DISTINCT FROM p_campaign_id::text OR
  p_blueprint_json->>'preorderId' IS DISTINCT FROM p_preorder_id::text OR p_blueprint_json->>'contextHash' IS DISTINCT FROM p_context_hash OR
  p_blueprint_json#>>'{source,generationId}' IS DISTINCT FROM generation.id::text OR
  p_blueprint_json#>>'{source,sessionId}' IS DISTINCT FROM generation.session_id::text OR
  p_blueprint_json#>>'{source,proposalVersion}' IS DISTINCT FROM generation.output_json->>'proposalVersion' OR
  generation.output_json->>'contextHash' IS DISTINCT FROM p_context_hash OR generation.output_json->>'persistence' IS DISTINCT FROM 'saved' OR
  p_blueprint_json->>'blueprintVersion' IS DISTINCT FROM '1' OR p_blueprint_json->>'schemaVersion' IS DISTINCT FROM '1' OR
  p_blueprint_json#>>'{revision,requestId}' IS DISTINCT FROM p_blueprint_id::text OR
  p_blueprint_json#>>'{revision,parentBlueprintId}' IS NOT NULL OR p_blueprint_json#>>'{revision,parentVersion}' IS NOT NULL OR
  coalesce(p_blueprint_json#>>'{revision,requestHash}','') !~ '^[a-f0-9]{64}$' OR
  NOT EXISTS(SELECT 1 FROM public.campaign_ai_messages m WHERE m.ai_generation_id=generation.id AND m.role='assistant'
   AND m.business_id=p_business_id AND m.session_id=generation.session_id AND m.id::text=p_blueprint_json#>>'{source,messageId}'
   AND m.proposal_json=generation.output_json) OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(generation.output_json->'options') o WHERE o->>'proposalKey'=p_blueprint_json#>>'{source,proposalKey}') THEN
  RAISE EXCEPTION 'GENERATION_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 -- Existing RPCs run under this same PostgreSQL transaction; any failure rolls everything back.
 camp:=public.save_campaign_draft(p_business_id,p_campaign_id,p_preorder_id,NULL,p_draft,p_actor_user_id);
 -- Validate the child plan before storing it; any child failure also rolls the new parent back.
 IF jsonb_typeof(p_blueprint_json->'tasks') IS DISTINCT FROM 'array' OR jsonb_typeof(p_blueprint_json->'contents') IS DISTINCT FROM 'array' OR
  jsonb_array_length(p_blueprint_json->'tasks') NOT BETWEEN 1 AND 12 OR jsonb_array_length(p_blueprint_json->'contents') NOT BETWEEN 1 AND 8 THEN
  RAISE EXCEPTION 'BLUEPRINT_CONTENT_BOUNDS' USING ERRCODE='23514'; END IF;
 result:=public.save_blueprint_revision(p_business_id,p_campaign_id,camp.version,p_blueprint_id,p_context_hash,p_blueprint_json,p_source_generation_id,p_actor_user_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_campaign_with_initial_blueprint(uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_campaign_with_initial_blueprint(uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid,jsonb,uuid) TO service_role;
COMMIT;
