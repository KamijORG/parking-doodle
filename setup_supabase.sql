-- Create tables for the parking reservation system

-- Table to store the global application state (preserving db.json structure for now)
create table if not exists parking_state (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamp with time zone default now()
);

-- Table to store secret tokens for apartments
create table if not exists parking_tokens (
  token text primary key,
  apt text not null,
  created_at timestamp with time zone default now()
);

-- Initial tokens (copy from tokens.json or generate new ones)
-- INSERT INTO parking_tokens (token, apt) VALUES ('token1', '1'), ('token2', '2'), ...;

-- Initial state
-- INSERT INTO parking_state (id, data) VALUES (1, '{"reservations": {"1": {}, "2": {}, "3": {}, "4": {}}, "penalties": {}, "reports": {}, "logs": []}');
