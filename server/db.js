'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    totp_secret   TEXT,
    totp_enabled  INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    owner_id     TEXT NOT NULL REFERENCES users(id),
    password_hash TEXT,
    locked       INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    ended_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT,
    action     TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scheduled_meetings (
    id            TEXT PRIMARY KEY,
    host_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    room_id       TEXT,
    password_hash TEXT,
    start_at      INTEGER NOT NULL,
    duration_min  INTEGER NOT NULL DEFAULT 60,
    timezone      TEXT DEFAULT 'Asia/Kolkata',
    recurrence    TEXT DEFAULT 'none',
    reminder_sent INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'scheduled',
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meeting_invites (
    id          TEXT PRIMARY KEY,
    meeting_id  TEXT NOT NULL REFERENCES scheduled_meetings(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    invited_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_meetings_host ON scheduled_meetings(host_id, start_at);
  CREATE INDEX IF NOT EXISTS idx_meetings_start ON scheduled_meetings(start_at);
  CREATE INDEX IF NOT EXISTS idx_invites_meeting ON meeting_invites(meeting_id);

  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id);
`);

module.exports = db;