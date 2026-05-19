CREATE TYPE "public"."campaign_approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."deepfake_asset_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel" AS ENUM('email', 'sms', 'voice', 'qr', 'attachment', 'usb');--> statement-breakpoint
ALTER TYPE "public"."landing_page_type" ADD VALUE 'mfa_push_simulator';--> statement-breakpoint
ALTER TYPE "public"."landing_page_type" ADD VALUE 'oauth_consent';--> statement-breakpoint
ALTER TYPE "public"."landing_page_type" ADD VALUE 'usb_drop';--> statement-breakpoint
ALTER TYPE "public"."landing_page_type" ADD VALUE 'voice_callback';--> statement-breakpoint
ALTER TYPE "public"."landing_page_type" ADD VALUE 'deepfake_disclosure';--> statement-breakpoint
ALTER TYPE "public"."template_category" ADD VALUE 'attachment_pdf';--> statement-breakpoint
ALTER TYPE "public"."template_category" ADD VALUE 'attachment_html';--> statement-breakpoint
ALTER TYPE "public"."template_category" ADD VALUE 'usb_drop';--> statement-breakpoint
ALTER TYPE "public"."template_category" ADD VALUE 'oauth_consent';--> statement-breakpoint
ALTER TYPE "public"."template_category" ADD VALUE 'mfa_push';--> statement-breakpoint
ALTER TYPE "public"."template_category" ADD VALUE 'sms_lure';--> statement-breakpoint
ALTER TYPE "public"."template_category" ADD VALUE 'vishing';--> statement-breakpoint
ALTER TYPE "public"."template_category" ADD VALUE 'deepfake_exec';--> statement-breakpoint
CREATE TABLE "campaign_approvals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"campaign_id" text NOT NULL,
	"approver_user_id" text NOT NULL,
	"decision" "campaign_approval_decision" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_variants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"campaign_id" text NOT NULL,
	"template_id" text NOT NULL,
	"weight" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deepfake_assets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"campaign_id" text NOT NULL,
	"executive_name" text NOT NULL,
	"asset_url" text NOT NULL,
	"watermark" text NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "deepfake_asset_status" DEFAULT 'draft' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"keyword" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_call_attempts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"campaign_target_id" text NOT NULL,
	"provider_call_sid" text,
	"consent_captured" boolean DEFAULT false NOT NULL,
	"recording_url" text,
	"redacted_transcript" text,
	"dtmf_digits" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "campaign_variant_id" text;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "delivery_channel" "delivery_channel" DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "delivery_channel" "delivery_channel" DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "scenario" text;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "delivery_channel" "delivery_channel" DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "twilio_account_sid_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "twilio_auth_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "twilio_messaging_service_sid_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "twilio_sender_phone_pool" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "twilio_opt_out_keywords" text[] DEFAULT ARRAY['STOP']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "twilio_voice_from_number_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "voice_provider" text DEFAULT 'twilio' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "tts_provider" text DEFAULT 'azure' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "voice_consent_regions" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_approvals" ADD CONSTRAINT "campaign_approvals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_approvals" ADD CONSTRAINT "campaign_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deepfake_assets" ADD CONSTRAINT "deepfake_assets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_opt_outs" ADD CONSTRAINT "sms_opt_outs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_call_attempts" ADD CONSTRAINT "voice_call_attempts_campaign_target_id_campaign_targets_id_fk" FOREIGN KEY ("campaign_target_id") REFERENCES "public"."campaign_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_approvals_campaign_idx" ON "campaign_approvals" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_approvals_campaign_approver_idx" ON "campaign_approvals" USING btree ("campaign_id","approver_user_id");--> statement-breakpoint
CREATE INDEX "campaign_variants_campaign_idx" ON "campaign_variants" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_variants_campaign_template_idx" ON "campaign_variants" USING btree ("campaign_id","template_id");--> statement-breakpoint
CREATE INDEX "deepfake_assets_campaign_idx" ON "deepfake_assets" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "deepfake_assets_expires_idx" ON "deepfake_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sms_opt_outs_org_idx" ON "sms_opt_outs" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_opt_outs_org_phone_idx" ON "sms_opt_outs" USING btree ("organisation_id","phone_number");--> statement-breakpoint
CREATE INDEX "voice_call_attempts_target_idx" ON "voice_call_attempts" USING btree ("campaign_target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_call_attempts_provider_sid_idx" ON "voice_call_attempts" USING btree ("provider_call_sid") WHERE "voice_call_attempts"."provider_call_sid" is not null;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_campaign_variant_id_campaign_variants_id_fk" FOREIGN KEY ("campaign_variant_id") REFERENCES "public"."campaign_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_targets_variant_idx" ON "campaign_targets" USING btree ("campaign_variant_id");