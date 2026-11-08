-- PM06: generic workers declare core types; Memory uses its dedicated claim transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 60,p_max_attempts integer DEFAULT 5)
RETURNS SETOF public.job_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'TYPED_JOB_CLAIM_REQUIRED' USING ERRCODE='0A000';
END $$;

CREATE OR REPLACE FUNCTION public.claim_jobs(p_job_types text[],p_limit integer,p_lease_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_max_attempts constant integer := 5;
 v_claimed jsonb;
BEGIN
 IF coalesce(cardinality(p_job_types),0)=0 OR EXISTS (
  SELECT 1 FROM unnest(p_job_types) AS requested(job_type)
  WHERE requested.job_type IS NULL OR requested.job_type NOT IN ('expire','reconcile','send_paid_email')
 ) OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
   OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 3600 THEN
  RAISE EXCEPTION 'VALIDATION_ERROR';
 END IF;

 -- Exhaustion must neither wait on another worker nor touch another queue.
 WITH exhausted AS (
  SELECT job.id FROM public.job_runs AS job
  WHERE job.job_type=ANY(p_job_types) AND job.attempt_count>=v_max_attempts
   AND (job.status IN ('queued','retryable_failed') OR (job.status='running' AND job.locked_until<=clock_timestamp()))
  FOR UPDATE SKIP LOCKED
 )
 UPDATE public.job_runs AS job
 SET status='dead',finished_at=clock_timestamp(),locked_until=NULL,last_error_code=coalesce(job.last_error_code,'LEASE_EXPIRED')
 FROM exhausted WHERE job.id=exhausted.id;

 WITH ready AS (
  SELECT job.id FROM public.job_runs AS job
  WHERE job.job_type=ANY(p_job_types) AND job.attempt_count<v_max_attempts AND job.next_run_at<=clock_timestamp()
   AND (job.status IN ('queued','retryable_failed') OR (job.status='running' AND job.locked_until<=clock_timestamp()))
  ORDER BY job.next_run_at,job.created_at,job.id
  FOR UPDATE SKIP LOCKED LIMIT p_limit
 ), claimed AS (
  UPDATE public.job_runs AS job
  SET status='running',attempt_count=job.attempt_count+1,locked_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),finished_at=NULL
  FROM ready WHERE job.id=ready.id
  RETURNING job.id,job.job_type,job.entity_id,job.business_id,job.attempt_count
 )
 SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_claimed FROM claimed;
 RETURN v_claimed;
END $$;

COMMIT;
