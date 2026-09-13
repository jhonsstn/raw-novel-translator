CREATE TABLE provider_settings_new (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id = 1),
  base_url TEXT,
  model TEXT,
  encrypted_api_key TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER NOT NULL DEFAULT 120 CHECK(timeout_seconds BETWEEN 30 AND 600),
  chunk_characters INTEGER NOT NULL DEFAULT 10000 CHECK(chunk_characters BETWEEN 500 AND 15000),
  automatic_paused INTEGER NOT NULL DEFAULT 0
);
INSERT INTO provider_settings_new (id, base_url, model, encrypted_api_key, revision, timeout_seconds, chunk_characters, automatic_paused)
SELECT id, base_url, model, encrypted_api_key, revision, timeout_seconds, chunk_characters, automatic_paused FROM provider_settings;
DROP TABLE provider_settings;
ALTER TABLE provider_settings_new RENAME TO provider_settings;
