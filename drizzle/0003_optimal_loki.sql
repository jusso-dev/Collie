ALTER TABLE "campaigns" ADD COLUMN "working_hours_start" integer DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "working_hours_end" integer DEFAULT 1020 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "working_days" integer[] DEFAULT ARRAY[1,2,3,4,5]::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "respect_employee_timezone" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cooldown_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "exclusion_reason" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "excluded_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret_encrypted" text;