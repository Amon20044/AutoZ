-- Supabase/Postgres UUID helper used by Prisma's gen_random_uuid() defaults.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "preview_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" UUID NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_model_id_idx" ON "media"("model_id");

-- CreateIndex
CREATE INDEX "model_configs_model_id_idx" ON "model_configs"("model_id");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep preview_url derived from the model id once the row exists.
-- Final storage object path expected: Models/<model_id>/preview
CREATE OR REPLACE FUNCTION "set_model_preview_url"()
RETURNS TRIGGER AS $$
BEGIN
    NEW."preview_url" := CASE
        WHEN NEW."id" IS NULL THEN NULL
        ELSE '/storage/v1/object/public/Models/' || NEW."id"::TEXT || '/preview'
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "models_set_preview_url"
BEFORE INSERT OR UPDATE OF "id"
ON "models"
FOR EACH ROW
EXECUTE FUNCTION "set_model_preview_url"();

COMMENT ON COLUMN "models"."preview_url" IS 'Generated from models.id. Expected public storage object path: Models/<model_id>/preview.';
COMMENT ON COLUMN "media"."file_url" IS 'Supabase Storage URL for a model asset.';

-- Secure defaults for Supabase exposed public schema.
ALTER TABLE "models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "model_configs" ENABLE ROW LEVEL SECURITY;
