const WORLD_SIZE = 8000;
const FOOD_COUNT = 1500;
const VIRUS_COUNT = 25;
const MAX_CELLS = 16;
const SPLIT_COOLDOWN = 6000;
const EJECT_MASS = 14;
const MIN_EJECT_MASS = 20;
const MIN_SPLIT_MASS = 35;
const MIN_EAT_MASS_RATIO = 1.25;
const VIRUS_MASS = 100;
const VIRUS_SPLIT_MASS = 150;
const MAX_MASS = 150000;
const START_MASS = 20;
const FOOD_MASS = 1;
const ROUND_DURATION = 60 * 60 * 1000;
const TICK_MS = 50;

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#FFD93D', '#6BCB77', '#4D96FF',
  '#FF6FA5', '#FFA07A', '#9B59B6', '#3498DB', '#E67E22',
  '#2ECC71', '#E74C3C', '#1ABC9C', '#F39C12', '#16A085',
  '#D35400', '#27AE60', '#2980B9', '#8E44AD', '#C0392B'
];

const TEAM_COLORS = {
  red: '#E74C3C',
  blue: '#3498DB',
  green: '#2ECC71'
};

const VIRUS_COLOR = '#2ECC40';

const RAINBOW_COLORS = [
  '#FF0000', '#FF7F00', '#FFD700', '#00FF00', '#0000FF',
  '#4B0082', '#9400D3', '#FF1493', '#00FFFF', '#FF00FF'
];

const MODE_CONFIGS = {
  FFA1:        { type: 'ffa', virusShoot: true,  rainbow: false, virusBurst: 0,  shrink: false, teams: null,  territories: false },
  'FFA Rainbow':{ type: 'ffa', virusShoot: true,  rainbow: true,  virusBurst: 0,  shrink: false, teams: null,  territories: false },
  'Virus 1':    { type: 'ffa', virusShoot: false, rainbow: false, virusBurst: 30, shrink: false, teams: null,  territories: false },
  'Virus 2':    { type: 'ffa', virusShoot: false, rainbow: false, virusBurst: 60, shrink: false, teams: null,  territories: false },
  'Virus 3':    { type: 'ffa', virusShoot: false, rainbow: false, virusBurst: 100,shrink: false, teams: null,  territories: false },
  'Virus Rainbow':{ type: 'ffa', virusShoot: false, rainbow: true, virusBurst: 60, shrink: false, teams: null,  territories: false },
  'Battle Royale':{ type: 'br', virusShoot: false, rainbow: false, virusBurst: 0, shrink: true,  teams: null,  territories: false },
  Teams:       { type: 'team', virusShoot: false, rainbow: false, virusBurst: 0,  shrink: false, teams: ['red','blue','green'], territories: false },
  'Clan Wars':  { type: 'clan', virusShoot: false, rainbow: false, virusBurst: 0, shrink: false, teams: null, territories: true }
};

let foodIdCounter = 0;
let playerIdCounter = 0;
let virusIdCounter = 0;
let projectileIdCounter = 0;

function randColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function radiusFromMass(mass) {
  return Math.sqrt(mass) * 4;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rainbowColor(t) {
  const idx = Math.floor(t * 0.001) % RAINBOW_COLORS.length;
  return RAINBOW_COLORS[idx];
}

class Room {
  constructor(name, mode) {
    this.name = name;
    this.mode = mode;
    this.config = MODE_CONFIGS[mode];
    this.foods = [];
    this.viruses = [];
    this.projectiles = [];
    this.players = new Map();
    this.roundStartTime = Date.now();
    this.lastWinner = null;
    this.lastWinnerTime = 0;
    this.shrinkRadius = WORLD_SIZE / 2;
    this.territories = [];
    this.rainbowTime = 0;
    this.initWorld();
    if (this.config.territories) this.initTerritories();
  }

  initWorld() {
    this.foods = [];
    this.viruses = [];
    this.projectiles = [];
    for (let i = 0; i < FOOD_COUNT; i++) this.foods.push(this.spawnFood());
    for (let i = 0; i < VIRUS_COUNT; i++) this.viruses.push(this.spawnVirus());
    this.roundStartTime = Date.now();
    this.lastWinner = null;
    this.shrinkRadius = WORLD_SIZE / 2;
  }

  initTerritories() {
    const cols = 3, rows = 3;
    const cw = WORLD_SIZE / cols;
    const ch = WORLD_SIZE / rows;
    this.territories = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.territories.push({
          id: r * cols + c,
          x: c * cw, y: r * ch, w: cw, h: ch,
          owner: null, score: 0
        });
      }
    }
  }

  spawnFood() {
    return {
      id: foodIdCounter++,
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      color: this.config.rainbow ? RAINBOW_COLORS[0] : randColor(),
      mass: FOOD_MASS
    };
  }

  spawnVirus() {
    return {
      id: virusIdCounter++,
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      mass: VIRUS_MASS,
      color: VIRUS_COLOR,
      vx: 0, vy: 0
    };
  }

  createPlayer(socketId, name) {
    const x = WORLD_SIZE / 2 + (Math.random() - 0.5) * 2000;
    const y = WORLD_SIZE / 2 + (Math.random() - 0.5) * 2000;
    let color = randColor();
    let team = null;
    if (this.config.type === 'team') {
      const teamCounts = { red: 0, blue: 0, green: 0 };
      for (const p of this.players.values()) {
        if (p.team) teamCounts[p.team]++;
      }
      team = Object.keys(teamCounts).sort((a, b) => teamCounts[a] - teamCounts[b])[0];
      color = TEAM_COLORS[team];
    }
    return {
      id: playerIdCounter++,
      socketId,
      name,
      color,
      team,
      cells: [{
        id: 0, x, y,
        mass: START_MASS,
        vx: 0, vy: 0,
        splitTime: 0, mergeTime: 0
      }],
      mouseX: x, mouseY: y,
      lastEject: 0,
      score: 0,
      alive: true
    };
  }

  getTotalMass(player) {
    return player.cells.reduce((s, c) => s + c.mass, 0);
  }

  getCenter(player) {
    let tx = 0, ty = 0, tm = 0;
    for (const c of player.cells) {
      tx += c.x * c.mass;
      ty += c.y * c.mass;
      tm += c.mass;
    }
    if (tm === 0) return { x: 0, y: 0, mass: 0 };
    return { x: tx / tm, y: ty / tm, mass: tm };
  }

  moveCells(player, dt) {
    for (const cell of player.cells) {
      const r = radiusFromMass(cell.mass);
      const dx = player.mouseX - cell.x;
      const dy = player.mouseY - cell.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) {
        const speed = Math.max(1, 220 / Math.sqrt(r));
        const moveDist = Math.min(speed * dt, dist);
        cell.x += (dx / dist) * moveDist;
        cell.y += (dy / dist) * moveDist;
      }
      cell.x = clamp(cell.x, r, WORLD_SIZE - r);
      cell.y = clamp(cell.y, r, WORLD_SIZE - r);
      if (cell.splitTime > 0) {
        cell.x += cell.vx * dt;
        cell.y += cell.vy * dt;
        cell.x = clamp(cell.x, r, WORLD_SIZE - r);
        cell.y = clamp(cell.y, r, WORLD_SIZE - r);
        cell.vx *= 0.92;
        cell.vy *= 0.92;
        if (Math.abs(cell.vx) < 0.5) cell.vx = 0;
        if (Math.abs(cell.vy) < 0.5) cell.vy = 0;
        cell.splitTime -= dt;
      }
      if (cell.mergeTime > 0) cell.mergeTime -= dt;
    }
  }

  resolveCollisions(player) {
    for (let i = 0; i < player.cells.length; i++) {
      for (let j = i + 1; j < player.cells.length; j++) {
        const a = player.cells[i];
        const b = player.cells[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ra = radiusFromMass(a.mass);
        const rb = radiusFromMass(b.mass);
        const minDist = ra + rb;
        if (dist < minDist && dist > 0) {
          const canMerge = a.mergeTime <= 0 && b.mergeTime <= 0;
          if (canMerge) {
            a.mass += b.mass;
            a.x = (a.x * a.mass + b.x * b.mass) / (a.mass + b.mass);
            a.y = (a.y * a.mass + b.y * b.mass) / (a.mass + b.mass);
            player.cells.splice(j, 1);
            j--;
            continue;
          }
          const overlap = minDist - dist;
          const push = overlap / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  }

  softMerge(player, dt) {
    for (let i = 0; i < player.cells.length; i++) {
      for (let j = i + 1; j < player.cells.length; j++) {
        const a = player.cells[i];
        const b = player.cells[j];
        if (a.mergeTime > 0 || b.mergeTime > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ra = radiusFromMass(a.mass);
        const rb = radiusFromMass(b.mass);
        if (dist < ra + rb - Math.min(ra, rb) * 0.4) {
          const cx = (a.x * a.mass + b.x * b.mass) / (a.mass + b.mass);
          const cy = (a.y * a.mass + b.y * b.mass) / (a.mass + b.mass);
          a.x += (cx - a.x) * 0.05;
          a.y += (cy - a.y) * 0.05;
          b.x += (cx - b.x) * 0.05;
          b.y += (cy - b.y) * 0.05;
        }
      }
    }
  }

  eatFood(player) {
    for (const cell of player.cells) {
      const r = radiusFromMass(cell.mass);
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const f = this.foods[i];
        const dx = f.x - cell.x;
        const dy = f.y - cell.y;
        if (dx * dx + dy * dy < r * r) {
          cell.mass += f.mass;
          this.foods.splice(i, 1);
          this.foods.push(this.spawnFood());
        }
      }
    }
  }

  eatViruses(player) {
    for (let ci = player.cells.length - 1; ci >= 0; ci--) {
      const cell = player.cells[ci];
      const r = radiusFromMass(cell.mass);
      for (let vi = this.viruses.length - 1; vi >= 0; vi--) {
        const v = this.viruses[vi];
        const dx = v.x - cell.x;
        const dy = v.y - cell.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < r - radiusFromMass(v.mass) * 0.5) {
          if (cell.mass > VIRUS_SPLIT_MASS) {
            this.viruses.splice(vi, 1);
            this.viruses.push(this.spawnVirus());

            if (this.config.virusShoot) {
              const angle = Math.atan2(player.mouseY - cell.y, player.mouseX - cell.x);
              this.projectiles.push({
                id: projectileIdCounter++,
                x: cell.x + Math.cos(angle) * (r + 30),
                y: cell.y + Math.sin(angle) * (r + 30),
                vx: Math.cos(angle) * 1200,
                vy: Math.sin(angle) * 1200,
                mass: VIRUS_MASS,
                life: 5000,
                ownerId: player.id
              });
            } else if (this.config.virusBurst > 0) {
              const burst = this.config.virusBurst;
              for (let k = 0; k < burst; k++) {
                const ba = Math.random() * Math.PI * 2;
                const bv = 200 + Math.random() * 300;
                this.foods.push({
                  id: foodIdCounter++,
                  x: v.x + Math.cos(ba) * 20,
                  y: v.y + Math.sin(ba) * 20,
                  color: this.config.rainbow ? rainbowColor(this.rainbowTime) : randColor(),
                  mass: 5 + Math.random() * 5,
                  vx: Math.cos(ba) * bv,
                  vy: Math.sin(ba) * bv,
                  ejected: true,
                  life: 4000
                });
              }
            } else {
              cell.mass += v.mass;
            }
          }
        }
      }
    }
  }

  eatPlayers(player, allPlayers) {
    for (const other of allPlayers) {
      if (other === player || !other.alive) continue;
      if (this.config.type === 'team' && player.team && other.team && player.team === other.team) continue;
      for (let oi = other.cells.length - 1; oi >= 0; oi--) {
        const ocell = other.cells[oi];
        const or = radiusFromMass(ocell.mass);
        for (let pi = player.cells.length - 1; pi >= 0; pi--) {
          const pcell = player.cells[pi];
          const pr = radiusFromMass(pcell.mass);
          const dx = ocell.x - pcell.x;
          const dy = ocell.y - pcell.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < pr - or * 0.4 && pcell.mass > ocell.mass * MIN_EAT_MASS_RATIO) {
            pcell.mass += ocell.mass;
            other.cells.splice(oi, 1);
            break;
          }
        }
      }
      if (other.cells.length === 0) other.alive = false;
    }
  }

  splitPlayer(player) {
    if (player.cells.length >= MAX_CELLS) return;
    const newCells = [];
    for (const cell of player.cells) {
      if (cell.mass < MIN_SPLIT_MASS) continue;
      if (player.cells.length + newCells.length >= MAX_CELLS) break;
      const angle = Math.atan2(player.mouseY - cell.y, player.mouseX - cell.x);
      const newMass = cell.mass / 2;
      newCells.push({
        id: cell.id + 1, x: cell.x, y: cell.y,
        mass: newMass,
        vx: Math.cos(angle) * 800, vy: Math.sin(angle) * 800,
        splitTime: 1000, mergeTime: SPLIT_COOLDOWN
      });
      cell.mass = newMass;
      cell.mergeTime = SPLIT_COOLDOWN;
    }
    player.cells.push(...newCells);
  }

  multiSplit(player) {
    let attempts = 0;
    while (player.cells.length < MAX_CELLS && attempts < 20) {
      const before = player.cells.length;
      this.splitPlayer(player);
      if (player.cells.length === before) break;
      attempts++;
    }
  }

  ejectMass(player, count) {
    const now = Date.now();
    if (now - player.lastEject < 50) return;
    player.lastEject = now;
    for (let i = 0; i < count; i++) {
      for (const cell of player.cells) {
        if (cell.mass < MIN_EJECT_MASS) continue;
        const angle = Math.atan2(player.mouseY - cell.y, player.mouseX - cell.x);
        const r = radiusFromMass(cell.mass);
        const fx = cell.x + Math.cos(angle) * (r + 10);
        const fy = cell.y + Math.sin(angle) * (r + 10);
        this.foods.push({
          id: foodIdCounter++,
          x: fx, y: fy,
          color: this.config.rainbow ? rainbowColor(this.rainbowTime) : player.color,
          mass: EJECT_MASS,
          vx: Math.cos(angle) * 600,
          vy: Math.sin(angle) * 600,
          ejected: true,
          life: 3000
        });
        cell.mass -= EJECT_MASS;
      }
    }
  }

  feedVirus(player) {
    for (const cell of player.cells) {
      const r = radiusFromMass(cell.mass);
      for (const v of this.viruses) {
        const dx = v.x - cell.x;
        const dy = v.y - cell.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < r + radiusFromMass(v.mass) + 30) {
          const angle = Math.atan2(player.mouseY - v.y, player.mouseX - v.x);
          v.mass += EJECT_MASS;
          if (v.mass >= VIRUS_MASS * 2) {
            const newVirus = {
              id: virusIdCounter++,
              x: v.x + Math.cos(angle) * (radiusFromMass(v.mass) + 20),
              y: v.y + Math.sin(angle) * (radiusFromMass(v.mass) + 20),
              mass: VIRUS_MASS,
              color: VIRUS_COLOR,
              vx: Math.cos(angle) * 1000,
              vy: Math.sin(angle) * 1000
            };
            this.viruses.push(newVirus);
            v.mass = VIRUS_MASS;
          }
          return;
        }
      }
    }
  }

  updateEjectedFood(dt) {
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      if (f.ejected) {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vx *= 0.95;
        f.vy *= 0.95;
        f.life -= dt * 1000;
        f.x = clamp(f.x, 0, WORLD_SIZE);
        f.y = clamp(f.y, 0, WORLD_SIZE);
        if (Math.abs(f.vx) < 1 && Math.abs(f.vy) < 1) {
          f.ejected = false;
          f.vx = 0; f.vy = 0;
        }
        if (f.life <= 0) {
          f.ejected = false;
          f.vx = 0; f.vy = 0;
        }
      }
    }
  }

  updateViruses(dt) {
    for (const v of this.viruses) {
      if (v.vx || v.vy) {
        v.x += v.vx * dt;
        v.y += v.vy * dt;
        v.x = clamp(v.x, radiusFromMass(v.mass), WORLD_SIZE - radiusFromMass(v.mass));
        v.y = clamp(v.y, radiusFromMass(v.mass), WORLD_SIZE - radiusFromMass(v.mass));
        v.vx *= 0.95;
        v.vy *= 0.95;
        if (Math.abs(v.vx) < 1) v.vx = 0;
        if (Math.abs(v.vy) < 1) v.vy = 0;
      }
    }
    while (this.viruses.length > VIRUS_COUNT + 10) this.viruses.shift();
    while (this.viruses.length < VIRUS_COUNT) this.viruses.push(this.spawnVirus());
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= dt * 1000;
      if (p.life <= 0 || p.x < 0 || p.x > WORLD_SIZE || p.y < 0 || p.y > WORLD_SIZE) {
        this.projectiles.splice(i, 1);
        continue;
      }
      for (const player of this.players.values()) {
        if (!player.alive || player.id === p.ownerId) continue;
        for (let ci = player.cells.length - 1; ci >= 0; ci--) {
          const cell = player.cells[ci];
          const r = radiusFromMass(cell.mass);
          const dx = p.x - cell.x;
          const dy = p.y - cell.y;
          if (dx * dx + dy * dy < r * r) {
            if (player.cells.length < MAX_CELLS) {
              const newMass = cell.mass / 2;
              const angle = Math.atan2(player.mouseY - cell.y, player.mouseX - cell.x);
              player.cells.push({
                id: cell.id + 1, x: cell.x, y: cell.y,
                mass: newMass,
                vx: Math.cos(angle) * 800, vy: Math.sin(angle) * 800,
                splitTime: 1000, mergeTime: SPLIT_COOLDOWN
              });
              cell.mass = newMass;
              cell.mergeTime = SPLIT_COOLDOWN;
            }
            this.projectiles.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  checkMaxMass(player) {
    if (this.getTotalMass(player) > MAX_MASS) {
      const excess = this.getTotalMass(player) - MAX_MASS;
      const numSplits = Math.min(MAX_CELLS - player.cells.length, Math.ceil(excess / (MAX_MASS / MAX_CELLS)));
      for (let i = 0; i < numSplits; i++) {
        if (player.cells.length >= MAX_CELLS) break;
        const cell = player.cells[0];
        if (cell.mass < MIN_SPLIT_MASS) break;
        const angle = Math.random() * Math.PI * 2;
        const newMass = cell.mass / 2;
        player.cells.push({
          id: cell.id + 1, x: cell.x, y: cell.y,
          mass: newMass,
          vx: Math.cos(angle) * 500, vy: Math.sin(angle) * 500,
          splitTime: 1000, mergeTime: SPLIT_COOLDOWN
        });
        cell.mass = newMass;
        cell.mergeTime = SPLIT_COOLDOWN;
      }
    }
  }

  applyShrinkDamage(dt) {
    const cx = WORLD_SIZE / 2;
    const cy = WORLD_SIZE / 2;
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      for (const cell of player.cells) {
        const dx = cell.x - cx;
        const dy = cell.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > this.shrinkRadius) {
          cell.mass -= cell.mass * 0.05 * dt;
          if (cell.mass < START_MASS) {
            player.cells.splice(player.cells.indexOf(cell), 1);
          }
        }
      }
      if (player.cells.length === 0) player.alive = false;
    }
  }

  updateShrink() {
    const elapsed = Date.now() - this.roundStartTime;
    const progress = elapsed / ROUND_DURATION;
    const startR = WORLD_SIZE / 2;
    const minR = 800;
    this.shrinkRadius = startR - (startR - minR) * progress;
  }

  updateTerritories(dt) {
    for (const t of this.territories) {
      const counts = {};
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const center = this.getCenter(p);
        if (center.x >= t.x && center.x < t.x + t.w && center.y >= t.y && center.y < t.y + t.h) {
          const key = p.team || p.name;
          counts[key] = (counts[key] || 0) + this.getTotalMass(p);
        }
      }
      let bestKey = null, bestMass = 0;
      for (const [key, mass] of Object.entries(counts)) {
        if (mass > bestMass) { bestMass = mass; bestKey = key; }
      }
      if (bestKey && bestMass > 50) {
        if (t.owner !== bestKey) {
          t.owner = bestKey;
          t.score = 0;
        }
        t.score += Math.floor(dt * 10);
      }
    }
  }

  respawnIfNeeded(player) {
    if (!player.alive) {
      player.alive = true;
      player.cells = [{
        id: 0,
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        mass: START_MASS,
        vx: 0, vy: 0,
        splitTime: 0, mergeTime: 0
      }];
    }
  }

  checkRoundEnd() {
    const elapsed = Date.now() - this.roundStartTime;
    if (elapsed >= ROUND_DURATION) {
      let winner = null;
      let maxMass = 0;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const m = this.getTotalMass(p);
        if (m > maxMass) { maxMass = m; winner = p; }
      }
      if (winner) {
        this.lastWinner = winner.name;
        this.lastWinnerTime = Date.now();
      }
      for (const p of this.players.values()) {
        p.cells = [{
          id: 0,
          x: Math.random() * WORLD_SIZE,
          y: Math.random() * WORLD_SIZE,
          mass: START_MASS,
          vx: 0, vy: 0,
          splitTime: 0, mergeTime: 0
        }];
        p.alive = true;
      }
      this.roundStartTime = Date.now();
      this.shrinkRadius = WORLD_SIZE / 2;
      if (this.config.territories) this.initTerritories();
    }
  }

  updateRainbow(dt) {
    if (!this.config.rainbow) return;
    this.rainbowTime += dt * 1000;
    for (const f of this.foods) {
      if (!f.ejected) f.color = rainbowColor(this.rainbowTime + f.id * 0.1);
    }
    for (const v of this.viruses) {
      v.color = rainbowColor(this.rainbowTime);
    }
    for (const p of this.players.values()) {
      if (!p.team) p.color = rainbowColor(this.rainbowTime + p.id * 50);
    }
  }

  tick(dt) {
    const allPlayers = Array.from(this.players.values());

    if (this.config.shrink) this.updateShrink();

    for (const player of allPlayers) {
      if (!player.alive) continue;
      this.moveCells(player, dt);
      this.resolveCollisions(player);
      this.softMerge(player, dt);
      this.eatFood(player);
      this.eatViruses(player);
      this.checkMaxMass(player);
    }

    for (let i = 0; i < allPlayers.length; i++) {
      if (!allPlayers[i].alive) continue;
      this.eatPlayers(allPlayers[i], allPlayers);
    }

    this.updateEjectedFood(dt);
    this.updateViruses(dt);
    this.updateProjectiles(dt);
    this.updateRainbow(dt);

    if (this.config.shrink) this.applyShrinkDamage(dt);
    if (this.config.territories) this.updateTerritories(dt);

    this.checkRoundEnd();
  }

  getState() {
    const allPlayers = Array.from(this.players.values());
    const playerData = allPlayers.map(p => {
      const center = this.getCenter(p);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        team: p.team,
        alive: p.alive,
        score: Math.floor(this.getTotalMass(p)),
        cx: center.x,
        cy: center.y,
        cells: p.cells.map(c => ({
          x: Math.round(c.x),
          y: Math.round(c.y),
          r: Math.round(radiusFromMass(c.mass)),
          m: Math.round(c.mass)
        }))
      };
    });

    const foodData = this.foods.map(f => ({
      id: f.id, x: Math.round(f.x), y: Math.round(f.y), c: f.color
    }));

    const virusData = this.viruses.map(v => ({
      id: v.id, x: Math.round(v.x), y: Math.round(v.y), r: Math.round(radiusFromMass(v.mass))
    }));

    const projectileData = this.projectiles.map(p => ({
      id: p.id, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(radiusFromMass(p.mass))
    }));

    const timeLeft = Math.max(0, ROUND_DURATION - (Date.now() - this.roundStartTime));

    let teamData = null;
    if (this.config.type === 'team') {
      const teamStats = {};
      for (const t of this.config.teams) {
        teamStats[t] = { count: 0, mass: 0 };
      }
      for (const p of allPlayers) {
        if (!p.alive || !p.team) continue;
        if (!teamStats[p.team]) teamStats[p.team] = { count: 0, mass: 0 };
        teamStats[p.team].count++;
        teamStats[p.team].mass += Math.floor(this.getTotalMass(p));
      }
      teamData = Object.entries(teamStats).map(([team, stats]) => ({
        team, color: TEAM_COLORS[team], ...stats
      }));
    }

    let territoryData = null;
    if (this.config.territories) {
      territoryData = this.territories.map(t => ({
        id: t.id, x: t.x, y: t.y, w: t.w, h: t.h,
        owner: t.owner, score: t.score
      }));
    }

    return {
      mode: this.mode,
      roomName: this.name,
      players: playerData,
      foods: foodData,
      viruses: virusData,
      projectiles: projectileData,
      timeLeft,
      lastWinner: this.lastWinner,
      winnerDisplayUntil: this.lastWinnerTime + 10000,
      shrinkRadius: this.config.shrink ? this.shrinkRadius : null,
      worldSize: WORLD_SIZE,
      teams: teamData,
      territories: territoryData
    };
  }

  getPlayerCount() {
    return this.players.size;
  }
}

module.exports = { Room, WORLD_SIZE, MODE_CONFIGS, TEAM_COLORS };
