ALTER TABLE "events" ADD COLUMN "message_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "events_message_id_uidx" ON "events" USING btree ("message_id") WHERE "events"."message_id" is not null;