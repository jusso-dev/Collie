CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "organisation_invitations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'admin' NOT NULL,
	"token" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organisation_invitations" ADD CONSTRAINT "organisation_invitations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_invitations" ADD CONSTRAINT "organisation_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_invitations_token_idx" ON "organisation_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "organisation_invitations_org_idx" ON "organisation_invitations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "organisation_invitations_email_idx" ON "organisation_invitations" USING btree ("email");