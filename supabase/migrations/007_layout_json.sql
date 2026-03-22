-- Migration 007: Shared layout_json support for intake and reviewer builders

ALTER TABLE intake_forms
ADD COLUMN IF NOT EXISTS layout_json JSONB;

ALTER TABLE view_configs
ADD COLUMN IF NOT EXISTS layout_json JSONB;
