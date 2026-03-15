-- Scholarship Review Platform - Initial Schema
-- Aligned with handoff.MD data model draft
-- Run against Postgres (Vercel Postgres, Supabase, or local)

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- Sessions (DB-backed for revocation)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Scholarship programs
CREATE TABLE IF NOT EXISTS scholarship_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scholarship_programs_slug ON scholarship_programs(slug);

-- Connections (encrypted credentials - platform admin only)
CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'smartsheet',
  encrypted_credentials TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_verified_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scholarship cycles
CREATE TABLE IF NOT EXISTS scholarship_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES scholarship_programs(id) ON DELETE CASCADE,
  cycle_key VARCHAR(100) NOT NULL,
  cycle_label VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  sheet_id BIGINT,
  sheet_name VARCHAR(255),
  sheet_schema_snapshot_json JSONB,
  schema_synced_at TIMESTAMPTZ,
  schema_status VARCHAR(50),
  allow_external_reviewers BOOLEAN NOT NULL DEFAULT false,
  published_config_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(program_id, cycle_key)
);

CREATE INDEX idx_scholarship_cycles_program ON scholarship_cycles(program_id);
CREATE INDEX idx_scholarship_cycles_status ON scholarship_cycles(status);

-- Program role templates (reusable per program)
CREATE TABLE IF NOT EXISTS program_role_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES scholarship_programs(id) ON DELETE CASCADE,
  key VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(program_id, key)
);

-- Cycle-owned roles (copied from templates or custom)
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  key VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(cycle_id, key)
);

CREATE INDEX idx_roles_cycle ON roles(cycle_id);

-- Scholarship memberships (assignments)
CREATE TABLE IF NOT EXISTS scholarship_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  filter_criteria_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, user_id)
);

CREATE INDEX idx_scholarship_memberships_cycle ON scholarship_memberships(cycle_id);
CREATE INDEX idx_scholarship_memberships_user ON scholarship_memberships(user_id);

-- Field configs (Phase 3 - placeholder for schema)
CREATE TABLE IF NOT EXISTS field_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  field_key VARCHAR(100) NOT NULL,
  source_column_id BIGINT NOT NULL,
  source_column_title VARCHAR(255),
  purpose VARCHAR(50) NOT NULL,
  display_label VARCHAR(255) NOT NULL,
  display_type VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT false,
  settings_json JSONB,
  UNIQUE(cycle_id, field_key)
);

-- Field permissions (Phase 3)
CREATE TABLE IF NOT EXISTS field_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_config_id UUID NOT NULL REFERENCES field_configs(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(field_config_id, role_id)
);

-- View configs (Phase 3)
CREATE TABLE IF NOT EXISTS view_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  view_type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  settings_json JSONB
);

-- Config versions (Phase 3)
CREATE TABLE IF NOT EXISTS config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  status VARCHAR(50) NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- View sections (Phase 3)
CREATE TABLE IF NOT EXISTS view_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_config_id UUID NOT NULL REFERENCES view_configs(id) ON DELETE CASCADE,
  section_key VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  settings_json JSONB
);

-- Section fields (Phase 3)
CREATE TABLE IF NOT EXISTS section_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_section_id UUID NOT NULL REFERENCES view_sections(id) ON DELETE CASCADE,
  field_config_id UUID NOT NULL REFERENCES field_configs(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  cycle_id UUID,
  action_type VARCHAR(100) NOT NULL,
  target_type VARCHAR(100),
  target_id VARCHAR(255),
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_cycle ON audit_logs(cycle_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- User cycle progress (resume where left off)
CREATE TABLE IF NOT EXISTS user_cycle_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  last_row_id BIGINT,
  last_section_key VARCHAR(100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, cycle_id)
);

-- App config (timeouts, etc.)
CREATE TABLE IF NOT EXISTS app_config (
  key VARCHAR(100) PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default timeout values per handoff (JSON numbers)
INSERT INTO app_config (key, value_json) VALUES
  ('idle_session_timeout_minutes', '120'::jsonb),
  ('session_warning_minutes', '10'::jsonb),
  ('smartsheet_write_timeout_seconds', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;
