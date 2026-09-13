CREATE TABLE tts_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT,
  model TEXT,
  encrypted_api_key TEXT,
  voice TEXT NOT NULL DEFAULT 'alloy',
  speed REAL NOT NULL DEFAULT 1.0 CHECK (speed >= 0.25 AND speed <= 4.0),
  pitch INTEGER NOT NULL DEFAULT 0 CHECK (pitch >= -12 AND pitch <= 12),
  timeout_seconds INTEGER NOT NULL DEFAULT 60 CHECK (timeout_seconds BETWEEN 10 AND 300),
  revision INTEGER NOT NULL DEFAULT 1
);

INSERT INTO tts_settings(id, voice, speed, pitch, timeout_seconds, revision)
VALUES (1, 'alloy', 1.0, 0, 60, 1);
