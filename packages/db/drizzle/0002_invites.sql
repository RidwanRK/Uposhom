CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"invited_by" text,
	"phone_key" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	CONSTRAINT "invites_role" CHECK (role IN ('ADMIN', 'CAREGIVER', 'VIEWER'))
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_open" ON "invites" USING btree ("profile_id","phone_key") WHERE accepted_at IS NULL;--> statement-breakpoint
CREATE INDEX "invites_phone" ON "invites" USING btree ("phone_key") WHERE accepted_at IS NULL;