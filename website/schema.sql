-- Cloudflare D1 schema for the waitlist. Apply once: wrangler d1 execute whittlebrowser-waitlist --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT NOT NULL,
  interest   TEXT NOT NULL,   -- which list: 'cloud' or 'mac'
  created_at TEXT NOT NULL,   -- ISO 8601, UTC
  PRIMARY KEY (email, interest)
);
