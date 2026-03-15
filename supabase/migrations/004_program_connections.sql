-- Scope connections to programs. Scholarship admins can only use connections assigned to their program.
-- program_id NULL = unassigned (platform admin only). Once set, scholarship admins for that program can use it.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES scholarship_programs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_connections_program ON connections(program_id);
