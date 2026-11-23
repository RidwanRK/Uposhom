CREATE TABLE "account_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"discreet_sms" boolean DEFAULT false NOT NULL,
	"sms_reminders" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pharmacies" ALTER COLUMN "lat" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacies" ALTER COLUMN "lng" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "opening_hours" text;--> statement-breakpoint
ALTER TABLE "report_values" ADD COLUMN "explanation_bn" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "center" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "test_type" text;--> statement-breakpoint
ALTER TABLE "account_settings" ADD CONSTRAINT "account_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;