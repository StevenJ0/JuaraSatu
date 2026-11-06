-- Reject even no-op updates before touch_row can advance the sealed campaign revision.
CREATE OR REPLACE FUNCTION private.guard_campaign_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.status='completed' THEN
  RAISE EXCEPTION 'COMPLETED_CAMPAIGN_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.status='completed' AND (current_user<>'postgres' OR OLD.status<>'closed' OR NOT EXISTS(
  SELECT 1 FROM public.campaign_evaluations e WHERE e.campaign_id=OLD.id AND e.evaluation_kind='final' AND
   (e.metrics_json#>>'{finalization,expectedCampaignVersion}')::integer=OLD.version AND
   (e.metrics_json#>>'{finalization,completedAt}')::timestamptz=NEW.completed_at AND
   e.id=(SELECT id FROM public.campaign_evaluations WHERE campaign_id=OLD.id ORDER BY created_at DESC,id DESC LIMIT 1))) THEN
  RAISE EXCEPTION 'ATOMIC_FINALIZATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
