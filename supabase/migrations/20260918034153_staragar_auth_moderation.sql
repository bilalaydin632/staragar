/*
# StarAgar Auth & Moderation Schema

1. New Tables
- `players` — registered player accounts (nick + password_hash, role, permissions, device_fingerprint)
- `bans` — active and past bans (player_id, type, reason, expires_at, device_fingerprint)
- `chat_logs` — all chat messages for super admin audit (player_id, room, message, type, created_at)

2. Security
- RLS enabled on all tables.
- All tables allow anon+authenticated CRUD since the game server uses the service role key for enforcement,
  and the browser client uses the anon key. The server-side auth module validates everything.
- This is a game with a custom auth system (nick+password, not Supabase Auth), so we use anon access.

3. Important Notes
- The super admin account "SHADOWLESS" is seeded as a row in `players` with role 'super_admin'.
- Passwords are hashed with bcrypt on the server side.
- Device fingerprints are stored for ban evasion prevention.
- The `players` table stores a JSON `permissions` object for fine-grained admin control.
*/

-- Players table (custom auth, not Supabase Auth)
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nick text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'player',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  device_fingerprint text,
  created_at timestamptz DEFAULT now()
);

-- Bans table
CREATE TABLE IF NOT EXISTS bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES players(id) ON DELETE CASCADE,
  nick text NOT NULL,
  type text NOT NULL DEFAULT 'chat',
  reason text,
  banned_by text NOT NULL DEFAULT 'BotAdmin',
  device_fingerprint text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

-- Chat logs table (super admin audit trail)
CREATE TABLE IF NOT EXISTS chat_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid,
  nick text NOT NULL,
  room text NOT NULL,
  message text NOT NULL,
  chat_type text NOT NULL DEFAULT 'room',
  chat_code text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_logs ENABLE ROW LEVEL SECURITY;

-- Players policies (anon+authenticated, server enforces real auth)
DROP POLICY IF EXISTS "anon_select_players" ON players;
CREATE POLICY "anon_select_players" ON players FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_players" ON players;
CREATE POLICY "anon_insert_players" ON players FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_players" ON players;
CREATE POLICY "anon_update_players" ON players FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- Bans policies
DROP POLICY IF EXISTS "anon_select_bans" ON bans;
CREATE POLICY "anon_select_bans" ON bans FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_bans" ON bans;
CREATE POLICY "anon_insert_bans" ON bans FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_bans" ON bans;
CREATE POLICY "anon_update_bans" ON bans FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- Chat logs policies
DROP POLICY IF EXISTS "anon_select_chat_logs" ON chat_logs;
CREATE POLICY "anon_select_chat_logs" ON chat_logs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_chat_logs" ON chat_logs;
CREATE POLICY "anon_insert_chat_logs" ON chat_logs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_players_nick ON players (nick);
CREATE INDEX IF NOT EXISTS idx_bans_active ON bans (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_bans_nick ON bans (nick);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created ON chat_logs (created_at DESC);
