CREATE TABLE "training_certificates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"training_module_id" text,
	"campaign_target_id" text,
	"certificate_json" jsonb NOT NULL,
	"certificate_json_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_public_key" text NOT NULL,
	"signing_public_key_sha256" text NOT NULL,
	"download_token_encrypted" text NOT NULL,
	"download_token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "certificate_signing_private_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "certificate_signing_public_key" text;--> statement-breakpoint
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_training_module_id_training_modules_id_fk" FOREIGN KEY ("training_module_id") REFERENCES "public"."training_modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_campaign_target_id_campaign_targets_id_fk" FOREIGN KEY ("campaign_target_id") REFERENCES "public"."campaign_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_certificates_org_idx" ON "training_certificates" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "training_certificates_employee_idx" ON "training_certificates" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_certificates_target_uidx" ON "training_certificates" USING btree ("campaign_target_id") WHERE "training_certificates"."campaign_target_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "training_certificates_token_hash_uidx" ON "training_certificates" USING btree ("download_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "training_certificates_json_hash_uidx" ON "training_certificates" USING btree ("certificate_json_hash");
