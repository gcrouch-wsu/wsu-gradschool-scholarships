-- Migration 006: Reviewer row attachments stored in private Blob

CREATE TABLE IF NOT EXISTS reviewer_row_files (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id            UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  smartsheet_row_id   BIGINT NOT NULL,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  blob_url            TEXT NOT NULL,
  blob_pathname       TEXT NOT NULL UNIQUE,
  original_filename   VARCHAR(255) NOT NULL,
  content_type        VARCHAR(100) NOT NULL,
  size_bytes          BIGINT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviewer_row_files_row ON reviewer_row_files(cycle_id, smartsheet_row_id);
CREATE INDEX idx_reviewer_row_files_user ON reviewer_row_files(uploaded_by_user_id);
