-- Slice 8B: no new tables/columns, no verified-finalization or synthetic-approval bypass.
BEGIN;

CREATE FUNCTION private.check_memory_source(p_memory_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE m public.campaign_memories; c public.campaigns; e public.campaign_evaluations; ctx jsonb;
BEGIN
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id;
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=m.campaign_id AND business_id=m.business_id;
 SELECT * INTO STRICT e FROM public.campaign_evaluations WHERE id=m.source_evaluation_id AND business_id=m.business_id AND campaign_id=c.id;
 IF e.metrics_json#>>'{finalization,mode}'='development_synthetic' OR
    m.lessons_json#>>'{source,synthetic}'='true' THEN
  RAISE EXCEPTION 'SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 IF c.status<>'completed' OR e.evaluation_kind<>'final' OR
    e.id IS DISTINCT FROM (SELECT id FROM public.campaign_evaluations WHERE campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) OR
    e.analysis_json#>>'{review,status}' IS DISTINCT FROM 'reviewed' OR
    e.analysis_json->>'status' IS DISTINCT FROM 'available' THEN
  RAISE EXCEPTION 'ELIGIBLE_COMPLETED_EVALUATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF m.source_blueprint_id IS DISTINCT FROM c.published_blueprint_id OR e.blueprint_id IS DISTINCT FROM c.published_blueprint_id OR
    m.source_version IS DISTINCT FROM c.version OR
    (e.metrics_json#>>'{finalization,completedCampaignVersion}')::integer IS DISTINCT FROM c.version OR
    (e.metrics_json#>>'{finalization,completedAt}')::timestamptz IS DISTINCT FROM c.completed_at OR
    m.lessons_json#>>'{source,contextHash}' IS DISTINCT FROM e.metrics_json#>>'{finalization,sourceContextHash}' OR
    m.lessons_json#>>'{source,contextHash}' IS DISTINCT FROM e.metrics_json#>>'{context,contextHash}' OR
    m.lessons_json#>>'{source,evaluationId}' IS DISTINCT FROM e.id::text OR
    m.lessons_json#>>'{source,campaignId}' IS DISTINCT FROM c.id::text OR
    m.lessons_json#>>'{source,businessId}' IS DISTINCT FROM c.business_id::text OR
    (m.lessons_json#>>'{source,sourceVersion}')::integer IS DISTINCT FROM m.source_version OR
    m.lessons_json#>'{source,results}' IS DISTINCT FROM e.metrics_json->'summary' THEN
  RAISE EXCEPTION 'STALE_MEMORY_SOURCE' USING ERRCODE='40001';
 END IF;
 ctx:=jsonb_set(jsonb_set(e.metrics_json->'context','{snapshot,campaign,version}',to_jsonb(c.version)),
  '{snapshot,campaign,status}',to_jsonb(c.status));
 PERFORM private.check_evaluation_sources(c.id,ctx);
 -- shortcut: no authoritative verified C6/finalization producer exists; replace only with its separately approved contract.
 RAISE EXCEPTION 'VERIFIED_C6_UNAVAILABLE' USING ERRCODE='23514';
END $$;

-- Invoker-only transition primitive; only the validated definer wrapper can reach it in the application.
CREATE FUNCTION private.approve_memory_and_enqueue(p_business_id uuid,p_memory_id uuid,p_content_hash text,
 p_model text,p_profile text,p_actor_user_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE m public.campaign_memories; j public.job_runs; k text;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id FOR UPDATE;
 IF m.content_hash IS DISTINCT FROM p_content_hash OR p_content_hash !~ '^[a-f0-9]{64}$' OR
    p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 128 OR p_profile IS NULL OR length(p_profile) NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'MEMORY_SOURCE_CONFLICT' USING ERRCODE='40001';
 END IF;
 IF m.lessons_json#>>'{ownerReview,decision}' IS DISTINCT FROM 'reviewed' OR
    m.lessons_json#>>'{ownerReview,ownerUserId}' IS DISTINCT FROM p_actor_user_id::text OR
    m.lessons_json#>>'{ownerReview,requestId}' IS NULL OR m.lessons_json#>>'{ownerReview,reviewedAt}' IS NULL THEN
  RAISE EXCEPTION 'MEMORY_OWNER_REVIEW_REQUIRED' USING ERRCODE='23514';
 END IF;
 k:=jsonb_build_array(m.id,m.embedding_version,m.content_hash,p_model,p_profile)::text;
 IF m.review_status='approved' THEN
  IF m.embedding_model IS DISTINCT FROM p_model OR m.embedding_profile IS DISTINCT FROM p_profile THEN
   RAISE EXCEPTION 'PROFILE_CHANGE_REQUIRES_REVIEWED_VERSION' USING ERRCODE='40001';
  END IF;
  SELECT * INTO STRICT j FROM public.job_runs WHERE job_type='embed_memory' AND dedupe_key=k;
  IF (j.entity_id,j.business_id) IS DISTINCT FROM (m.id,m.business_id) THEN
   RAISE EXCEPTION 'MEMORY_JOB_BINDING_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN j.id;
 END IF;
 IF m.review_status<>'draft' OR m.embedding_status<>'queued' OR m.embedding IS NOT NULL THEN
  RAISE EXCEPTION 'MEMORY_SOURCE_CONFLICT' USING ERRCODE='40001';
 END IF;
 UPDATE public.campaign_memories SET review_status='approved',approved_at=clock_timestamp(),
  embedding_model=p_model,embedding_profile=p_profile WHERE id=m.id;
 INSERT INTO public.job_runs(job_type,entity_id,business_id,dedupe_key,status,attempt_count,next_run_at)
 VALUES('embed_memory',m.id,m.business_id,k,'queued',0,clock_timestamp()) ON CONFLICT(job_type,dedupe_key) DO NOTHING;
 SELECT * INTO STRICT j FROM public.job_runs WHERE job_type='embed_memory' AND dedupe_key=k;
 IF (j.entity_id,j.business_id) IS DISTINCT FROM (m.id,m.business_id) THEN
  RAISE EXCEPTION 'MEMORY_JOB_BINDING_MISMATCH' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.domain_events(business_id,entity_type,entity_id,command_key,event_type,actor_type,actor_user_id,safe_details_json,occurred_at)
 VALUES(m.business_id,'campaign_memory',m.id,k,'memory_approved','owner',p_actor_user_id,
  jsonb_build_object('contentHash',m.content_hash,'sourceEvaluationId',m.source_evaluation_id,'sourceVersion',m.source_version,'jobId',j.id),clock_timestamp());
 RETURN j.id;
END $$;

CREATE OR REPLACE FUNCTION public.approve_campaign_memory(p_business_id uuid,p_memory_id uuid,p_content_hash text,
 p_model text,p_profile text,p_actor_user_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.campaign_memories;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id;
 PERFORM private.lock_campaign_context(m.campaign_id);
 PERFORM 1 FROM public.campaign_memories WHERE id=m.id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_memories WHERE id=m.id AND content_hash=p_content_hash) THEN
  RAISE EXCEPTION 'MEMORY_SOURCE_CONFLICT' USING ERRCODE='40001';
 END IF;
 PERFORM private.check_memory_source(m.id);
 RETURN private.approve_memory_and_enqueue(p_business_id,m.id,p_content_hash,p_model,p_profile,p_actor_user_id);
END $$;

CREATE FUNCTION public.claim_memory_jobs(p_business_id uuid,p_model text,p_profile text,p_embedding_version integer,
 p_limit integer DEFAULT 5,p_lease_seconds integer DEFAULT 60,p_max_attempts integer DEFAULT 5)
RETURNS SETOF public.job_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF p_business_id IS NULL OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 128 OR
    p_profile IS NULL OR length(p_profile) NOT BETWEEN 1 AND 128 OR p_embedding_version IS NULL OR p_embedding_version<1 OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 300 OR
    p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION 'INVALID_JOB_CLAIM' USING ERRCODE='22023';
 END IF;
 -- Never wait on another claimant while expiring exhausted jobs.
 WITH exhausted AS (SELECT j.id FROM public.job_runs j WHERE j.business_id=p_business_id AND j.job_type='embed_memory'
  AND j.attempt_count>=p_max_attempts AND (j.status IN ('queued','retryable_failed') OR (j.status='running' AND j.locked_until<clock_timestamp()))
  FOR UPDATE SKIP LOCKED)
 UPDATE public.job_runs j SET status='dead',locked_until=NULL,finished_at=clock_timestamp(),last_error_code='MAX_ATTEMPTS'
 FROM exhausted x WHERE j.id=x.id;
 RETURN QUERY WITH picked AS (
  SELECT j.id FROM public.job_runs j JOIN public.campaign_memories m ON m.id=j.entity_id AND m.business_id=j.business_id
  WHERE j.business_id=p_business_id AND j.job_type='embed_memory' AND m.review_status='approved'
   AND m.embedding_status IN ('queued','failed','ready') AND m.embedding_model=p_model AND m.embedding_profile=p_profile
   AND m.embedding_version=p_embedding_version AND j.dedupe_key=jsonb_build_array(m.id,m.embedding_version,m.content_hash,p_model,p_profile)::text
   AND j.attempt_count<p_max_attempts AND j.next_run_at<=clock_timestamp() AND
    (j.status IN ('queued','retryable_failed') OR (j.status='running' AND j.locked_until<clock_timestamp()))
  ORDER BY j.next_run_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT p_limit
 ) UPDATE public.job_runs j SET status='running',attempt_count=j.attempt_count+1,
  locked_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),finished_at=NULL
 FROM picked x WHERE j.id=x.id RETURNING j.*;
END $$;

CREATE FUNCTION private.finish_memory_index_job(p_business_id uuid,p_job_id uuid,p_attempt_count integer,p_memory_id uuid,
 p_content_hash text,p_embedding_version integer,p_model text,p_profile text,p_embedding extensions.vector,
 p_error_code text,p_max_attempts integer) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE m public.campaign_memories; j public.job_runs; k text;
BEGIN
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id FOR UPDATE;
 SELECT * INTO STRICT j FROM public.job_runs WHERE id=p_job_id AND business_id=p_business_id AND job_type='embed_memory' FOR UPDATE;
 k:=jsonb_build_array(m.id,p_embedding_version,p_content_hash,p_model,p_profile)::text;
 IF j.entity_id IS DISTINCT FROM m.id OR j.dedupe_key IS DISTINCT FROM k OR
    (m.content_hash,m.embedding_version,m.embedding_model,m.embedding_profile,m.review_status) IS DISTINCT FROM
    (p_content_hash,p_embedding_version,p_model,p_profile,'approved'::text) THEN
  RAISE EXCEPTION 'STALE_EMBEDDING_JOB' USING ERRCODE='40001';
 END IF;
 IF p_error_code IS NULL AND j.status='succeeded' AND j.attempt_count=p_attempt_count AND j.provider_reference=p_content_hash AND
    m.embedding_status='ready' AND m.embedding IS NOT NULL THEN RETURN; END IF;
 IF j.status<>'running' OR p_attempt_count IS NULL OR j.attempt_count<>p_attempt_count OR
    j.locked_until IS NULL OR j.locked_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'STALE_JOB_LEASE' USING ERRCODE='40001';
 END IF;
 IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 OR
    (p_error_code IS NOT NULL AND (p_error_code !~ '^[A-Z_]{1,64}$' OR p_embedding IS NOT NULL)) THEN
  RAISE EXCEPTION 'INVALID_MEMORY_JOB_RESULT' USING ERRCODE='22023';
 END IF;
 IF p_error_code IS NOT NULL THEN
  UPDATE public.campaign_memories SET embedding_status='failed' WHERE id=m.id AND embedding_status IN ('queued','failed');
  UPDATE public.job_runs SET status=CASE WHEN attempt_count>=p_max_attempts THEN 'dead' ELSE 'retryable_failed' END,
   locked_until=NULL,last_error_code=p_error_code,provider_reference=NULL,
   finished_at=CASE WHEN attempt_count>=p_max_attempts THEN clock_timestamp() ELSE NULL END,
   next_run_at=clock_timestamp()+interval '30 seconds' WHERE id=j.id;
  RETURN;
 END IF;
 -- pgvector itself rejects NaN/Infinity on input; the norm additionally rejects zero/overflow.
 IF p_embedding IS NULL OR extensions.vector_dims(p_embedding)<>768 OR
    NOT (extensions.vector_norm(p_embedding)>0 AND extensions.vector_norm(p_embedding)<'Infinity'::float8) THEN
  RAISE EXCEPTION 'INVALID_EMBEDDING' USING ERRCODE='22023';
 END IF;
 IF m.embedding_status NOT IN ('queued','failed','ready') THEN RAISE EXCEPTION 'STALE_EMBEDDING_JOB' USING ERRCODE='40001'; END IF;
 IF m.embedding_status<>'ready' THEN
  UPDATE public.campaign_memories SET embedding=p_embedding,embedding_status='ready',indexed_at=clock_timestamp() WHERE id=m.id;
 END IF;
 UPDATE public.job_runs SET status='succeeded',locked_until=NULL,finished_at=clock_timestamp(),last_error_code=NULL,
  provider_reference=p_content_hash WHERE id=j.id;
END $$;

CREATE FUNCTION public.complete_memory_index_job(p_business_id uuid,p_job_id uuid,p_attempt_count integer,p_memory_id uuid,
 p_content_hash text,p_embedding_version integer,p_model text,p_profile text,p_embedding extensions.vector DEFAULT NULL,
 p_error_code text DEFAULT NULL,p_max_attempts integer DEFAULT 5) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.campaign_memories;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id;
 PERFORM private.lock_campaign_context(m.campaign_id);
 PERFORM 1 FROM public.campaign_memories WHERE id=m.id FOR UPDATE;
 IF p_error_code IS NULL THEN PERFORM private.check_memory_source(m.id); END IF;
 PERFORM private.finish_memory_index_job(p_business_id,p_job_id,p_attempt_count,p_memory_id,p_content_hash,
  p_embedding_version,p_model,p_profile,p_embedding,p_error_code,p_max_attempts);
END $$;

-- Preserve unrelated job completion while sealing the legacy independent memory acknowledgement.
CREATE OR REPLACE FUNCTION public.finish_job(p_job_id uuid,p_attempt_count integer,p_success boolean,p_error_code text DEFAULT NULL,p_provider_reference text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.job_runs WHERE id=p_job_id AND job_type='embed_memory') THEN
  RAISE EXCEPTION 'ATOMIC_MEMORY_INDEXING_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z_]{1,64}$' THEN RAISE EXCEPTION 'SAFE_ERROR_CODE_REQUIRED' USING ERRCODE='22023'; END IF;
 IF p_success AND EXISTS(SELECT 1 FROM public.job_runs WHERE id=p_job_id AND status='succeeded' AND attempt_count=p_attempt_count
  AND provider_reference IS NOT DISTINCT FROM p_provider_reference) THEN RETURN; END IF;
 UPDATE public.job_runs SET status=CASE WHEN p_success THEN 'succeeded' ELSE 'retryable_failed' END,
  finished_at=CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,locked_until=NULL,last_error_code=p_error_code,
  provider_reference=p_provider_reference,next_run_at=clock_timestamp()+interval '30 seconds'
 WHERE id=p_job_id AND status='running' AND attempt_count=p_attempt_count AND locked_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB_LEASE' USING ERRCODE='40001'; END IF;
END $$;

CREATE FUNCTION private.guard_memory_pipeline() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 -- Keep the existing synthetic error even for a direct privileged attempt.
 IF NEW.review_status='approved' AND EXISTS(SELECT 1 FROM public.campaign_evaluations e WHERE e.id=NEW.source_evaluation_id
  AND e.metrics_json#>>'{finalization,mode}'='development_synthetic') THEN
  RAISE EXCEPTION 'SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 IF current_user<>'postgres' AND (NEW.review_status='approved' OR NEW.embedding IS NOT NULL OR NEW.embedding_status='ready') THEN
  RAISE EXCEPTION 'ATOMIC_MEMORY_INDEXING_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.review_status='approved' AND NEW.review_status<>'approved' THEN
  RAISE EXCEPTION 'APPROVED_MEMORY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER memory_pipeline_guard BEFORE INSERT OR UPDATE ON public.campaign_memories
 FOR EACH ROW EXECUTE FUNCTION private.guard_memory_pipeline();

CREATE FUNCTION private.guard_memory_job() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.job_type='embed_memory' AND
    (NEW.job_type,NEW.entity_id,NEW.business_id,NEW.dedupe_key) IS DISTINCT FROM
    (OLD.job_type,OLD.entity_id,OLD.business_id,OLD.dedupe_key) THEN
  RAISE EXCEPTION 'MEMORY_JOB_BINDING_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF NEW.job_type='embed_memory' AND current_user<>'postgres' THEN
  RAISE EXCEPTION 'ATOMIC_MEMORY_INDEXING_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER memory_job_guard BEFORE INSERT OR UPDATE ON public.job_runs
 FOR EACH ROW EXECUTE FUNCTION private.guard_memory_job();

REVOKE ALL ON FUNCTION private.check_memory_source(uuid),private.approve_memory_and_enqueue(uuid,uuid,text,text,text,uuid),
 private.finish_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector,text,integer),private.guard_memory_pipeline(),private.guard_memory_job()
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.approve_campaign_memory(uuid,uuid,text,text,text,uuid),
 public.claim_memory_jobs(uuid,text,text,integer,integer,integer,integer),
 public.complete_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector,text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_campaign_memory(uuid,uuid,text,text,text,uuid),
 public.claim_memory_jobs(uuid,text,text,integer,integer,integer,integer),
 public.complete_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.complete_memory_indexing(uuid,text,integer,text,text,extensions.vector) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
