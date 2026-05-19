CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "audit_retention_days" integer DEFAULT 395 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("organisation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");