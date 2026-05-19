CREATE TYPE "public"."sending_transport" AS ENUM('resend', 'smtp');--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "sending_transport" "sending_transport" DEFAULT 'resend' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "smtp_username_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "smtp_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "smtp_secure" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "smtp_from_address" text;