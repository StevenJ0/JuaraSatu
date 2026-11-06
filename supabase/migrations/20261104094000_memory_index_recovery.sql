-- Slice 8B recovery: reuse a committed same-key vector; exhaustion stays profile scoped.
BEGIN;

CREATE OR REPLACE FUNCTION private.finish_memory_index_job(p_business_id uuid,p_job_id uuid,p_attempt_count integer,p_memory_id uuid,
 p_content_hash text,p_embedding_version integer,p_model text,p_profile text,p_embedding extensions.vector,
 p_error_code text,p_max_attempts integer) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE m public.campaign_memories; j public.job_runs; k text; effective_embedding extensions.vector;
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
 effective_embedding:=coalesce(p_embedding,CASE WHEN m.embedding_status='ready' THEN m.embedding END);
 IF effective_embedding IS NULL OR extensions.vector_dims(effective_embedding)<>768 OR
    NOT (extensions.vector_norm(effective_embedding)>0 AND extensions.vector_norm(effective_embedding)<'Infinity'::float8) THEN
  RAISE EXCEPTION 'INVALID_EMBEDDING' USING ERRCODE='22023';
 END IF;
 IF m.embedding_status NOT IN ('queued','failed','ready') THEN RAISE EXCEPTION 'STALE_EMBEDDING_JOB' USING ERRCODE='40001'; END IF;
 IF m.embedding_status<>'ready' THEN
  UPDATE public.campaign_memories SET embedding=p_embedding,embedding_status='ready',indexed_at=clock_timestamp() WHERE id=m.id;
 END IF;
 UPDATE public.job_runs SET status='succeeded',locked_until=NULL,finished_at=clock_timestamp(),last_error_code=NULL,
  provider_reference=p_content_hash WHERE id=j.id;
END $$;

CREATE OR REPLACE FUNCTION public.claim_memory_jobs(p_business_id uuid,p_model text,p_profile text,p_embedding_version integer,
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
 WITH exhausted AS (SELECT j.id FROM public.job_runs j JOIN public.campaign_memories m ON m.id=j.entity_id AND m.business_id=j.business_id WHERE j.business_id=p_business_id AND j.job_type='embed_memory' AND m.embedding_model=p_model AND m.embedding_profile=p_profile AND m.embedding_version=p_embedding_version
  AND j.attempt_count>=p_max_attempts AND (j.status IN ('queued','retryable_failed') OR (j.status='running' AND j.locked_until<clock_timestamp()))
  FOR UPDATE OF j SKIP LOCKED)
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

COMMIT;
