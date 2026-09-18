const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let socket = null;
let myId = null;
let myColor = '#4ECDC4';
let worldSize = 8000;
let currentMode = 'FFA1';
let currentRoom = 'FFA1';
let selectedRoom = 'FFA1';
let roomList = [];

let camera = { x: 0, y: 0, zoom: 1 };
let manualZoom = 0;
let mouseScreen = { x: 0, y: 0 };

let state = {
  mode: 'FFA1',
  roomName: 'FFA1',
  players: [],
  foods: [],
  viruses: [],
  projectiles: [],
  timeLeft: 3600000,
  lastWinner: null,
  winnerDisplayUntil: 0,
  shrinkRadius: null,
  worldSize: 8000,
  teams: null,
  territories: null
};

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

(function generateStarfield() {
  const sf = document.getElementById('starfield');
  if (!sf) return;
  const count = 120;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star-dot';
    const size = Math.random() * 2.5 + 0.5;
    star.style.width = size + 'px';
    star.style.height = size + 'px';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.setProperty('--dur', (Math.random() * 3 + 2) + 's');
    star.style.setProperty('--delay', Math.random() * 4 + 's');
    star.style.opacity = Math.random() * 0.6 + 0.2;
    sf.appendChild(star);
  }
})();

function screenToWorld(sx, sy) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    x: camera.x + (sx - cx) / camera.zoom,
    y: camera.y + (sy - cy) / camera.zoom
  };
}

