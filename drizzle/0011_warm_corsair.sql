CREATE TABLE "real_mail_reports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"reporter_employee_id" text,
	"reporter_email" text NOT NULL,
	"subject" text NOT NULL,
	"sender" text NOT NULL,
	"headers_raw" text,
	"body_hash" text,
	"body_preview" text,
	"urls" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"attachments_meta" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"severity" text DEFAULT 'unknown' NOT NULL,
	"source" text DEFAULT 'addin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "real_mail_reports" ADD CONSTRAINT "real_mail_reports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_mail_reports" ADD CONSTRAINT "real_mail_reports_reporter_employee_id_employees_id_fk" FOREIGN KEY ("reporter_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "real_mail_reports_org_idx" ON "real_mail_reports" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "real_mail_reports_reporter_idx" ON "real_mail_reports" USING btree ("reporter_employee_id");--> statement-breakpoint
CREATE INDEX "real_mail_reports_created_idx" ON "real_mail_reports" USING btree ("created_at");