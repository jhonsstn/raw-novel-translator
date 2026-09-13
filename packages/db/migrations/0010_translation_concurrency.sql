ALTER TABLE provider_settings ADD COLUMN translation_concurrency INTEGER NOT NULL DEFAULT 1 CHECK(translation_concurrency BETWEEN 1 AND 20);
