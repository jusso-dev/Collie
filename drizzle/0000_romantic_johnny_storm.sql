CREATE TYPE "public"."assignment_source" AS ENUM('just_in_time', 'scheduled', 'manual');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'running', 'completed', 'cancelled', 'paused');--> statement-breakpoint
CREATE TYPE "public"."data_region" AS ENUM('au', 'us', 'eu');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('sent', 'opened', 'clicked', 'submitted', 'reported', 'trained', 'bounced', 'complained');--> statement-breakpoint
CREATE TYPE "public"."landing_page_type" AS ENUM('credential_harvest', 'attachment_warning', 'training_redirect', 'friendly_simulation');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('trial', 'starter', 'growth', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."send_strategy" AS ENUM('immediate', 'drip', 'randomised_over_window');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('credential_harvest', 'invoice_fraud', 'ceo_impersonation', 'qr_code', 'callback', 'package_delivery', 'tax', 'telecom', 'document_share');--> statement-breakpoint
CREATE TYPE "public"."training_content_type" AS ENUM('video', 'interactive', 'article');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'viewer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_targets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"campaign_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"unique_token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"training_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"email_template_id" text,
	"landing_page_id" text,
	"target_group_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"send_strategy" "send_strategy" DEFAULT 'immediate' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text,
	"name" text NOT NULL,
	"category" "template_category" NOT NULL,
	"difficulty" integer NOT NULL,
	"subject" text NOT NULL,
	"from_name" text NOT NULL,
	"from_email_pattern" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text NOT NULL,
	"language" text DEFAULT 'en-AU' NOT NULL,
	"region" text DEFAULT 'au' NOT NULL,
	"linked_training_module_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_groups" (
	"employee_id" text NOT NULL,
	"group_id" text NOT NULL,
	CONSTRAINT "employee_groups_employee_id_group_id_pk" PRIMARY KEY("employee_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"department" text,
	"manager_email" text,
	"language" text DEFAULT 'en-AU' NOT NULL,
	"timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"risk_score" integer DEFAULT 50 NOT NULL,
	"last_trained_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"campaign_target_id" text NOT NULL,
	"event_type" "event_type" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landing_pages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text,
	"name" text NOT NULL,
	"type" "landing_page_type" NOT NULL,
	"html" text NOT NULL,
	"linked_training_module_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"industry" text,
	"employee_count_band" text,
	"plan" "plan" DEFAULT 'trial' NOT NULL,
	"data_region" "data_region" DEFAULT 'au' NOT NULL,
	"resend_api_key_encrypted" text,
	"sender_from_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_score_history" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"employee_id" text NOT NULL,
	"score" integer NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"factors" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_assignments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"employee_id" text NOT NULL,
	"training_module_id" text NOT NULL,
	"assigned_via" "assignment_source" NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"quiz_score" integer
);
--> statement-breakpoint
CREATE TABLE "training_modules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"content_type" "training_content_type" NOT NULL,
	"content_url" text,
	"content_html" text,
	"topic" text NOT NULL,
	"language" text DEFAULT 'en-AU' NOT NULL,
	"quiz" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_landing_page_id_landing_pages_id_fk" FOREIGN KEY ("landing_page_id") REFERENCES "public"."landing_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_linked_training_module_id_training_modules_id_fk" FOREIGN KEY ("linked_training_module_id") REFERENCES "public"."training_modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_groups" ADD CONSTRAINT "employee_groups_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_groups" ADD CONSTRAINT "employee_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_campaign_target_id_campaign_targets_id_fk" FOREIGN KEY ("campaign_target_id") REFERENCES "public"."campaign_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_linked_training_module_id_training_modules_id_fk" FOREIGN KEY ("linked_training_module_id") REFERENCES "public"."training_modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_score_history" ADD CONSTRAINT "risk_score_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_training_module_id_training_modules_id_fk" FOREIGN KEY ("training_module_id") REFERENCES "public"."training_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_modules" ADD CONSTRAINT "training_modules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_targets_token_idx" ON "campaign_targets" USING btree ("unique_token");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_targets_campaign_employee_idx" ON "campaign_targets" USING btree ("campaign_id","employee_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_idx" ON "campaigns" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "email_templates_org_idx" ON "email_templates" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_email_idx" ON "employees" USING btree ("organisation_id","email");--> statement-breakpoint
CREATE INDEX "employees_org_idx" ON "employees" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "events_target_idx" ON "events" USING btree ("campaign_target_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_org_name_idx" ON "groups" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "landing_pages_org_idx" ON "landing_pages" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_slug_idx" ON "organisations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "risk_score_history_employee_idx" ON "risk_score_history" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "training_assignments_employee_idx" ON "training_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "training_modules_org_idx" ON "training_modules" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_organisation_id_idx" ON "users" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");