ALTER TABLE source_settings
ADD COLUMN download_concurrency INTEGER NOT NULL DEFAULT 2 CHECK(download_concurrency BETWEEN 1 AND 20);

UPDATE jobs
SET payload = json_set(payload, '$.sourceId', (SELECT source_id FROM novels WHERE novels.id = jobs.novel_id))
WHERE kind IN ('check_updates', 'fetch_chapter') AND json_extract(payload, '$.sourceId') IS NULL AND novel_id IS NOT NULL;

UPDATE jobs
SET payload = json_set(payload, '$.sourceId', 'piaotia')
WHERE kind = 'import' AND json_extract(payload, '$.sourceId') IS NULL
  AND json_extract(payload, '$.url') LIKE 'https://www.piaotia.com/%';

DROP TABLE source_definitions;
