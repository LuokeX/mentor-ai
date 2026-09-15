ALTER TABLE "school_settings" ALTER COLUMN "crisis_guide" SET DEFAULT '请尽快联系校内心理专员，并按学校安全流程跟进。';--> statement-breakpoint
-- 教师界面文案红线：不得出现「危机 / 红线 / 预警 / 立即 / 110 / 120」字样。
-- 存量危机指引命中禁用字样的一律回退到新默认指引，学校可在后台按规范重新填写。
UPDATE "school_settings"
SET "crisis_guide" = '请尽快联系校内心理专员，并按学校安全流程跟进。'
WHERE "crisis_guide" ~ '危机|红线|预警|立即|110|120';