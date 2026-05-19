CREATE TYPE "public"."outbound_delivery_status" AS ENUM('pending', 'retrying', 'succeeded', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."siem_soar_connector" AS ENUM('sentinel', 'splunk_soar', 'cortex_xsoar', 'servicenow_sir');--> statement-breakpoint
CREATE TYPE "public"."siem_soar_format" AS ENUM('json', 'cef', 'leef');--> statement-breakpoint
CREATE TABLE "industry_benchmarks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"industry" text NOT NULL,
	"employee_count_band" text NOT NULL,
	"median_ppp" integer NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_dead_letters" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"reason" text NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_deliveries" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_type" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "outbound_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_status_code" integer,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_endpoints" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"connector" "siem_soar_connector" NOT NULL,
	"format" "siem_soar_format" DEFAULT 'json' NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"event_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "lrs_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "lrs_endpoint_url" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "lrs_username_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "lrs_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "siem_soar_signing_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "siem_soar_signing_key_last4" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "siem_soar_signing_key_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_dead_letters" ADD CONSTRAINT "outbound_dead_letters_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_dead_letters" ADD CONSTRAINT "outbound_dead_letters_endpoint_id_outbound_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."outbound_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_dead_letters" ADD CONSTRAINT "outbound_dead_letters_delivery_id_outbound_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."outbound_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_endpoint_id_outbound_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."outbound_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_endpoints" ADD CONSTRAINT "outbound_endpoints_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "industry_benchmarks_industry_band_idx" ON "industry_benchmarks" USING btree ("industry","employee_count_band");--> statement-breakpoint
CREATE INDEX "industry_benchmarks_lookup_idx" ON "industry_benchmarks" USING btree ("industry","employee_count_band");--> statement-breakpoint
CREATE INDEX "outbound_dead_letters_org_idx" ON "outbound_dead_letters" USING btree ("organisation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbound_dead_letters_endpoint_idx" ON "outbound_dead_letters" USING btree ("endpoint_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_dead_letters_delivery_uidx" ON "outbound_dead_letters" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "outbound_deliveries_org_idx" ON "outbound_deliveries" USING btree ("organisation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbound_deliveries_endpoint_idx" ON "outbound_deliveries" USING btree ("endpoint_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbound_deliveries_status_next_idx" ON "outbound_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_deliveries_idempotency_uidx" ON "outbound_deliveries" USING btree ("endpoint_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbound_endpoints_org_idx" ON "outbound_endpoints" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "outbound_endpoints_enabled_idx" ON "outbound_endpoints" USING btree ("enabled");