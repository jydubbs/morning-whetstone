-- Subscribers to the daily question email.
CREATE TABLE IF NOT EXISTS subscribers (
  email       TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,      -- secret used in confirm and unsubscribe links
  confirmed   INTEGER NOT NULL DEFAULT 0, -- 1 once they click the confirm link
  created_at  TEXT NOT NULL,
  confirmed_at TEXT,
  last_sent   TEXT                        -- London date of the last daily email
);
CREATE INDEX IF NOT EXISTS idx_confirmed ON subscribers (confirmed);
