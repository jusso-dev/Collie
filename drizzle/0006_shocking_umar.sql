ALTER TABLE "employees" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "scim_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "scim_token_hash" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "scim_token_issued_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_scim_external_id_idx" ON "employees" USING btree ("organisation_id","scim_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_org_scim_external_id_idx" ON "groups" USING btree ("organisation_id","scim_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_scim_token_hash_idx" ON "organisations" USING btree ("scim_token_hash");