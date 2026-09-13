CREATE TABLE tts_settings_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT,
  model TEXT,
  encrypted_api_key TEXT,
  language TEXT,
  voice TEXT NOT NULL DEFAULT 'alloy',
  speed REAL NOT NULL DEFAULT 1.0 CHECK (speed >= 0.24 AND speed <= 4.0),
  pitch INTEGER NOT NULL DEFAULT 0 CHECK (pitch >= -12 AND pitch <= 12),
  timeout_seconds INTEGER NOT NULL DEFAULT 60 CHECK (timeout_seconds BETWEEN 10 AND 300),
  revision INTEGER NOT NULL DEFAULT 1
);

INSERT INTO tts_settings_new(id, base_url, model, encrypted_api_key, language, voice, speed, pitch, timeout_seconds, revision)
SELECT id, base_url, model, encrypted_api_key, language, voice, speed, pitch, timeout_seconds, revision
FROM tts_settings;

DROP TABLE tts_settings;
ALTER TABLE tts_settings_new RENAME TO tts_settings;