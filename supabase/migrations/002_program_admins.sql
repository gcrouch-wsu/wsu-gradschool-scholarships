-- Scholarship admin model: users can be admins for specific programs
-- Scholarship admins manage cycle operations (config, builder, assignments) but NOT connections (raw tokens)

CREATE TABLE IF NOT EXISTS program_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES scholarship_programs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(program_id, user_id)
);

CREATE INDEX idx_program_admins_program ON program_admins(program_id);
CREATE INDEX idx_program_admins_user ON program_admins(user_id);
