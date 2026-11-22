CREATE TABLE "notices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "notices_ref_unique" UNIQUE("ref"),
	CONSTRAINT "notices_type" CHECK (type IN ('REFILL_DUE', 'FOLLOW_UP', 'WEEKLY_DIGEST'))
);
--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_user" ON "notices" USING btree ("user_id","created_at");