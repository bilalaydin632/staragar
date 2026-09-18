const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Room, WORLD_SIZE } = require('./Room');
const auth = require('./auth');
const mod = require('./moderation');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.static('public'));

const TICK_MS = 50;

const ROOM_DEFS = [
  { name: 'FFA1', mode: 'FFA1' },
  { name: 'FFA Rainbow', mode: 'FFA Rainbow' },
  { name: 'Virus 1', mode: 'Virus 1' },
  { name: 'Virus 2', mode: 'Virus 2' },
  { name: 'Virus 3', mode: 'Virus 3' },
  { name: 'Virus Rainbow', mode: 'Virus Rainbow' },
  { name: 'Battle Royale', mode: 'Battle Royale' },
  { name: 'Teams', mode: 'Teams' },
  { name: 'Clan Wars', mode: 'Clan Wars' }
];

const rooms = new Map();
for (const def of ROOM_DEFS) {
  rooms.set(def.name, new Room(def.name, def.mode));
}

const socketRoom = new Map();
const socketPlayer = new Map();
const socketAuth = new Map();
const socketChatCode = new Map();

let lastTick = Date.now();

function gameLoop() {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;
  for (const room of rooms.values()) {
    room.tick(dt);
  }
}
setInterval(gameLoop, TICK_MS);

function broadcastState() {
  for (const [name, room] of rooms) {
    const state = room.getState();
    for (const [socketId] of room.players) {
      io.to(socketId).emit('state', state);
    }
  }
  const roomList = Array.from(rooms.values()).map(r => ({
    name: r.name, mode: r.mode, players: r.getPlayerCount()
  }));
  io.emit('roomList', roomList);
}
setInterval(broadcastState, TICK_MS);

function hasPermission(session, perm) {
  if (!session) return false;
  if (session.role === 'super_admin') return true;
  if (session.permissions && session.permissions.all) return true;
  return !!(session.permissions && session.permissions[perm]);
}

