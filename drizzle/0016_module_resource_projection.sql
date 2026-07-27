CREATE TABLE "module_resource_assessment_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "library_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "module" varchar(40) NOT NULL,
  "scope" varchar(20) NOT NULL,
  "school_id" uuid,
  "instrument_code" varchar(80) NOT NULL,
  "title" varchar(200) NOT NULL,
  "question_count" integer DEFAULT 0 NOT NULL,
  "dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "scoring_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "module_resource_attribution_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "library_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "module" varchar(40) NOT NULL,
  "scope" varchar(20) NOT NULL,
  "school_id" uuid,
  "rule_id" varchar(120) NOT NULL,
  "priority" integer NOT NULL,
  "level" varchar(80) NOT NULL,
  "blocked" boolean DEFAULT false NOT NULL,
  "has_condition" boolean DEFAULT false NOT NULL,
  "primary_attribution" varchar(120) NOT NULL,
  "secondary_attributions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tool_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason_count" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "module_resource_tool_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "library_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "module" varchar(40) NOT NULL,
  "scope" varchar(20) NOT NULL,
  "school_id" uuid,
  "tool_code" varchar(80) NOT NULL,
  "name" varchar(200) NOT NULL,
  "form" varchar(100) NOT NULL,
  "severity" varchar(40),
  "level" varchar(40),
  "primary_attribution" varchar(120),
  "attributions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tool_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "step_count" integer DEFAULT 0 NOT NULL,
  "has_script" boolean DEFAULT false NOT NULL,
  "has_prohibitions" boolean DEFAULT false NOT NULL,
  "has_expected_effect" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "module_resource_assessment_items"
  ADD CONSTRAINT "module_resource_assessment_items_library_id_module_resource_libraries_id_fk"
  FOREIGN KEY ("library_id") REFERENCES "module_resource_libraries"("id") ON DELETE cascade;
ALTER TABLE "module_resource_assessment_items"
  ADD CONSTRAINT "module_resource_assessment_items_version_id_module_resource_versions_id_fk"
  FOREIGN KEY ("version_id") REFERENCES "module_resource_versions"("id") ON DELETE cascade;
ALTER TABLE "module_resource_assessment_items"
  ADD CONSTRAINT "module_resource_assessment_items_school_id_schools_id_fk"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE cascade;

ALTER TABLE "module_resource_attribution_rules"
  ADD CONSTRAINT "module_resource_attribution_rules_library_id_module_resource_libraries_id_fk"
  FOREIGN KEY ("library_id") REFERENCES "module_resource_libraries"("id") ON DELETE cascade;
ALTER TABLE "module_resource_attribution_rules"
  ADD CONSTRAINT "module_resource_attribution_rules_version_id_module_resource_versions_id_fk"
  FOREIGN KEY ("version_id") REFERENCES "module_resource_versions"("id") ON DELETE cascade;
ALTER TABLE "module_resource_attribution_rules"
  ADD CONSTRAINT "module_resource_attribution_rules_school_id_schools_id_fk"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE cascade;

ALTER TABLE "module_resource_tool_items"
  ADD CONSTRAINT "module_resource_tool_items_library_id_module_resource_libraries_id_fk"
  FOREIGN KEY ("library_id") REFERENCES "module_resource_libraries"("id") ON DELETE cascade;
ALTER TABLE "module_resource_tool_items"
  ADD CONSTRAINT "module_resource_tool_items_version_id_module_resource_versions_id_fk"
  FOREIGN KEY ("version_id") REFERENCES "module_resource_versions"("id") ON DELETE cascade;
ALTER TABLE "module_resource_tool_items"
  ADD CONSTRAINT "module_resource_tool_items_school_id_schools_id_fk"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "module_resource_assessment_items_version_code_uidx"
  ON "module_resource_assessment_items" ("version_id", "instrument_code");
CREATE INDEX "module_resource_assessment_items_lookup_idx"
  ON "module_resource_assessment_items" ("module", "scope", "school_id");
CREATE INDEX "module_resource_assessment_items_library_idx"
  ON "module_resource_assessment_items" ("library_id");

CREATE UNIQUE INDEX "module_resource_attribution_rules_version_rule_uidx"
  ON "module_resource_attribution_rules" ("version_id", "rule_id");
CREATE INDEX "module_resource_attribution_rules_lookup_idx"
  ON "module_resource_attribution_rules" ("module", "scope", "school_id");
CREATE INDEX "module_resource_attribution_rules_level_idx"
  ON "module_resource_attribution_rules" ("level", "blocked");
CREATE INDEX "module_resource_attribution_rules_library_idx"
  ON "module_resource_attribution_rules" ("library_id");

CREATE UNIQUE INDEX "module_resource_tool_items_version_code_uidx"
  ON "module_resource_tool_items" ("version_id", "tool_code");
CREATE INDEX "module_resource_tool_items_lookup_idx"
  ON "module_resource_tool_items" ("module", "scope", "school_id");
CREATE INDEX "module_resource_tool_items_match_idx"
  ON "module_resource_tool_items" ("form", "severity", "level");
CREATE INDEX "module_resource_tool_items_library_idx"
  ON "module_resource_tool_items" ("library_id");
