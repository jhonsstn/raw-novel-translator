CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'error')),
  message TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX job_events_job_id_id ON job_events(job_id, id);

-- Triggers cover worker transitions and bulk cancellations in settings/automation atomically.
-- Existing jobs deliberately receive no synthetic history.
CREATE TRIGGER jobs_event_queued AFTER INSERT ON jobs
BEGIN
  INSERT INTO job_events(job_id,attempt,level,message,created_at)
  VALUES (NEW.id,NEW.attempt,'info','Job queued',NEW.created_at);
END;

CREATE TRIGGER jobs_event_status AFTER UPDATE OF status ON jobs
WHEN NEW.status <> OLD.status
BEGIN
  INSERT INTO job_events(job_id,attempt,level,message,created_at)
  VALUES (NEW.id,NEW.attempt,CASE WHEN NEW.status = 'failed' THEN 'error' ELSE 'info' END,
    CASE NEW.status
      WHEN 'queued' THEN 'Lease expired; job queued for another attempt'
      WHEN 'running' THEN 'Job claimed by worker'
      WHEN 'succeeded' THEN 'Job completed'
      WHEN 'failed' THEN 'Job failed'
      WHEN 'cancelled' THEN 'Job cancelled'
    END,NEW.updated_at);
END;

CREATE TRIGGER jobs_event_deferred AFTER UPDATE OF lease_token ON jobs
WHEN OLD.status = 'running' AND NEW.status = 'running' AND OLD.lease_token IS NOT NULL AND NEW.lease_token IS NULL
BEGIN
  INSERT INTO job_events(job_id,attempt,level,message,created_at)
  VALUES (NEW.id,NEW.attempt,'info','Waiting for child jobs',NEW.updated_at);
END;
