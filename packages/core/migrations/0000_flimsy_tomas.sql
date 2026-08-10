CREATE TABLE "chats" (
	"jid" text PRIMARY KEY NOT NULL,
	"nombre" text,
	"es_grupo" boolean DEFAULT false NOT NULL,
	"tracked" boolean DEFAULT false NOT NULL,
	"conversation_id" text,
	"pending_since" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"agent_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"jid" text NOT NULL,
	"wa_message_id" text NOT NULL,
	"autor" text,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" bigint NOT NULL,
	"accion" text NOT NULL,
	"antes" jsonb,
	"despues" jsonb,
	"jid" text,
	"motivo" text,
	"response_id" text,
	"undone_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"url" text,
	"due_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"context" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source" text NOT NULL,
	"source_jid" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox" ADD CONSTRAINT "inbox_jid_chats_jid_fk" FOREIGN KEY ("jid") REFERENCES "public"."chats"("jid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_changes" ADD CONSTRAINT "item_changes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_changes" ADD CONSTRAINT "item_changes_jid_chats_jid_fk" FOREIGN KEY ("jid") REFERENCES "public"."chats"("jid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_source_jid_chats_jid_fk" FOREIGN KEY ("source_jid") REFERENCES "public"."chats"("jid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_wa_message_id_key" ON "inbox" USING btree ("wa_message_id");--> statement-breakpoint
CREATE INDEX "inbox_jid_sent_at_idx" ON "inbox" USING btree ("jid","sent_at");--> statement-breakpoint
CREATE INDEX "item_changes_unnotified_idx" ON "item_changes" USING btree ("notified_at");--> statement-breakpoint
CREATE INDEX "items_done_due_idx" ON "items" USING btree ("done_at","due_at");--> statement-breakpoint
CREATE INDEX "items_source_jid_open_idx" ON "items" USING btree ("source_jid") WHERE done_at IS NULL;