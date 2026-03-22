-- Migration 005: Intake Form Feature

-- 6.1 intake_forms
CREATE TABLE IF NOT EXISTS intake_forms (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id                  UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  title                     VARCHAR(255) NOT NULL,
  instructions_text         TEXT,
  status                    VARCHAR(20) NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'published', 'unpublished', 'invalid')),
  opens_at                  TIMESTAMPTZ,
  closes_at                  TIMESTAMPTZ,
  published_version_id      UUID, -- Will be set after first publish
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cycle_id)
);

CREATE INDEX idx_intake_forms_cycle ON intake_forms(cycle_id);

-- 6.2 intake_form_fields (Draft builder rows)
CREATE TABLE IF NOT EXISTS intake_form_fields (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_form_id       UUID NOT NULL REFERENCES intake_forms(id) ON DELETE CASCADE,
  field_key            VARCHAR(100) NOT NULL,
  label                VARCHAR(255) NOT NULL,
  help_text            TEXT,
  field_type           VARCHAR(50) NOT NULL, -- short_text, long_text, email, number, select, checkbox, date, file
  required             BOOLEAN NOT NULL DEFAULT false,
  sort_order           INT NOT NULL DEFAULT 0,
  target_column_id     BIGINT,
  target_column_title  VARCHAR(255),
  target_column_type   VARCHAR(50),
  settings_json        JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(intake_form_id, field_key)
);

CREATE INDEX idx_intake_form_fields_form ON intake_form_fields(intake_form_id);

-- 6.3 intake_form_versions (Immutable snapshots)
CREATE TABLE IF NOT EXISTS intake_form_versions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_form_id       UUID NOT NULL REFERENCES intake_forms(id) ON DELETE CASCADE,
  version_number       INT NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'published', 'superseded')),
  snapshot_json        JSONB NOT NULL,
  created_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at         TIMESTAMPTZ
);

CREATE INDEX idx_intake_form_versions_form ON intake_form_versions(intake_form_id);

-- 6.4 intake_submissions
CREATE TABLE IF NOT EXISTS intake_submissions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id             UUID NOT NULL UNIQUE, -- Stable ID from client
  cycle_id                  UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  intake_form_id            UUID NOT NULL REFERENCES intake_forms(id) ON DELETE CASCADE,
  intake_form_version_id    UUID REFERENCES intake_form_versions(id) ON DELETE SET NULL,
  submitter_email           VARCHAR(255),
  status                    VARCHAR(20) NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'processing', 'row_created', 'completed', 'failed', 'rate_limited', 'invalid_schema')),
  smartsheet_row_id         BIGINT,
  request_cells_json        JSONB,
  request_files_json        JSONB,
  failure_json              JSONB,
  ip_hash                   VARCHAR(64) NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at              TIMESTAMPTZ
);

CREATE INDEX idx_intake_submissions_submission_id ON intake_submissions(submission_id);
CREATE INDEX idx_intake_submissions_cycle ON intake_submissions(cycle_id);
CREATE INDEX idx_intake_submissions_form ON intake_submissions(intake_form_id);
CREATE INDEX idx_intake_submissions_ip ON intake_submissions(ip_hash);

-- 6.5 intake_submission_files
CREATE TABLE IF NOT EXISTS intake_submission_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     UUID NOT NULL REFERENCES intake_submissions(submission_id) ON DELETE CASCADE,
  cycle_id          UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  field_key         VARCHAR(100) NOT NULL,
  blob_url          TEXT NOT NULL,
  blob_pathname     TEXT NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  content_type      VARCHAR(100) NOT NULL,
  size_bytes        BIGINT NOT NULL,
  smartsheet_row_id BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_intake_submission_files_submission ON intake_submission_files(submission_id);
CREATE INDEX idx_intake_submission_files_row ON intake_submission_files(cycle_id, smartsheet_row_id);

-- 6.6 intake_rate_limit_events
CREATE TABLE IF NOT EXISTS intake_rate_limit_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id          UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  route_key         VARCHAR(50) NOT NULL,
  ip_hash           VARCHAR(64) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_intake_rate_limit_ip_cycle ON intake_rate_limit_events(ip_hash, cycle_id, route_key);

-- Add published_version_id FK to intake_forms now that the table exists
ALTER TABLE intake_forms ADD CONSTRAINT fk_published_version FOREIGN KEY (published_version_id) REFERENCES intake_form_versions(id) ON DELETE SET NULL;
