CREATE TABLE IF NOT EXISTS ledgerdiff_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS ledgerdiff_sessions_expire_idx ON ledgerdiff_sessions(expire);

CREATE TABLE IF NOT EXISTS ledgerdiff_reports (
  id uuid PRIMARY KEY,
  owner_sid varchar NOT NULL REFERENCES ledgerdiff_sessions(sid) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  notes varchar(2000) NOT NULL DEFAULT '',
  key_column text NOT NULL,
  before_filename varchar(255) NOT NULL,
  after_filename varchar(255) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledgerdiff_reports_owner_created_idx ON ledgerdiff_reports(owner_sid, created_at DESC);
