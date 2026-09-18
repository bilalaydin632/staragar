const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SUPER_ADMIN = { nick: 'SHADOWLESS', password: '610622.aa' };

const BAN_DURATION_MS = 60 * 60 * 1000;
const SPAM_INTERVAL_MS = 5000;

const sessions = new Map();

async function seedSuperAdmin() {
  const { data } = await supabase.from('players').select('id').eq('nick', SUPER_ADMIN.nick).maybeSingle();
  if (data) return;
  const hash = bcrypt.hashSync(SUPER_ADMIN.password, 10);
  await supabase.from('players').insert({
    nick: SUPER_ADMIN.nick,
    password_hash: hash,
    role: 'super_admin',
    permissions: { all: true }
  });
  console.log('Super admin seeded: SHADOWLESS');
}

seedSuperAdmin().catch(err => console.error('Super admin seed error:', err.message));

async function register(nick, password, fingerprint) {
  nick = nick.trim().slice(0, 20);
  if (!nick || !password || nick.length < 2) return { error: 'Geçersiz nick veya şifre' };
  if (nick.toLowerCase() === 'shadowless') return { error: 'Bu nick kullanılamaz' };

  const { data: existing } = await supabase.from('players').select('id').eq('nick', nick).maybeSingle();
  if (existing) return { error: 'Bu nick zaten kayıtlı' };

  const { data: banned } = await supabase.from('bans')
    .select('id').eq('nick', nick).eq('active', true).maybeSingle();
  if (banned) return { error: 'Bu nick banlı' };

  const hash = bcrypt.hashSync(password, 10);
  const { data, error } = await supabase.from('players').insert({
    nick, password_hash: hash, role: 'player', permissions: {}, device_fingerprint: fingerprint
  }).select('id, nick, role, permissions').single();

  if (error) return { error: 'Kayıt başarısız' };
  return { player: data };
}

async function login(nick, password, fingerprint) {
  nick = nick.trim().slice(0, 20);
  const { data: player, error } = await supabase.from('players')
    .select('id, nick, password_hash, role, permissions').eq('nick', nick).maybeSingle();

  if (!player || error) return { error: 'Kullanıcı bulunamadı' };

  const valid = bcrypt.compareSync(password, player.password_hash);
  if (!valid) return { error: 'Hatalı şifre' };

  const banInfo = await checkBan(player.id, nick, fingerprint);
  if (banInfo.banned) return { error: `Banlısınız: ${banInfo.reason} (bitiş: ${banInfo.expiresAt || 'süresiz'})` };

  if (fingerprint) {
    await supabase.from('players').update({ device_fingerprint: fingerprint }).eq('id', player.id);
  }

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessions.set(token, { id: player.id, nick: player.nick, role: player.role, permissions: player.permissions || {} });
  return { token, player: { id: player.id, nick: player.nick, role: player.role, permissions: player.permissions || {} } };
}

async function checkBan(playerId, nick, fingerprint) {
  let query = supabase.from('bans').select('reason, expires_at, type').eq('active', true).eq('nick', nick);
  const { data: nickBans } = await query.maybeSingle();

  if (nickBans) {
    if (nickBans.expires_at && new Date(nickBans.expires_at) < new Date()) {
      await supabase.from('bans').update({ active: false }).eq('nick', nick).eq('active', true);
    } else {
      return { banned: true, reason: nickBans.reason || 'Banlı', expiresAt: nickBans.expires_at, type: nickBans.type };
    }
  }

  if (fingerprint) {
    const { data: fpBans } = await supabase.from('bans')
      .select('reason, expires_at, type').eq('active', true).eq('device_fingerprint', fingerprint).maybeSingle();
    if (fpBans) {
      if (fpBans.expires_at && new Date(fpBans.expires_at) < new Date()) {
        await supabase.from('bans').update({ active: false }).eq('device_fingerprint', fingerprint).eq('active', true);
      } else {
        return { banned: true, reason: fpBans.reason || 'Cihaz banlı', expiresAt: fpBans.expires_at, type: fpBans.type };
      }
    }
  }

  return { banned: false };
}

function getSession(token) {
  return sessions.get(token) || null;
}

function clearSession(token) {
  sessions.delete(token);
}

async function banPlayer(nick, reason, bannedBy, durationMs, fingerprint) {
  const expiresAt = durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : null;
  const { data: player } = await supabase.from('players').select('id, device_fingerprint').eq('nick', nick).maybeSingle();
  await supabase.from('bans').insert({
    player_id: player ? player.id : null,
    nick,
    type: 'chat',
    reason: reason || 'Kural ihlali',
    banned_by: bannedBy,
    device_fingerprint: fingerprint || (player ? player.device_fingerprint : null),
    expires_at: expiresAt,
    active: true
  });
}

async function unbanPlayer(nick) {
  await supabase.from('bans').update({ active: false }).eq('nick', nick).eq('active', true);
}

async function setPlayerRole(nick, role, permissions) {
  const { data, error } = await supabase.from('players')
    .update({ role, permissions: permissions || {} }).eq('nick', nick).select('id, nick, role, permissions').single();
  if (error) return { error: 'Oyuncu bulunamadı' };
  return { player: data };
}

async function getPlayerByNick(nick) {
  const { data } = await supabase.from('players')
    .select('id, nick, role, permissions').eq('nick', nick).maybeSingle();
  return data;
}

async function getAllPlayers() {
  const { data } = await supabase.from('players')
    .select('id, nick, role, permissions').order('created_at', { ascending: false });
  return data || [];
}

async function logChat(playerId, nick, room, message, chatType, chatCode) {
  await supabase.from('chat_logs').insert({
    player_id: playerId,
    nick, room, message, chat_type: chatType, chat_code: chatCode
  });
}

async function getChatLogs(limit) {
  const { data } = await supabase.from('chat_logs')
    .select('*').order('created_at', { ascending: false }).limit(limit || 100);
  return data || [];
}

async function getActiveBans() {
  const { data } = await supabase.from('bans')
    .select('*').eq('active', true).order('created_at', { ascending: false });
  return data || [];
}

module.exports = {
  supabase,
  register,
  login,
  checkBan,
  getSession,
  clearSession,
  banPlayer,
  unbanPlayer,
  setPlayerRole,
  getPlayerByNick,
  getAllPlayers,
  logChat,
  getChatLogs,
  getActiveBans,
  BAN_DURATION_MS,
  SPAM_INTERVAL_MS,
  SUPER_ADMIN
};