canvas.addEventListener('mousemove', (e) => {
  mouseScreen.x = e.clientX;
  mouseScreen.y = e.clientY;
  if (socket && myId !== null) {
    const w = screenToWorld(e.clientX, e.clientY);
    socket.emit('mouse', { x: w.x, y: w.y });
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  manualZoom -= e.deltaY * 0.001;
  manualZoom = Math.max(-0.5, Math.min(1.5, manualZoom));
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (!socket || myId === null) return;
  if (e.key === 'w' || e.key === 'W') {
    socket.emit('eject');
  } else if (e.code === 'Space') {
    e.preventDefault();
    socket.emit('split');
  } else if (e.key === 'Control' || e.ctrlKey) {
    e.preventDefault();
    socket.emit('multiSplit');
  }
});

let eHoldInterval = null;
document.addEventListener('keydown', (e) => {
  if ((e.key === 'e' || e.key === 'E') && !eHoldInterval && socket && myId !== null) {
    socket.emit('ejectMany');
    eHoldInterval = setInterval(() => {
      socket.emit('ejectMany');
    }, 150);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'e' || e.key === 'E') {
    if (eHoldInterval) {
      clearInterval(eHoldInterval);
      eHoldInterval = null;
    }
  }
});

function getMyPlayer() {
  return state.players.find(p => p.id === myId);
}

function updateCamera() {
  const me = getMyPlayer();
  if (!me || !me.alive) return;

  camera.x += (me.cx - camera.x) * 0.15;
  camera.y += (me.cy - camera.y) * 0.15;

  let totalR = 0;
  let count = 0;
  for (const c of me.cells) {
    totalR += c.r;
    count++;
  }
  const avgR = count > 0 ? totalR / count : 30;

  const baseZoom = Math.min(1, 64 / Math.max(avgR, 20));
  const targetZoom = baseZoom * (1 + manualZoom);
  camera.zoom += (targetZoom - camera.zoom) * 0.1;
  camera.zoom = Math.max(0.1, Math.min(2.5, camera.zoom));
}

function worldToScreen(x, y) {
  return {
    x: (x - camera.x) * camera.zoom + canvas.width / 2,
    y: (y - camera.y) * camera.zoom + canvas.height / 2
  };
}

function darkenColor(hex, factor) {
  if (!hex || hex[0] !== '#') return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
}

function drawBackground() {
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const gridSize = 50 * camera.zoom;
  if (gridSize > 8) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
    ctx.lineWidth = 1;
    const offsetX = (-(camera.x * camera.zoom) % gridSize + canvas.width / 2) % gridSize;
    const offsetY = (-(camera.y * camera.zoom) % gridSize + canvas.height / 2) % gridSize;
    ctx.beginPath();
    for (let x = offsetX; x < canvas.width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    for (let y = offsetY; y < canvas.height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
  }

  const wx = (0 - camera.x) * camera.zoom + canvas.width / 2;
  const wy = (0 - camera.y) * camera.zoom + canvas.height / 2;
  const ws = worldSize * camera.zoom;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 4;
  ctx.strokeRect(wx, wy, ws, ws);
}

function drawTerritories() {
  if (!state.territories) return;
  const cx = worldSize / 2;
  const cy = worldSize / 2;
  for (const t of state.territories) {
    const s = worldToScreen(t.x, t.y);
    const w = t.w * camera.zoom;
    const h = t.h * camera.zoom;
    let fillColor = 'rgba(255,255,255,0.05)';
    if (t.owner) {
      const hash = t.owner.charCodeAt(0) + t.owner.charCodeAt(1) || 0;
      const hue = hash % 360;
      fillColor = `hsla(${hue}, 60%, 50%, 0.12)`;
    }
    ctx.fillStyle = fillColor;
    ctx.fillRect(s.x, s.y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(s.x, s.y, w, h);
    if (t.owner) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `${Math.max(10, 12 * camera.zoom)}px 'Inter', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.owner.slice(0, 8), s.x + w / 2, s.y + h / 2 - 8);
      ctx.fillStyle = 'rgba(255,215,0,0.7)';
      ctx.font = `${Math.max(9, 10 * camera.zoom)}px 'Inter', sans-serif`;
      ctx.fillText(t.score + 'p', s.x + w / 2, s.y + h / 2 + 8);
    }
  }
}

function drawShrinkZone() {
  if (state.shrinkRadius === null) return;
  const cx = worldSize / 2;
  const cy = worldSize / 2;
  const center = worldToScreen(cx, cy);
  const r = state.shrinkRadius * camera.zoom;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.arc(center.x, center.y, r, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(255, 0, 0, 0.12)';
  ctx.fill('evenodd');
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFoods() {
  const viewLeft = camera.x - canvas.width / 2 / camera.zoom;
  const viewRight = camera.x + canvas.width / 2 / camera.zoom;
  const viewTop = camera.y - canvas.height / 2 / camera.zoom;
  const viewBottom = camera.y + canvas.height / 2 / camera.zoom;

  for (const f of state.foods) {
    if (f.x < viewLeft || f.x > viewRight || f.y < viewTop || f.y > viewBottom) continue;
    const s = worldToScreen(f.x, f.y);
    const r = Math.max(3, 5 * camera.zoom);
    ctx.fillStyle = f.c;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawViruses() {
  for (const v of state.viruses) {
    const s = worldToScreen(v.x, v.y);
    const r = v.r * camera.zoom;
    if (s.x + r < 0 || s.x - r > canvas.width || s.y + r < 0 || s.y - r > canvas.height) continue;

    ctx.fillStyle = '#2ECC40';
    ctx.strokeStyle = '#1a8a28';
    ctx.lineWidth = Math.max(2, 3 * camera.zoom);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(s.x, s.y);
    const spikes = 24;
    ctx.beginPath();
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const ir = r * 0.82;
      const or = r * 1.12;
      ctx.lineTo(Math.cos(a) * or, Math.sin(a) * or);
      ctx.lineTo(Math.cos(a + Math.PI / spikes) * ir, Math.sin(a + Math.PI / spikes) * ir);
    }
    ctx.closePath();
    ctx.strokeStyle = '#1a8a28';
    ctx.lineWidth = Math.max(1.5, 2 * camera.zoom);
    ctx.stroke();
    ctx.restore();
  }
}

function drawProjectiles() {
  for (const p of state.projectiles) {
    const s = worldToScreen(p.x, p.y);
    const r = p.r * camera.zoom;
    if (s.x + r < 0 || s.x - r > canvas.width || s.y + r < 0 || s.y - r > canvas.height) continue;

    ctx.fillStyle = '#2ECC40';
    ctx.strokeStyle = '#1a8a28';
    ctx.lineWidth = Math.max(1.5, 2 * camera.zoom);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.translate(s.x, s.y);
    const spikes = 16;
    ctx.beginPath();
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const ir = r * 0.7;
      const or = r * 1.15;
      ctx.lineTo(Math.cos(a) * or, Math.sin(a) * or);
      ctx.lineTo(Math.cos(a + Math.PI / spikes) * ir, Math.sin(a + Math.PI / spikes) * ir);
    }
    ctx.closePath();
    ctx.strokeStyle = '#1a8a28';
    ctx.lineWidth = Math.max(1, 1.5 * camera.zoom);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPlayers() {
  const sorted = [...state.players].sort((a, b) => {
    let am = 0, bm = 0;
    for (const c of a.cells) am += c.m;
    for (const c of b.cells) bm += c.m;
    return am - bm;
  });

  for (const p of sorted) {
    if (!p.alive) continue;
    for (const cell of p.cells) {
      const s = worldToScreen(cell.x, cell.y);
      const r = cell.r * camera.zoom;
      if (s.x + r < 0 || s.x - r > canvas.width || s.y + r < 0 || s.y - r > canvas.height) continue;

      ctx.fillStyle = p.color;
      ctx.strokeStyle = darkenColor(p.color, 0.6);
      ctx.lineWidth = Math.max(2, r * 0.06);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (r > 20) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 2;
        ctx.font = `${Math.max(12, Math.min(r * 0.35, 28))}px 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const nameText = p.name;
        const massText = Math.floor(cell.m);
        if (r > 30) {
          ctx.fillText(nameText, s.x, s.y - 8);
          ctx.font = `${Math.max(10, Math.min(r * 0.25, 20))}px 'Segoe UI', sans-serif`;
          ctx.fillText(massText, s.x, s.y + 12);
        } else {
          ctx.fillText(nameText, s.x, s.y);
        }
      }
    }
  }
}

function drawHUD() {
  const me = getMyPlayer();
  if (me) {
    let totalMass = 0;
    for (const c of me.cells) totalMass += c.m;
    document.getElementById('massDisplay').textContent = Math.floor(totalMass);
  }

  const seconds = Math.ceil(state.timeLeft / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  document.getElementById('timerDisplay').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  document.getElementById('modeDisplay').textContent = state.mode || 'FFA1';

  const sorted = [...state.players].filter(p => p.alive).sort((a, b) => b.score - a.score);
  const top10 = sorted.slice(0, 10);
  const lbList = document.getElementById('lbList');
  lbList.innerHTML = '';
  top10.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === myId) li.className = 'me';
    li.innerHTML = `<span class="rank">${i + 1}.</span><span>${escapeHtml(p.name)}</span><span>${p.score}</span>`;
    lbList.appendChild(li);
  });

  const banner = document.getElementById('winnerBanner');
  if (state.lastWinner && Date.now() < state.winnerDisplayUntil) {
    banner.style.display = 'block';
    banner.textContent = `${state.lastWinner} kazandi!`;
  } else {
    banner.style.display = 'none';
  }

  updateTeamPanel();
  updateTerritoryPanel();
}

