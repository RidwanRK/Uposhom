CREATE TABLE "agent_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"profile_id" text,
	"channel" text NOT NULL,
	"root_agent" text NOT NULL,
	"steps" jsonb NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reminder_state" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_state" CHECK (reminder_state IN ('PENDING', 'REMINDED', 'DONE', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" text,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"profile_id" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expo_token" text NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_expo_token_unique" UNIQUE("expo_token")
);
--> statement-breakpoint
CREATE TABLE "doctor_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"object_path" text NOT NULL,
	"charge_id" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_summaries_period" CHECK (period_start <= period_end)
);
--> statement-breakpoint
CREATE TABLE "dose_events" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"prescription_item_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"course_date" date NOT NULL,
	"slot" text NOT NULL,
	"quantity" numeric(5, 2) NOT NULL,
	"meal_relation" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"is_critical" boolean NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"stage" text DEFAULT 'PENDING' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dose_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "dose_events_slot" CHECK (slot IN ('MORNING', 'NOON', 'EVENING', 'NIGHT', 'BEDTIME', 'STAT')),
	CONSTRAINT "dose_events_meal" CHECK (meal_relation IN ('AC', 'PC', 'WITH_MEAL', 'NONE')),
	CONSTRAINT "dose_events_status" CHECK (status IN ('SCHEDULED', 'TAKEN', 'TAKEN_LATE', 'SNOOZED', 'SKIPPED', 'MISSED')),
	CONSTRAINT "dose_events_stage" CHECK (stage IN ('PENDING', 'REMINDED', 'REPEATED', 'CAREGIVER_ALERTED', 'SECONDARY_ALERTED', 'CLOSED')),
	CONSTRAINT "dose_events_quantity" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "dose_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dose_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dose_event_id" text NOT NULL,
	"action" text NOT NULL,
	"channel" text NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dose_logs_action" CHECK (action IN ('TAKEN', 'TAKEN_LATE', 'SNOOZE', 'SKIP', 'MISSED')),
	CONSTRAINT "dose_logs_channel" CHECK (channel IN ('APP', 'NOTIFICATION', 'SMS', 'CAREGIVER', 'SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "escalations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dose_event_id" text NOT NULL,
	"level" text NOT NULL,
	"notified_user_id" text,
	"idempotency_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_via" text,
	CONSTRAINT "escalations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "escalations_level" CHECK (level IN ('PRIMARY', 'SECONDARY'))
);
--> statement-breakpoint
CREATE TABLE "family_circles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"tier" text DEFAULT 'FREE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_circles_tier" CHECK (tier IN ('FREE', 'PREMIUM'))
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"role" text NOT NULL,
	"is_secondary_caregiver" boolean DEFAULT false NOT NULL,
	"otp_verified_at" timestamp with time zone,
	"consent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_user_profile" UNIQUE("user_id","profile_id"),
	CONSTRAINT "links_role" CHECK (role IN ('ADMIN', 'CAREGIVER', 'VIEWER'))
);
--> statement-breakpoint
CREATE TABLE "pharmacies" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"name" text NOT NULL,
	"name_bn" text,
	"address" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"phone_enc" text,
	"is_partner" boolean DEFAULT false NOT NULL,
	"priority_listing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacies_coords" CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_stock" (
	"pharmacy_id" text NOT NULL,
	"drug_brand_id" text NOT NULL,
	"in_stock" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_stock_pharmacy_id_drug_brand_id_pk" PRIMARY KEY("pharmacy_id","drug_brand_id")
);
--> statement-breakpoint
CREATE TABLE "prescription_items" (
	"id" text PRIMARY KEY NOT NULL,
	"prescription_id" text NOT NULL,
	"position" integer NOT NULL,
	"raw_name" text,
	"brand_name" text NOT NULL,
	"drug_brand_id" text,
	"strength" text,
	"form" text,
	"raw_pattern" text,
	"parsed_pattern" text NOT NULL,
	"meal_relation" text DEFAULT 'NONE' NOT NULL,
	"duration_days" integer,
	"pill_count" numeric(7, 2),
	"as_needed" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"confidence" jsonb,
	"course_ends_on" date,
	"refill_due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescription_items_position" UNIQUE("prescription_id","position"),
	CONSTRAINT "prescription_items_meal" CHECK (meal_relation IN ('AC', 'PC', 'WITH_MEAL', 'NONE')),
	CONSTRAINT "prescription_items_duration" CHECK (duration_days IS NULL OR duration_days > 0)
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"image_path" text,
	"transcribed_text" text,
	"start_date" date,
	"created_by" text,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_status" CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
	CONSTRAINT "prescriptions_confirmed" CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"circle_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"age" integer,
	"allergies" text,
	"meal_morning" text DEFAULT '08:00' NOT NULL,
	"meal_noon" text DEFAULT '13:30' NOT NULL,
	"meal_evening" text DEFAULT '18:00' NOT NULL,
	"meal_night" text DEFAULT '21:00' NOT NULL,
	"quiet_start" text,
	"quiet_end" text,
	"phone_enc" text,
	"subscriber_id" text,
	"sms_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_meal_times" CHECK (meal_morning < meal_noon AND meal_noon < meal_evening AND meal_evening < meal_night)
);
--> statement-breakpoint
CREATE TABLE "report_values" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_values_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"report_id" text NOT NULL,
	"test_name" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"printed_range" text,
	"flag" text DEFAULT 'UNKNOWN' NOT NULL,
	CONSTRAINT "report_values_flag" CHECK (flag IN ('LOW', 'NORMAL', 'HIGH', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"title" text,
	"report_date" date,
	"image_path" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symptom_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"source" text NOT NULL,
	"data" jsonb NOT NULL,
	"red_flag" boolean DEFAULT false NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "symptom_logs_source" CHECK (source IN ('TEXT', 'VOICE', 'SMS'))
);
--> statement-breakpoint
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_summaries" ADD CONSTRAINT "doctor_summaries_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_summaries" ADD CONSTRAINT "doctor_summaries_charge_id_charges_external_trx_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("external_trx_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_prescription_item_id_prescription_items_id_fk" FOREIGN KEY ("prescription_item_id") REFERENCES "public"."prescription_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_dose_event_id_dose_events_id_fk" FOREIGN KEY ("dose_event_id") REFERENCES "public"."dose_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_dose_event_id_dose_events_id_fk" FOREIGN KEY ("dose_event_id") REFERENCES "public"."dose_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_notified_user_id_users_id_fk" FOREIGN KEY ("notified_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_circles" ADD CONSTRAINT "family_circles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock" ADD CONSTRAINT "pharmacy_stock_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_circle_id_family_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."family_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_values" ADD CONSTRAINT "report_values_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symptom_logs" ADD CONSTRAINT "symptom_logs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_traces_created" ON "agent_traces" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "appointments_due" ON "appointments" USING btree ("reminder_state","due_at");--> statement-breakpoint
CREATE INDEX "audit_log_profile" ON "audit_log" USING btree ("profile_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_actor" ON "audit_log" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "device_tokens_user" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "doctor_summaries_profile" ON "doctor_summaries" USING btree ("profile_id","generated_at");--> statement-breakpoint
CREATE INDEX "dose_events_profile_due" ON "dose_events" USING btree ("profile_id","due_at");--> statement-breakpoint
CREATE INDEX "dose_events_open" ON "dose_events" USING btree ("stage","due_at") WHERE stage <> 'CLOSED';--> statement-breakpoint
CREATE INDEX "dose_events_item" ON "dose_events" USING btree ("prescription_item_id");--> statement-breakpoint
CREATE INDEX "dose_logs_event" ON "dose_logs" USING btree ("dose_event_id","at");--> statement-breakpoint
CREATE INDEX "escalations_dose" ON "escalations" USING btree ("dose_event_id");--> statement-breakpoint
CREATE INDEX "escalations_unacked" ON "escalations" USING btree ("notified_user_id","sent_at") WHERE acknowledged_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "family_circles_owner" ON "family_circles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "links_profile" ON "links" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacies_owner" ON "pharmacies" USING btree ("owner_user_id") WHERE owner_user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pharmacy_stock_drug" ON "pharmacy_stock" USING btree ("drug_brand_id") WHERE in_stock;--> statement-breakpoint
CREATE INDEX "prescriptions_profile" ON "prescriptions" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "profiles_circle" ON "profiles" USING btree ("circle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_subscriber" ON "profiles" USING btree ("subscriber_id") WHERE subscriber_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_self" ON "profiles" USING btree ("user_id") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "report_values_report" ON "report_values" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "reports_profile" ON "reports" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "symptom_logs_profile" ON "symptom_logs" USING btree ("profile_id","logged_at");