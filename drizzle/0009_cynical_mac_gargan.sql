CREATE TYPE "public"."exclusion_rule_kind" AS ENUM('group', 'new_hire_days', 'role', 'tag');--> statement-breakpoint
CREATE TABLE "exclusion_rules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "exclusion_rule_kind" NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "applied_exclusion_rule_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exclusion_rules_org_idx" ON "exclusion_rules" USING btree ("organisation_id");