function getBadge(role) {
  if (role === 'super_admin') return { icon: 'SA', color: '#FFD700', label: 'Süper Admin' };
  if (role === 'admin') return { icon: 'A', color: '#FF6B6B', label: 'Admin' };
  if (role === 'moderator') return { icon: 'M', color: '#4ECDC4', label: 'Moderatör' };
  return null;
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.emit('roomList', Array.from(rooms.values()).map(r => ({
    name: r.name, mode: r.mode, players: r.getPlayerCount()
  })));

  socket.on('register', async (data) => {
    const { nick, password, fingerprint } = data || {};
    const result = await auth.register(nick, password, fingerprint);
    if (result.error) {
      socket.emit('authError', { msg: result.error });
      return;
    }
    const loginResult = await auth.login(nick, password, fingerprint);
    if (loginResult.error) {
      socket.emit('authError', { msg: loginResult.error });
      return;
    }
    socketAuth.set(socket.id, { token: loginResult.token, ...loginResult.player });
    socket.emit('authSuccess', { player: loginResult.player, token: loginResult.token });
  });

  socket.on('login', async (data) => {
    const { nick, password, fingerprint } = data || {};
    const result = await auth.login(nick, password, fingerprint);
    if (result.error) {
      socket.emit('authError', { msg: result.error });
      return;
    }
    socketAuth.set(socket.id, { token: result.token, ...result.player });
    socket.emit('authSuccess', { player: result.player, token: result.token });
  });

  socket.on('join', (data) => {
    const authData = socketAuth.get(socket.id);
    const roomName = (data && typeof data === 'object') ? data.room : 'FFA1';
    let playerName;

    if (authData) {
      playerName = authData.nick;
    } else {
      playerName = 'star';
    }

    const room = rooms.get(roomName);
    if (!room) {
      socket.emit('error', { msg: 'Oda bulunamadı' });
      return;
    }

    const oldRoom = socketRoom.get(socket.id);
    if (oldRoom) oldRoom.players.delete(socket.id);

    const player = room.createPlayer(socket.id, playerName);
    if (authData) {
      player.role = authData.role;
      player.permissions = authData.permissions;
      player.registered = true;
    } else {
      player.registered = false;
    }

    room.players.set(socket.id, player);
    socketRoom.set(socket.id, room);
    socketPlayer.set(socket.id, player);

    socket.emit('joined', {
      id: player.id,
      worldSize: WORLD_SIZE,
      color: player.color,
      roomName: room.name,
      mode: room.mode,
      registered: player.registered,
      role: authData ? authData.role : 'player',
      badge: getBadge(authData ? authData.role : 'player')
    });

    console.log(`${playerName} joined ${roomName} (id=${player.id})`);
  });

  socket.on('mouse', (data) => {
    const player = socketPlayer.get(socket.id);
    if (!player) return;
    player.mouseX = data.x;
    player.mouseY = data.y;
  });

  socket.on('split', () => {
    const player = socketPlayer.get(socket.id);
    const room = socketRoom.get(socket.id);
    if (player && room && player.alive) room.splitPlayer(player);
  });

  socket.on('multiSplit', () => {
    const player = socketPlayer.get(socket.id);
    const room = socketRoom.get(socket.id);
    if (player && room && player.alive) room.multiSplit(player);
  });

  socket.on('eject', () => {
    const player = socketPlayer.get(socket.id);
    const room = socketRoom.get(socket.id);
    if (player && room && player.alive) room.ejectMass(player, 1);
  });

  socket.on('ejectMany', () => {
    const player = socketPlayer.get(socket.id);
    const room = socketRoom.get(socket.id);
    if (player && room && player.alive) room.ejectMass(player, 7);
  });

  socket.on('feedVirus', () => {
    const player = socketPlayer.get(socket.id);
    const room = socketRoom.get(socket.id);
    if (player && room && player.alive) room.feedVirus(player);
  });

  socket.on('respawn', () => {
    const player = socketPlayer.get(socket.id);
    const room = socketRoom.get(socket.id);
    if (player && room) room.respawnIfNeeded(player);
  });

  socket.on('chatJoin', (code) => {
    socketChatCode.set(socket.id, code);
    socket.emit('chatJoined', { code });
  });

  socket.on('chatLeave', () => {
    socketChatCode.delete(socket.id);
  });

  socket.on('chat', async (data) => {
    const authData = socketAuth.get(socket.id);
    if (!authData) {
      socket.emit('chatError', { msg: 'Sohbet için kayıt olup giriş yapmalısınız' });
      return;
    }

    const player = socketPlayer.get(socket.id);
    const room = socketRoom.get(socket.id);
    if (!player || !room) return;

    const message = (data.message || '').trim().slice(0, 200);
    if (!message) return;

    const isCommand = message.startsWith('/');

    if (isCommand) {
      handleCommand(socket, message, authData, room, player);
      return;
    }

    const modResult = mod.moderateMessage(message, authData.nick);
    if (modResult.action === 'ban') {
      await auth.banPlayer(authData.nick, modResult.reason, 'BotAdmin', auth.BAN_DURATION_MS, null);
      socket.emit('chatError', { msg: `Bot Admin tarafından banlandınız: ${modResult.reason} (1 saat)` });
      socket.emit('banned', { reason: modResult.reason, duration: '1 saat' });
      return;
    }
    if (modResult.action === 'block') {
      socket.emit('chatError', { msg: modResult.reason });
      return;
    }

    const chatCode = socketChatCode.get(socket.id);
    const chatType = chatCode ? 'private' : 'room';
    const chatMsg = {
      nick: authData.nick,
      message,
      type: chatType,
      code: chatCode,
      badge: getBadge(authData.role),
      timestamp: Date.now()
    };

    auth.logChat(authData.id, authData.nick, room.name, message, chatType, chatCode).catch(() => {});

    if (chatCode) {
      for (const [sid, code] of socketChatCode) {
        if (code === chatCode) {
          io.to(sid).emit('chat', chatMsg);
        }
      }
    } else {
      for (const [sid] of room.players) {
        io.to(sid).emit('chat', chatMsg);
      }
    }
  });

  socket.on('disconnect', () => {
    const room = socketRoom.get(socket.id);
    if (room) room.players.delete(socket.id);
    socketRoom.delete(socket.id);
    socketPlayer.delete(socket.id);
    socketAuth.delete(socket.id);
    socketChatCode.delete(socket.id);
    console.log('Player disconnected:', socket.id);
  });
});

