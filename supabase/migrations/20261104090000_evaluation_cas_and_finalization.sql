-- Slice 7B: append-only CAS uses the last evaluation UUID, without another revision column.
CREATE FUNCTION private.check_evaluation_sources(p_campaign_id uuid, p_context jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c public.campaigns; s jsonb:=p_context->'snapshot'; actual jsonb; expected jsonb; source_name text;
BEGIN
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=p_campaign_id;
 IF (s#>>'{campaign,id}')::uuid IS DISTINCT FROM c.id OR
    (s#>>'{campaign,business_id}')::uuid IS DISTINCT FROM c.business_id OR
    (s#>>'{campaign,preorder_id}')::uuid IS DISTINCT FROM c.preorder_id OR
    (s#>>'{campaign,version}')::integer IS DISTINCT FROM c.version OR
    s#>>'{campaign,status}' IS DISTINCT FROM c.status OR
    p_context->>'costsCompleteness' IS DISTINCT FROM c.costs_completeness OR
    NOT EXISTS(SELECT 1 FROM public.preorders p WHERE p.id=c.preorder_id AND
      p.id=(s#>>'{preorder,id}')::uuid AND p.version=(s#>>'{preorder,version}')::integer) OR
    NOT EXISTS(SELECT 1 FROM public.preorder_items i WHERE i.preorder_id=c.preorder_id AND
      i.id=(s#>>'{item,id}')::uuid AND i.version=(s#>>'{item,version}')::integer) OR
    NOT EXISTS(SELECT 1 FROM public.campaign_blueprints b WHERE b.id=c.published_blueprint_id AND
      b.id=(s#>>'{blueprint,id}')::uuid AND b.version=(s#>>'{blueprint,version}')::integer AND
      b.business_id=c.business_id AND b.campaign_id=c.id AND b.approval_status='approved') THEN
  RAISE EXCEPTION 'STALE_SOURCE_STATE' USING ERRCODE='40001';
 END IF;
 FOREACH source_name IN ARRAY ARRAY['campaign_tasks','campaign_contents','campaign_costs'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''id'',id,''version'',version) ORDER BY id),''[]''::jsonb) FROM public.%I WHERE campaign_id=$1',source_name)
   INTO actual USING c.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',(e->>'id')::uuid,'version',(e->>'version')::integer) ORDER BY (e->>'id')::uuid),'[]'::jsonb)
   INTO expected FROM jsonb_array_elements(CASE source_name WHEN 'campaign_tasks' THEN s->'tasks'
    WHEN 'campaign_contents' THEN s->'contents' ELSE p_context->'costs' END) e;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'STALE_SOURCE_STATE' USING ERRCODE='40001'; END IF;
 END LOOP;
END $$;

-- Direct service-role writers must participate too; finalization never locks child rows.
CREATE FUNCTION private.guard_evaluation_source_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c public.campaigns;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.business_id,NEW.campaign_id) IS DISTINCT FROM (OLD.business_id,OLD.campaign_id) THEN
  RAISE EXCEPTION 'SOURCE_BINDING_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=NEW.campaign_id FOR UPDATE;
 IF c.business_id IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'SOURCE_SCOPE_MISMATCH' USING ERRCODE='23514'; END IF;
 IF c.status='completed' THEN RAISE EXCEPTION 'COMPLETED_CAMPAIGN_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evaluation_source_guard BEFORE INSERT OR UPDATE ON public.campaign_costs
 FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_source_write();
CREATE TRIGGER evaluation_source_guard BEFORE INSERT OR UPDATE ON public.campaign_tasks
 FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_source_write();
CREATE TRIGGER evaluation_source_guard BEFORE INSERT OR UPDATE ON public.campaign_contents
 FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_source_write();
CREATE TRIGGER evaluation_source_guard BEFORE INSERT OR UPDATE ON public.campaign_blueprints
 FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_source_write();

CREATE FUNCTION private.guard_evaluation_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.campaigns; latest uuid; last_created timestamptz;
BEGIN
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=NEW.campaign_id FOR UPDATE;
 IF c.status='completed' THEN RAISE EXCEPTION 'COMPLETED_CAMPAIGN_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT id,created_at INTO latest,last_created FROM public.campaign_evaluations WHERE campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NEW.metrics_json ? 'cas' THEN
  IF (NEW.metrics_json#>>'{cas,expectedEvaluationId}')::uuid IS DISTINCT FROM latest THEN
   RAISE EXCEPTION 'STALE_EVALUATION_VERSION' USING ERRCODE='40001';
  END IF;
  PERFORM private.check_evaluation_sources(c.id,NEW.metrics_json->'context');
 END IF;
 -- Clock order is assigned under the parent lock, including legacy insert writers.
 NEW.created_at:=greatest(clock_timestamp(),last_created+interval '1 microsecond');
 NEW.evaluated_at:=NEW.created_at;
 RETURN NEW;
END $$;
CREATE TRIGGER evaluation_insert_guard BEFORE INSERT ON public.campaign_evaluations
 FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_insert();

CREATE FUNCTION public.record_campaign_evaluation_cas(p_business_id uuid,p_campaign_id uuid,p_blueprint_id uuid,
 p_evaluation_id uuid,p_expected_evaluation_id uuid,p_metrics jsonb,p_analysis jsonb,p_limitations jsonb,
 p_calculated_at timestamptz,p_actor_user_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.campaigns; prior public.campaign_evaluations; latest public.campaign_evaluations; m jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 PERFORM private.lock_campaign_context(p_campaign_id);
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=p_campaign_id AND business_id=p_business_id;
 SELECT * INTO prior FROM public.campaign_evaluations WHERE id=p_evaluation_id;
 IF FOUND THEN
  IF (prior.business_id,prior.campaign_id,prior.blueprint_id,prior.metrics_json->>'commandHash',prior.metrics_json#>>'{cas,expectedEvaluationId}') IS DISTINCT FROM
     (p_business_id,p_campaign_id,p_blueprint_id,p_metrics->>'commandHash',p_expected_evaluation_id::text) THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001';
  END IF;
  RETURN prior.id;
 END IF;
 IF c.status<>'closed' THEN RAISE EXCEPTION 'CLOSED_CAMPAIGN_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT * INTO latest FROM public.campaign_evaluations WHERE campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF latest.id IS DISTINCT FROM p_expected_evaluation_id THEN RAISE EXCEPTION 'STALE_EVALUATION_VERSION' USING ERRCODE='40001'; END IF;
 PERFORM private.check_evaluation_sources(c.id,p_metrics->'context');
 IF p_blueprint_id IS DISTINCT FROM c.published_blueprint_id OR p_metrics->>'commandHash' IS NULL OR p_metrics ? 'finalization' THEN
  RAISE EXCEPTION 'INVALID_EVALUATION' USING ERRCODE='23514';
 END IF;
 IF p_analysis#>>'{review,status}'='reviewed' THEN
  IF latest.id IS NULL OR (p_metrics->>'parentEvaluationId')::uuid IS DISTINCT FROM latest.id OR
     p_metrics->'context' IS DISTINCT FROM latest.metrics_json->'context' OR
     p_metrics->'summary' IS DISTINCT FROM latest.metrics_json->'summary' OR
     (p_analysis-'review') IS DISTINCT FROM (latest.analysis_json-'review') OR
     p_analysis#>>'{review,reviewedByUserId}' IS DISTINCT FROM p_actor_user_id::text OR
     latest.analysis_json->>'status' IS DISTINCT FROM 'available' OR
     latest.analysis_json#>>'{review,status}' IS DISTINCT FROM 'unreviewed' THEN
   RAISE EXCEPTION 'INVALID_EVALUATION_REVIEW' USING ERRCODE='23514';
  END IF;
 END IF;
 m:=p_metrics||jsonb_build_object('cas',jsonb_build_object('expectedEvaluationId',p_expected_evaluation_id));
 INSERT INTO public.campaign_evaluations(id,business_id,campaign_id,blueprint_id,metrics_schema_version,
  metrics_json,analysis_json,limitations_json,evaluation_kind,calculated_at,evaluated_at)
 VALUES(p_evaluation_id,p_business_id,p_campaign_id,p_blueprint_id,1,m,p_analysis,p_limitations,'provisional',p_calculated_at,clock_timestamp());
 RETURN p_evaluation_id;
END $$;

CREATE FUNCTION public.finalize_campaign_evaluation(p_business_id uuid,p_campaign_id uuid,p_preorder_id uuid,
 p_evaluation_id uuid,p_request_id uuid,p_expected_campaign_version integer,p_expected_context_hash text,
 p_mode text,p_actor_user_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.campaigns; e public.campaign_evaluations; prior public.campaign_evaluations; last_id uuid;
 completed timestamptz; audit jsonb; analytics jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 PERFORM private.lock_campaign_context(p_campaign_id);
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=p_campaign_id AND business_id=p_business_id AND preorder_id=p_preorder_id;
 SELECT * INTO prior FROM public.campaign_evaluations WHERE id=p_request_id;
 IF FOUND THEN
  audit:=prior.metrics_json->'finalization';
  IF prior.campaign_id IS DISTINCT FROM c.id OR prior.business_id IS DISTINCT FROM p_business_id OR
    audit->>'reviewedEvaluationId' IS DISTINCT FROM p_evaluation_id::text OR audit->>'mode' IS DISTINCT FROM p_mode OR
    (audit->>'expectedCampaignVersion')::integer IS DISTINCT FROM p_expected_campaign_version OR
    audit->>'sourceContextHash' IS DISTINCT FROM p_expected_context_hash OR audit->>'actorUserId' IS DISTINCT FROM p_actor_user_id::text OR
    c.status<>'completed' OR c.completed_at IS DISTINCT FROM (audit->>'completedAt')::timestamptz THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001';
  END IF;
  RETURN prior.id;
 END IF;
 IF c.status<>'closed' THEN RAISE EXCEPTION 'CLOSED_CAMPAIGN_REQUIRED' USING ERRCODE='23514'; END IF;
 IF c.version<>p_expected_campaign_version THEN RAISE EXCEPTION 'STALE_SOURCE_STATE' USING ERRCODE='40001'; END IF;
 SELECT * INTO e FROM public.campaign_evaluations WHERE id=p_evaluation_id AND campaign_id=c.id AND business_id=p_business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVALUATION_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT id INTO last_id FROM public.campaign_evaluations WHERE campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF last_id IS DISTINCT FROM e.id THEN RAISE EXCEPTION 'STALE_EVALUATION_VERSION' USING ERRCODE='40001'; END IF;
 IF e.analysis_json#>>'{review,status}' IS DISTINCT FROM 'reviewed' OR
    e.analysis_json#>>'{review,reviewedByUserId}' IS DISTINCT FROM p_actor_user_id::text OR NOT (e.metrics_json ? 'cas') THEN
  RAISE EXCEPTION 'OWNER_REVIEW_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF e.blueprint_id IS DISTINCT FROM c.published_blueprint_id OR c.baseline_json IS NULL OR c.closed_at IS NULL OR c.published_at IS NULL THEN
  RAISE EXCEPTION 'INVALID_EVALUATION' USING ERRCODE='23514';
 END IF;
 IF e.metrics_json#>>'{context,contextHash}' IS DISTINCT FROM p_expected_context_hash THEN RAISE EXCEPTION 'STALE_SOURCE_STATE' USING ERRCODE='40001'; END IF;
 PERFORM private.check_evaluation_sources(c.id,e.metrics_json->'context');
 IF c.costs_completeness<>'confirmed_complete' THEN RAISE EXCEPTION 'COSTS_INCOMPLETE' USING ERRCODE='23514'; END IF;
 analytics:=e.metrics_json#>'{context,analytics,data}';
 IF e.metrics_json#>>'{context,analytics,status}' IS DISTINCT FROM 'available' OR
    analytics->>'costsComplete' IS DISTINCT FROM 'true' OR analytics->>'operationallyResolved' IS DISTINCT FROM 'true' OR
    analytics#>>'{metrics,paidUnitsInWindow}' IS NULL OR analytics#>>'{metrics,scopedFulfilledSalesValueIdr}' IS NULL OR
    analytics#>>'{metrics,scopedProductionCostIncurredIdr}' IS NULL THEN
  RAISE EXCEPTION 'KPI_INCOMPLETE' USING ERRCODE='23514';
 END IF;
 -- No production C6 revision authority exists yet. A trusted development server may finish only an empty real cohort.
 IF p_mode IS DISTINCT FROM 'development_synthetic' OR analytics->>'provenance' IS DISTINCT FROM 'development_fixture' OR
    analytics->>'isProvisional' IS DISTINCT FROM 'true' OR analytics->'financialScopeOrderIds' IS DISTINCT FROM 'null'::jsonb OR
    e.analysis_json->>'synthetic' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'VERIFIED_C6_UNAVAILABLE' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE preorder_id=c.preorder_id) OR
    EXISTS(SELECT 1 FROM public.capacity_reservations r JOIN public.preorder_items i ON i.id=r.preorder_item_id WHERE i.preorder_id=c.preorder_id) THEN
  RAISE EXCEPTION 'SYNTHETIC_COHORT_REQUIRED' USING ERRCODE='23514';
 END IF;
 completed:=clock_timestamp();
 audit:=jsonb_build_object('mode',p_mode,'requestId',p_request_id,'reviewedEvaluationId',e.id,
  'expectedCampaignVersion',c.version,'completedCampaignVersion',c.version+1,'completedAt',completed,
  'actorUserId',p_actor_user_id,'sourceContextHash',p_expected_context_hash);
 INSERT INTO public.campaign_evaluations(id,business_id,campaign_id,blueprint_id,metrics_schema_version,metrics_json,
  analysis_json,limitations_json,evaluation_kind,calculated_at,evaluated_at)
 VALUES(p_request_id,p_business_id,c.id,e.blueprint_id,1,
  e.metrics_json||jsonb_build_object('parentEvaluationId',e.id,'cas',jsonb_build_object('expectedEvaluationId',e.id),'finalization',audit),
  e.analysis_json,e.limitations_json,'final',e.calculated_at,completed);
 UPDATE public.campaigns SET status='completed',completed_at=completed WHERE id=c.id;
 RETURN p_request_id;
END $$;

CREATE FUNCTION private.guard_campaign_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.status='completed' AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'COMPLETED_CAMPAIGN_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.status='completed' AND OLD.status<>'completed' AND (current_user<>'postgres' OR OLD.status<>'closed' OR NOT EXISTS(
  SELECT 1 FROM public.campaign_evaluations e WHERE e.campaign_id=OLD.id AND e.evaluation_kind='final' AND
   (e.metrics_json#>>'{finalization,expectedCampaignVersion}')::integer=OLD.version AND
   (e.metrics_json#>>'{finalization,completedAt}')::timestamptz=NEW.completed_at AND
   e.id=(SELECT id FROM public.campaign_evaluations WHERE campaign_id=OLD.id ORDER BY created_at DESC,id DESC LIMIT 1))) THEN
  RAISE EXCEPTION 'ATOMIC_FINALIZATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evaluation_completion_guard BEFORE UPDATE ON public.campaigns
 FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_completion();

REVOKE ALL ON FUNCTION private.check_evaluation_sources(uuid,jsonb),private.guard_evaluation_source_write(),
 private.guard_evaluation_insert(),private.guard_campaign_completion() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_campaign_evaluation_cas(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,timestamptz,uuid),
 public.finalize_campaign_evaluation(uuid,uuid,uuid,uuid,uuid,integer,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_campaign_evaluation_cas(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,timestamptz,uuid),
 public.finalize_campaign_evaluation(uuid,uuid,uuid,uuid,uuid,integer,text,text,uuid) TO service_role;
