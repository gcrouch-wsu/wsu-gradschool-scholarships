-- Smartsheet native attachment mirroring (intake file fields)

ALTER TABLE intake_form_fields
  ADD COLUMN IF NOT EXISTS push_to_smartsheet BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE intake_submission_files
  ADD COLUMN IF NOT EXISTS attachment_sync_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'
    CHECK (attachment_sync_status IN (
      'not_applicable', 'pending', 'syncing', 'synced',
      'retryable_failed', 'permanent_failed', 'deleted_from_blob'
    )),
  ADD COLUMN IF NOT EXISTS smartsheet_attachment_id BIGINT,
  ADD COLUMN IF NOT EXISTS smartsheet_attachment_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sync_attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_sync_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_error_json JSONB,
  ADD COLUMN IF NOT EXISTS blob_delete_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blob_deleted_at TIMESTAMPTZ;

ALTER TABLE intake_submissions
  ADD COLUMN IF NOT EXISTS attachment_sync_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'
    CHECK (attachment_sync_status IN (
      'not_applicable', 'pending', 'partial', 'synced', 'failed'
    ));

CREATE INDEX IF NOT EXISTS idx_intake_submission_files_sync_worker
  ON intake_submission_files (cycle_id, attachment_sync_status, next_sync_attempt_at)
  WHERE attachment_sync_status IN ('pending', 'retryable_failed');

CREATE INDEX IF NOT EXISTS idx_intake_submission_files_blob_cleanup
  ON intake_submission_files (blob_delete_after, blob_deleted_at)
  WHERE blob_delete_after IS NOT NULL AND blob_deleted_at IS NULL;

COMMENT ON COLUMN intake_submission_files.blob_delete_after IS 'Set only after successful Smartsheet sync; 24h retention before Blob delete.';

-- Aggregate sync status on parent submission (trigger-maintained)
CREATE OR REPLACE FUNCTION public.refresh_intake_submission_aggregate(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  mc int;
  pend int;
  syncd int;
  fail int;
  agg varchar(30);
BEGIN
  SELECT
    count(*) FILTER (WHERE attachment_sync_status <> 'not_applicable'),
    count(*) FILTER (WHERE attachment_sync_status IN ('pending', 'syncing', 'retryable_failed')),
    count(*) FILTER (WHERE attachment_sync_status IN ('synced', 'deleted_from_blob')),
    count(*) FILTER (WHERE attachment_sync_status = 'permanent_failed')
  INTO mc,  pend, syncd, fail
  FROM intake_submission_files
  WHERE submission_id = p_submission_id;

  IF mc = 0 THEN
    agg := 'not_applicable';
  ELSIF pend > 0 AND (syncd > 0 OR fail > 0) THEN
    agg := 'partial';
  ELSIF pend > 0 THEN
    agg := 'pending';
  ELSIF fail > 0 AND syncd > 0 THEN
    agg := 'partial';
  ELSIF fail = mc THEN
    agg := 'failed';
  ELSIF syncd = mc THEN
    agg := 'synced';
  ELSE
    agg := 'pending';
  END IF;

  UPDATE intake_submissions
  SET attachment_sync_status = agg, updated_at = now()
  WHERE submission_id = p_submission_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.intake_submission_files_touch_aggregate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    sid := OLD.submission_id;
  ELSE
    sid := NEW.submission_id;
  END IF;
  PERFORM public.refresh_intake_submission_aggregate(sid);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_intake_submission_files_aggregate ON intake_submission_files;
CREATE TRIGGER trg_intake_submission_files_aggregate
  AFTER INSERT OR UPDATE OR DELETE
  ON intake_submission_files
  FOR EACH ROW
  EXECUTE PROCEDURE public.intake_submission_files_touch_aggregate();

-- Backfill aggregates for existing rows (ALTER defaults do not fire triggers)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT submission_id FROM intake_submission_files
  LOOP
    PERFORM public.refresh_intake_submission_aggregate(r.submission_id);
  END LOOP;
END $$;
