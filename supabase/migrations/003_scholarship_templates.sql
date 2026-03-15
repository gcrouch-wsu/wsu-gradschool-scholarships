-- Reusable scholarship templates for new programs/cycles
-- Platform-admin managed; config matches export format (roles, fieldConfigs, permissions, viewConfigs)
CREATE TABLE IF NOT EXISTS scholarship_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  config_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_scholarship_templates_name ON scholarship_templates(name);
