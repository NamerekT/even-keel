-- Frozen sample of the state database at schema step 1 (BTN-147): the frozen sample of the files of schema v9
-- imported, plus a handoff snapshot and a closed task. A later step migrates it; this file is never edited.
CREATE TABLE chain_flags (
  name  TEXT PRIMARY KEY CHECK (name IN ('unattended', 'trimTools')),
  value TEXT NOT NULL
);
CREATE TABLE chains (
  position   INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  chain      TEXT NOT NULL
);
CREATE TABLE chain_queue (
  position   INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL
);
CREATE TABLE chain_lists (
  project_id TEXT NOT NULL,
  list       TEXT NOT NULL CHECK (list IN ('orders', 'skipped', 'leftovers', 'released', 'ci')),
  value      TEXT NOT NULL,
  PRIMARY KEY (project_id, list)
);
CREATE TABLE questions (
  position   INTEGER PRIMARY KEY,
  task       TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ask        TEXT NOT NULL,
  comment    TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE launches (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task       TEXT NOT NULL,
  session_id TEXT NOT NULL,
  reason     TEXT,
  extra      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX launches_session ON launches (session_id);
CREATE INDEX launches_task ON launches (task);
CREATE TABLE handoffs (
  session_id TEXT PRIMARY KEY,
  at         TEXT,
  task       TEXT,
  previous   TEXT,
  reason     TEXT,
  prompt     TEXT,
  note_path  TEXT,
  note       TEXT
);
CREATE TABLE closed_tasks (
  project_id TEXT NOT NULL,
  task       TEXT NOT NULL,
  tracker    TEXT NOT NULL,
  title      TEXT NOT NULL,
  url        TEXT,
  closed_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, task)
);
PRAGMA user_version = 1;

INSERT INTO chain_flags (name, value) VALUES ('unattended', 'false');
INSERT INTO chain_flags (name, value) VALUES ('trimTools', 'true');
INSERT INTO chains (position, project_id, chain) VALUES (0, '11111111-1111-4111-8111-111111111111', '{"current":{"task":"ABC-2","sessionId":"00000000-0000-4000-8000-0000000000a1","since":"2026-10-01T10:00:00.000Z"},"paused":false,"error":null}');
INSERT INTO chain_queue (position, project_id) VALUES (0, '22222222-2222-4222-8222-222222222222');
INSERT INTO chain_lists (project_id, list, value) VALUES ('11111111-1111-4111-8111-111111111111', 'orders', '["ABC-1","ABC-2","ABC-3"]');
INSERT INTO chain_lists (project_id, list, value) VALUES ('22222222-2222-4222-8222-222222222222', 'orders', '["XYZ-7"]');
INSERT INTO chain_lists (project_id, list, value) VALUES ('11111111-1111-4111-8111-111111111111', 'skipped', '["ABC-9"]');
INSERT INTO chain_lists (project_id, list, value) VALUES ('22222222-2222-4222-8222-222222222222', 'leftovers', '[{"task":"XYZ-1","at":"2026-10-01T09:00:00.000Z","notice":{"code":"text","params":{"text":"dirty worktree"}}}]');
INSERT INTO chain_lists (project_id, list, value) VALUES ('11111111-1111-4111-8111-111111111111', 'released', '["ABC-1"]');
INSERT INTO chain_lists (project_id, list, value) VALUES ('11111111-1111-4111-8111-111111111111', 'ci', '{"green":"0123456789abcdef0123456789abcdef01234567","afterGreen":"0123456789abcdef0123456789abcdef01234567"}');
INSERT INTO questions (position, task, session_id, ask, comment, done) VALUES (0, 'ABC-2', '00000000-0000-4000-8000-0000000000a1', 'toolu_example1', 'comment-example-1', 0);
INSERT INTO launches (id, at, project_id, task, session_id, reason, extra) VALUES (1, '2026-10-01T08:00:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-1', '00000000-0000-4000-8000-0000000000a0', NULL, '{"fallback":"codex"}');
INSERT INTO launches (id, at, project_id, task, session_id, reason, extra) VALUES (2, '2026-10-01T10:00:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-2', '00000000-0000-4000-8000-0000000000a1', 'restart', '{"previous":"00000000-0000-4000-8000-0000000000a0"}');
INSERT INTO launches (id, at, project_id, task, session_id, reason, extra) VALUES (3, '2026-10-01T11:00:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-FIX', '00000000-0000-4000-8000-0000000000f0', NULL, '{"commit":"c6b39560000000000000000000000000000000aa"}');
INSERT INTO launches (id, at, project_id, task, session_id, reason, extra) VALUES (4, '2026-10-01T11:20:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-FIX', '00000000-0000-4000-8000-0000000000f0', 'landed', '{"commit":"15945fe0000000000000000000000000000000bb"}');
INSERT INTO launches (id, at, project_id, task, session_id, reason, extra) VALUES (5, '2026-10-01T12:00:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-FIX', '00000000-0000-4000-8000-0000000000f1', NULL, '{"commit":"d00d0000000000000000000000000000000000cc"}');
INSERT INTO launches (id, at, project_id, task, session_id, reason, extra) VALUES (6, '2026-10-01T12:05:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-FIX', '00000000-0000-4000-8000-0000000000f1', 'dropped', '{}');
INSERT INTO handoffs (session_id, at, task, previous, reason, prompt, note_path, note) VALUES ('00000000-0000-4000-8000-0000000000a3', '2026-10-05T10:00:00.000Z', 'ABC-2', '00000000-0000-4000-8000-0000000000a2', 'relay', 'ABC-2

Continuation: read the handoff note first.', 'C:\repos\example-project\.temp\handoff.md', '# ABC-2 handoff

Done: the parser.');
INSERT INTO closed_tasks (project_id, task, tracker, title, url, closed_at) VALUES ('11111111-1111-4111-8111-111111111111', 'ABC-1', 'huly', 'Parse the example input', 'https://huly.example.com/workbench/example/browse/ABC-1', '2026-10-04T12:00:00.000Z');