async function handleCommand(socket, message, authData, room, player) {
  const parts = message.slice(1).split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  if (cmd === 'help') {
    socket.emit('chat', {
      nick: 'Sistem',
      message: 'Komutlar: /ban <nick> [süre] [sebep], /unban <nick>, /kick <nick>, /mute <nick>, /ghost <nick>, /setrole <nick> <rol>, /setperm <nick> <perm> <true/false>, /players, /bans, /logs',
      type: 'system',
      badge: null,
      timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'players') {
    if (!hasPermission(authData, 'view_players')) {
      socket.emit('chatError', { msg: 'Yetkiniz yok' });
      return;
    }
    const players = await auth.getAllPlayers();
    socket.emit('chat', {
      nick: 'Sistem',
      message: `Kayıtlı oyuncular: ${players.map(p => `${p.nick}(${p.role})`).join(', ')}`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'bans') {
    if (!hasPermission(authData, 'view_bans')) {
      socket.emit('chatError', { msg: 'Yetkiniz yok' });
      return;
    }
    const bans = await auth.getActiveBans();
    socket.emit('chat', {
      nick: 'Sistem',
      message: `Aktif banlar: ${bans.map(b => `${b.nick}(${b.reason})`).join(', ') || 'Yok'}`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'logs') {
    if (authData.role !== 'super_admin' && !(authData.permissions && authData.permissions.all)) {
      socket.emit('chatError', { msg: 'Sadece süper admin logları görebilir' });
      return;
    }
    const logs = await auth.getChatLogs(20);
    socket.emit('chat', {
      nick: 'Sistem',
      message: `Son mesajlar: ${logs.map(l => `${l.nick}: ${l.message}`).join(' | ')}`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'ban') {
    if (!hasPermission(authData, 'ban')) {
      socket.emit('chatError', { msg: 'Ban yetkiniz yok' });
      return;
    }
    const targetNick = args[0];
    const durationArg = args[1];
    const reason = args.slice(2).join(' ') || 'Admin banı';
    let durationMs = auth.BAN_DURATION_MS;
    if (durationArg === 'perm' || durationArg === 'süresiz') durationMs = 0;
    else if (durationArg && !isNaN(parseInt(durationArg))) durationMs = parseInt(durationArg) * 60 * 1000;

    await auth.banPlayer(targetNick, reason, authData.nick, durationMs, null);
    socket.emit('chat', {
      nick: 'Sistem',
      message: `${targetNick} banlandı: ${reason} (${durationMs === 0 ? 'süresiz' : durationMs / 60000 + ' dk'})`,
      type: 'system', badge: null, timestamp: Date.now()
    });

    for (const [sid, a] of socketAuth) {
      if (a.nick === targetNick) {
        io.to(sid).emit('banned', { reason, duration: durationMs === 0 ? 'süresiz' : durationMs / 60000 + ' dk' });
      }
    }
    return;
  }

  if (cmd === 'unban') {
    if (!hasPermission(authData, 'ban')) {
      socket.emit('chatError', { msg: 'Yetkiniz yok' });
      return;
    }
    await auth.unbanPlayer(args[0]);
    socket.emit('chat', {
      nick: 'Sistem',
      message: `${args[0]} banı kaldırıldı`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'kick') {
    if (!hasPermission(authData, 'kick')) {
      socket.emit('chatError', { msg: 'Yetkiniz yok' });
      return;
    }
    for (const [sid, a] of socketAuth) {
      if (a.nick === args[0]) {
        io.to(sid).emit('kicked', { reason: args.slice(1).join(' ') || 'Atıldınız' });
      }
    }
    socket.emit('chat', {
      nick: 'Sistem', message: `${args[0]} atıldı`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'mute') {
    if (!hasPermission(authData, 'mute')) {
      socket.emit('chatError', { msg: 'Yetkiniz yok' });
      return;
    }
    mod.clearSpamTimer(args[0]);
    socket.emit('chat', {
      nick: 'Sistem', message: `${args[0]} susturuldu (geçici)`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'ghost') {
    if (!hasPermission(authData, 'ghost')) {
      socket.emit('chatError', { msg: 'Hayalet mod yetkiniz yok' });
      return;
    }
    const targetNick = args[0];
    await auth.banPlayer(targetNick, 'Hayalet modu (hile tespiti)', authData.nick, 0, null);
    for (const [sid, a] of socketAuth) {
      if (a.nick === targetNick) {
        io.to(sid).emit('ghosted', { reason: 'Hayalet modu aktif' });
      }
    }
    socket.emit('chat', {
      nick: 'Sistem', message: `${targetNick} hayalet moduna alındı`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'setrole') {
    if (authData.role !== 'super_admin') {
      socket.emit('chatError', { msg: 'Sadece süper admin rol değiştirebilir' });
      return;
    }
    const targetNick = args[0];
    const role = args[1];
    if (!['player', 'moderator', 'admin'].includes(role)) {
      socket.emit('chatError', { msg: 'Geçersiz rol: player, moderator, admin' });
      return;
    }
    const result = await auth.setPlayerRole(targetNick, role, role === 'player' ? {} : undefined);
    if (result.error) {
      socket.emit('chatError', { msg: result.error });
      return;
    }
    socket.emit('chat', {
      nick: 'Sistem', message: `${targetNick} rolü ${role} olarak ayarlandı`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  if (cmd === 'setperm') {
    if (authData.role !== 'super_admin') {
      socket.emit('chatError', { msg: 'Sadece süper admin yetki ayarlayabilir' });
      return;
    }
    const targetNick = args[0];
    const perm = args[1];
    const value = args[2] === 'true';
    const targetPlayer = await auth.getPlayerByNick(targetNick);
    if (!targetPlayer) {
      socket.emit('chatError', { msg: 'Oyuncu bulunamadı' });
      return;
    }
    const perms = targetPlayer.permissions || {};
    perms[perm] = value;
    await auth.setPlayerRole(targetNick, targetPlayer.role, perms);
    socket.emit('chat', {
      nick: 'Sistem', message: `${targetNick} yetki ${perm} = ${value}`,
      type: 'system', badge: null, timestamp: Date.now()
    });
    return;
  }

  socket.emit('chatError', { msg: 'Bilinmeyen komut: /help' });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`StarAgar server running on port ${PORT}`);
});
