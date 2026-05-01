-- ==========================================================================
-- Migration: PRD Schema v1
-- Replaces the legacy 3-table schema (models, media, model_configs) with
-- the PRD-required 4-table architecture:
--   projects, assets, project_configs, publishes
--
-- This is a DESTRUCTIVE migration — legacy tables are dropped.
-- Safe for pre-production use only.
-- ==========================================================================

-- Ensure UUID support
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Drop legacy objects
-- -------------------------------------------------------------------------

-- Drop the auto-preview trigger and function first (depends on models table)
DROP TRIGGER IF EXISTS "models_set_preview_url" ON "models";
DROP FUNCTION IF EXISTS "set_model_preview_url"();

-- Drop legacy tables in dependency order
DROP TABLE IF EXISTS "model_configs" CASCADE;
DROP TABLE IF EXISTS "media" CASCADE;
DROP TABLE IF EXISTS "models" CASCADE;

-- -------------------------------------------------------------------------
-- 2. Create new tables
-- -------------------------------------------------------------------------

-- projects
CREATE TABLE "projects" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "name"       TEXT         NOT NULL,
    "created_by" UUID,
    "status"     TEXT         NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- assets
CREATE TABLE "assets" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "project_id"       UUID         NOT NULL,
    "asset_type"       TEXT         NOT NULL,
    "storage_provider" TEXT         NOT NULL,
    "public_url"       TEXT         NOT NULL,
    "storage_path"     TEXT,
    "mime_type"        TEXT,
    "file_name"        TEXT,
    "file_size_bytes"  BIGINT,
    "width"            INTEGER,
    "height"           INTEGER,
    "metadata"         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- project_configs
CREATE TABLE "project_configs" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID         NOT NULL,
    "config"     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "version"    INTEGER      NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_configs_pkey" PRIMARY KEY ("id")
);

-- publishes
CREATE TABLE "publishes" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "project_id"   UUID         NOT NULL,
    "publish_slug" TEXT         NOT NULL,
    "snapshot"     JSONB        NOT NULL,
    "version"      INTEGER      NOT NULL,
    "is_public"    BOOLEAN      NOT NULL DEFAULT true,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishes_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- 3. Unique constraints
-- -------------------------------------------------------------------------

ALTER TABLE "publishes" ADD CONSTRAINT "publishes_publish_slug_key" UNIQUE ("publish_slug");

-- -------------------------------------------------------------------------
-- 4. Indexes
-- -------------------------------------------------------------------------

CREATE INDEX "assets_project_id_idx"         ON "assets"("project_id");
CREATE INDEX "assets_asset_type_idx"         ON "assets"("asset_type");
CREATE INDEX "project_configs_project_id_idx" ON "project_configs"("project_id");
CREATE INDEX "publishes_project_id_idx"      ON "publishes"("project_id");
CREATE INDEX "publishes_publish_slug_idx"    ON "publishes"("publish_slug");

-- -------------------------------------------------------------------------
-- 5. Foreign keys
-- -------------------------------------------------------------------------

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_configs"
  ADD CONSTRAINT "project_configs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publishes"
  ADD CONSTRAINT "publishes_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- 6. Row Level Security
-- -------------------------------------------------------------------------

ALTER TABLE "projects"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "publishes"       ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- 7. Comments
-- -------------------------------------------------------------------------

COMMENT ON TABLE  "projects"        IS 'Core entity – each car viewer experience is a project.';
COMMENT ON TABLE  "assets"          IS 'Unified asset registry for ImgBB images and Supabase Storage runtime files.';
COMMENT ON TABLE  "project_configs" IS 'Versioned editable draft configuration for a project.';
COMMENT ON TABLE  "publishes"       IS 'Immutable published snapshots. Re-publishing creates a new row.';

COMMENT ON COLUMN "assets"."storage_provider" IS 'One of: imgbb, supabase_storage, external_url';
COMMENT ON COLUMN "assets"."asset_type"       IS 'One of: original_model, optimized_model, environment_hdri, environment_exr, compressed_texture, project_thumbnail, publish_preview, material_swatch, background_image, config_backup';
COMMENT ON COLUMN "assets"."storage_path"     IS 'Supabase Storage bucket path. NULL for imgbb-hosted assets.';
COMMENT ON COLUMN "publishes"."publish_slug"  IS 'Human-friendly unique slug used in /view/:publishSlug route.';
COMMENT ON COLUMN "publishes"."snapshot"      IS 'Frozen JSONB snapshot – never updated after insert.';
