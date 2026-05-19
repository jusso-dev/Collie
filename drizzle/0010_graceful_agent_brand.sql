CREATE TYPE "public"."employee_sync_mode" AS ENUM('single', 'bulk_incremental', 'bulk_full');--> statement-breakpoint
CREATE TABLE "employee_sync_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"mode" "employee_sync_mode" NOT NULL,
	"source" text DEFAULT 'api' NOT NULL,
	"actor_key_last4" text,
	"received_count" integer DEFAULT 0 NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"deactivated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "api_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "api_key_hash" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "api_key_last4" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "api_key_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employee_sync_runs" ADD CONSTRAINT "employee_sync_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_sync_runs_org_idx" ON "employee_sync_runs" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_api_key_hash_idx" ON "organisations" USING btree ("api_key_hash");