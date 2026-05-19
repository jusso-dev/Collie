CREATE TYPE "public"."sso_kind" AS ENUM('oidc', 'saml');--> statement-breakpoint
CREATE TABLE "sso_configurations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"kind" "sso_kind" NOT NULL,
	"oidc_issuer_url" text,
	"oidc_client_id" text,
	"oidc_client_secret_encrypted" text,
	"saml_entity_id" text,
	"saml_acs_url" text,
	"saml_idp_metadata" text,
	"enforce_sso" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sso_configurations" ADD CONSTRAINT "sso_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_configurations_org_idx" ON "sso_configurations" USING btree ("organisation_id");