function updateTeamPanel() {
  const panel = document.getElementById('teamPanel');
  if (!state.teams || state.teams.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  const maxMass = Math.max(...state.teams.map(t => t.mass), 1);
  const bars = document.getElementById('teamBars');
  bars.innerHTML = '';
  for (const t of state.teams) {
    const row = document.createElement('div');
    row.className = 'team-bar-row';
    const pct = (t.mass / maxMass) * 100;
    row.innerHTML = `
      <span class="team-bar-label" style="color:${t.color}">${t.team}</span>
      <div class="team-bar-track"><div class="team-bar-fill" style="width:${pct}%;background:${t.color}"></div></div>
      <span class="team-bar-count">${t.count}</span>
    `;
    bars.appendChild(row);
  }
}

function updateTerritoryPanel() {
  const panel = document.getElementById('territoryPanel');
  if (!state.territories) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  const list = document.getElementById('territoryList');
  list.innerHTML = '';
  for (const t of state.territories) {
    const row = document.createElement('div');
    row.className = 'territory-row';
    if (t.owner) {
      row.innerHTML = `<span class="territory-owner">${escapeHtml(t.owner.slice(0, 12))}</span><span class="territory-score">${t.score}p</span>`;
    } else {
      row.innerHTML = `<span class="territory-unowned">Bölge ${t.id + 1}</span><span class="territory-score">-</span>`;
    }
    list.appendChild(row);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawTerritories();
  drawShrinkZone();
  drawFoods();
  drawViruses();
  drawProjectiles();
  drawPlayers();
  drawHUD();
  requestAnimationFrame(render);
}

render();

/* ── Room selection UI ── */

function renderRoomGrid() {
  const grid = document.getElementById('roomGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const r of roomList) {
    const card = document.createElement('div');
    card.className = 'room-card' + (r.name === selectedRoom ? ' selected' : '');
    card.dataset.room = r.name;
    const dotClass = r.players > 0 ? '' : ' empty';
    card.innerHTML = `
      <div class="room-card-name">${escapeHtml(r.name)}</div>
      <div class="room-card-info"><span class="room-card-dot${dotClass}"></span>${r.players} oyuncu</div>
    `;
    card.addEventListener('click', () => {
      selectedRoom = r.name;
      renderRoomGrid();
    });
    grid.appendChild(card);
  }
}

function joinGame() {
  const name = document.getElementById('nameInput').value.trim();
  socket = io();

  socket.on('roomList', (data) => {
    roomList = data;
    renderRoomGrid();
  });

  socket.on('joined', (data) => {
    myId = data.id;
    myColor = data.color;
    worldSize = data.worldSize;
    currentMode = data.mode;
    currentRoom = data.roomName;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 1;
    manualZoom = 0;
    const w = screenToWorld(mouseScreen.x, mouseScreen.y);
    socket.emit('mouse', { x: w.x, y: w.y });
  });

  socket.on('state', (data) => {
    state = data;
    if (data.worldSize) worldSize = data.worldSize;
    updateCamera();

    const me = getMyPlayer();
    if (me && !me.alive) {
      document.getElementById('respawnScreen').style.display = 'flex';
    } else {
      document.getElementById('respawnScreen').style.display = 'none';
    }
  });

  socket.emit('join', { name, room: selectedRoom });
}

document.getElementById('playBtn').addEventListener('click', joinGame);
document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinGame();
});

document.getElementById('respawnBtn').addEventListener('click', () => {
  if (socket) {
    socket.emit('respawn');
    document.getElementById('respawnScreen').style.display = 'none';
  }
});
