CREATE TYPE "public"."scan_status" AS ENUM('pending', 'auto', 'confirmed', 'corrected', 'rejected');--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "scan_status" DEFAULT 'pending' NOT NULL,
	"image_path" text,
	"candidates" jsonb DEFAULT '[]'::jsonb,
	"auto_card_id" uuid,
	"chosen_card_id" uuid,
	"reason" text,
	"auto_save" boolean DEFAULT false NOT NULL,
	"quality" jsonb,
	"ocr_name" text,
	"ocr_number" text,
	"elapsed_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_auto_card_id_cards_id_fk" FOREIGN KEY ("auto_card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_chosen_card_id_cards_id_fk" FOREIGN KEY ("chosen_card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scans_created_at_idx" ON "scans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scans_chosen_card_idx" ON "scans" USING btree ("chosen_card_id");--> statement-breakpoint
CREATE INDEX "scans_status_idx" ON "scans" USING btree ("status");