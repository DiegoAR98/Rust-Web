import * as THREE from "three";
import { GameSocket } from "./net.js";
import { Replica } from "./replica.js";

const serverUrl =
  (new URLSearchParams(location.search).get("server") ??
    `ws://${location.hostname}:3000`);

// ---- renderer / scene / camera ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc8b088);
scene.fog = new THREE.Fog(0xc8b088, 100, 900);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 2000);

const sun = new THREE.DirectionalLight(0xfff2d0, 1.2);
sun.position.set(100, 200, 100);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x887755, 0.6));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(6000, 6000),
  new THREE.MeshLambertMaterial({ color: 0x8a7a55 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// ---- entity meshes ----
const playerMeshes = new Map<string, THREE.Mesh>();
const nodeMeshes = new Map<string, THREE.Mesh>();
const corpseMeshes = new Map<string, THREE.Mesh>();
const groundItemMeshes = new Map<string, THREE.Mesh>();

// ---- UI elements ----
const hud = document.getElementById("hud")!;
const notice = document.getElementById("notice")!;
const deathOverlay = document.getElementById("death")!;
const respawnBtn = document.getElementById("respawn") as HTMLButtonElement;
const invPanel = document.getElementById("inv")!;
const invGrid = document.getElementById("inv-grid")!;
const hotbar = document.getElementById("hotbar")!;

const ui = {
  inventoryOpen: false,
  dead: false,
  held: null as null | { fromSlot: number; itemId: string; qty: number },
};

// ---- input ----
const keys = new Set<string>();
let yaw = 0;
let pitch = 0;
let locked = false;
let jumpQueued = false;
let heldSlot = 0;

renderer.domElement.addEventListener("click", () => {
  if (!locked && !ui.inventoryOpen && !ui.dead) renderer.domElement.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
});
document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  yaw -= e.movementX * 0.002;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch - e.movementY * 0.002));
});

const label = (id: string): string => id;

// ---- network ----
const replica = new Replica();
let socket: GameSocket;
let me = ""; // my playerId
let myEntity = ""; // my entityId
let lastInput = 0;
let lastSwingMs = 0;

// death: server omits dead players from batches and emits a death event
const onDeath = (): void => {
  ui.dead = true;
  deathOverlay.style.display = "flex";
  document.exitPointerLock?.();
};

const drainEvents = (): void => {
  for (const ev of replica.drainEvents()) {
    const pid = socket.playerIdentity?.playerId;
    if (ev.event === "death" && pid && ev.payload.playerId === pid) onDeath();
  }
};

const bindSocket = (s: GameSocket): void => {
  s.onSnapshot = (snap) => {
    replica.apply(snap);
    const pid = s.playerIdentity?.playerId;
    if (pid) {
      const ent = replica.entityForPlayer(pid);
      if (ent) myEntity = ent;
    }
    drainEvents();
  };
};

const start = async (): Promise<void> => {
  try {
    socket = new GameSocket(serverUrl);
    bindSocket(socket);
    const grant = await socket.connect();
    me = grant.playerId;
    hud.innerHTML =
      `Connected as ${me}<br>` +
      `<span style="color:#a89070">${grant.hasSavedPlayer ? "resumed saved character" : "new character"}</span>`;
    notice.textContent = "Click canvas to lock pointer. E = gather/loot, Tab = inventory, 1-8 = hotbar, right-click slot = drop.";
  } catch (err) {
    console.error(err);
    hud.innerHTML = "Failed to connect: " + (err instanceof Error ? err.message : String(err));
  }
};

// respawn: re-authenticate on a fresh socket; the server respawns the body
// within the 5-minute window and restores loot (GDD §22.4/22.5)
respawnBtn.addEventListener("click", async () => {
  respawnBtn.disabled = true;
  ui.dead = false;
  deathOverlay.style.display = "none";
  ui.held = null;
  try {
    const old = socket;
    socket = new GameSocket(serverUrl);
    bindSocket(socket);
    const grant = await socket.connect();
    me = grant.playerId;
    myEntity = "";
    hud.innerHTML = `Respawned as ${me}`;
    old.close();
  } catch (err) {
    console.error(err);
    deathOverlay.style.display = "flex";
  }
  respawnBtn.disabled = false;
});

// ---- inventory UI ----
const buildInventory = (): void => {
  invGrid.innerHTML = "";
  const grid = myEntity ? replica.players.get(myEntity)?.inventory : undefined;
  for (let i = 0; i < 36; i++) {
    const cell = document.createElement("div");
    cell.className = "slot";
    const held = ui.held?.fromSlot === i;
    const stack = grid?.[i] ?? null;
    if (held) {
      cell.innerHTML = `<span class="q">${ui.held!.qty}</span>${label(ui.held!.itemId)}`;
      cell.classList.add("held");
    } else if (stack) {
      cell.innerHTML = `<span class="q">${stack.quantity}</span>${label(stack.itemId)}`;
    }
    cell.addEventListener("click", () => onSlotClick(i));
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      onSlotRightClick(i);
    });
    invGrid.appendChild(cell);
  }
};

const onSlotClick = (i: number): void => {
  const grid = myEntity ? replica.players.get(myEntity)?.inventory : undefined;
  const stack = grid?.[i] ?? null;
  if (ui.held) {
    // place the held stack into slot i (server merges or moves atomically)
    socket.send({ ...moveFrame(), heldSlot, moveItem: { from: ui.held.fromSlot, to: i } });
    ui.held = null;
  } else if (stack) {
    ui.held = { fromSlot: i, itemId: stack.itemId, qty: stack.quantity };
  }
  buildInventory();
};

const onSlotRightClick = (i: number): void => {
  const stack = myEntity ? replica.players.get(myEntity)?.inventory?.[i] ?? null : null;
  if (stack) socket.send({ ...moveFrame(), heldSlot, drop: { slot: i } });
  buildInventory();
};

const buildHotbar = (): void => {
  hotbar.innerHTML = "";
  const grid = myEntity ? replica.players.get(myEntity)?.inventory : undefined;
  for (let i = 0; i < 8; i++) {
    const c = document.createElement("div");
    c.className = "hb" + (i === heldSlot ? " active" : "");
    const s = grid?.[i];
    c.innerHTML = s ? `<span class="q">${s.quantity}</span>${label(s.itemId)}` : "";
    c.addEventListener("click", () => {
      heldSlot = i;
      buildHotbar();
    });
    hotbar.appendChild(c);
  }
};

const toggleInventory = (): void => {
  ui.inventoryOpen = !ui.inventoryOpen;
  invPanel.style.display = ui.inventoryOpen ? "block" : "none";
  if (ui.inventoryOpen) {
    document.exitPointerLock?.();
    buildInventory();
  }
};

// ---- interact: E gathers the nearest node or loots the nearest corpse/ground item ----
const interact = (): void => {
  const now = performance.now();
  if (now - lastSwingMs < 250) return;
  lastSwingMs = now;
  const myP = myEntity ? replica.players.get(myEntity) : undefined;
  if (!myP) return;
  const REACH2 = 250 * 250; // 2.5 m; the server proves actual reach
  let best: { id: string; type: "swing" | "pickup" } | null = null;
  let bestD = REACH2;
  for (const n of replica.nodes.values()) {
    const d = sq(myP.x, n.x) + sq(myP.z, n.z);
    if (d < bestD) {
      bestD = d;
      best = { id: n.entityId, type: "swing" };
    }
  }
  for (const c of replica.corpses.values()) {
    const d = sq(myP.x, c.x) + sq(myP.z, c.z);
    if (d < bestD) {
      bestD = d;
      best = { id: c.entityId, type: "pickup" };
    }
  }
  for (const g of replica.ground.values()) {
    const d = sq(myP.x, g.x) + sq(myP.z, g.z);
    if (d < bestD) {
      bestD = d;
      best = { id: g.entityId, type: "pickup" };
    }
  }
  if (!best) return;
  const f = moveFrame();
  if (best.type === "swing") socket.send({ ...f, heldSlot, swing: { targetEntityId: best.id } });
  else socket.send({ ...f, heldSlot, pickup: { sourceEntityId: best.id } });
};
const sq = (a: number, b: number): number => {
  const d = a - b;
  return d * d;
};

// ---- key handling: movement keys, hotbar, inventory, interact ----
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Space") jumpQueued = true;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 8 && !ui.dead) {
    heldSlot = n - 1;
    buildHotbar();
  }
  if (e.code === "Tab") {
    e.preventDefault();
    toggleInventory();
  }
  if ((e.key === "e" || e.key === "E" || e.key === "f" || e.key === "F") && !ui.dead && !ui.inventoryOpen) interact();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

// movement frame (quantized cm/s, yaw/pitch in 1/100 degree)
const moveFrame = (): {
  wishX: number;
  wishZ: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  inWater: boolean;
  yawHundredths: number;
  pitchHundredths: number;
} => {
  let dx = 0;
  let dz = 0;
  if (keys.has("KeyW")) {
    dx += Math.sin(yaw);
    dz += Math.cos(yaw);
  }
  if (keys.has("KeyS")) {
    dx -= Math.sin(yaw);
    dz -= Math.cos(yaw);
  }
  if (keys.has("KeyA")) {
    dx -= Math.cos(yaw);
    dz += Math.sin(yaw);
  }
  if (keys.has("KeyD")) {
    dx += Math.cos(yaw);
    dz -= Math.sin(yaw);
  }
  const k = 100;
  return {
    wishX: Math.round(dx * k),
    wishZ: Math.round(dz * k),
    jump: jumpQueued,
    crouch: keys.has("ControlLeft"),
    sprint: keys.has("ShiftLeft"),
    inWater: false,
    yawHundredths: Math.round((yaw * 180) / Math.PI * 100),
    pitchHundredths: Math.round((pitch * 180) / Math.PI * 100),
  };
};

// send movement at 30 Hz
setInterval(() => {
  const now = performance.now();
  if (ui.dead) {
    jumpQueued = false;
    return;
  }
  if (now - lastInput > 33.4) {
    lastInput = now;
    socket.send({ ...moveFrame(), heldSlot });
    jumpQueued = false;
  }
}, 16);

// ---- render loop (decoupled from the simulation tick, GDD §21.8) ----
const smooth = new Map<string, { x: number; y: number; z: number }>();

const syncMeshes = (): void => {
  for (const [id, n] of replica.nodes) {
    let m = nodeMeshes.get(id);
    if (!m) {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), new THREE.MeshLambertMaterial({ color: 0x6a5a3a }));
      scene.add(m);
      nodeMeshes.set(id, m);
    }
    m.position.set(n.x / 100, 0.6 + n.y / 100, n.z / 100);
  }
  for (const [id, m] of nodeMeshes) if (!replica.nodes.has(id)) {
    scene.remove(m);
    nodeMeshes.delete(id);
  }
  for (const [id, c] of replica.corpses) {
    let m = corpseMeshes.get(id);
    if (!m) {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.5), new THREE.MeshLambertMaterial({ color: 0x7a2a2a }));
      scene.add(m);
      corpseMeshes.set(id, m);
    }
    m.position.set(c.x / 100, 0.3 + c.y / 100, c.z / 100);
  }
  for (const [id, m] of corpseMeshes) if (!replica.corpses.has(id)) {
    scene.remove(m);
    corpseMeshes.delete(id);
  }
  for (const [id, g] of replica.ground) {
    let m = groundItemMeshes.get(id);
    if (!m) {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: 0xd8b040 }));
      scene.add(m);
      groundItemMeshes.set(id, m);
    }
    m.position.set(g.x / 100, 0.2 + g.y / 100, g.z / 100);
  }
  for (const [id, m] of groundItemMeshes) if (!replica.ground.has(id)) {
    scene.remove(m);
    groundItemMeshes.delete(id);
  }
};

renderer.setAnimationLoop(() => {
  syncMeshes();
  const mine = myEntity ? replica.players.get(myEntity) : undefined;
  if (mine) {
    const s = smooth.get(myEntity) ?? { x: mine.x / 100, y: mine.y / 100 + 1.8, z: mine.z / 100 };
    const tx = mine.x / 100;
    const ty = mine.y / 100 + 1.8;
    const tz = mine.z / 100;
    const err = Math.hypot(tx - s.x, tz - s.z);
    if (err > 2) {
      s.x = tx;
      s.y = ty;
      s.z = tz;
    } else {
      s.x += (tx - s.x) * 0.25;
      s.y += (ty - s.y) * 0.25;
      s.z += (tz - s.z) * 0.25;
    }
    smooth.set(myEntity, s);
    camera.position.set(s.x, s.y, s.z);
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));

    const hp = mine.health;
    const cal = mine.calories;
    const heldStack = mine.inventory?.[heldSlot];
    hud.innerHTML =
      `tick ${replica.serverTick} | pos ${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}<br>` +
      `health <span class="bar"><div style="width:${hp}%;background:#a33"></div></span> ${Math.round(hp)}<br>` +
      `calories <span class="bar"><div style="width:${(cal / 3000) * 100}%;background:#b98"></div></span> ${Math.round(cal)}<br>` +
      (heldStack ? `held: ${label(heldStack.itemId)} x${heldStack.quantity}` : "held: —");
  }

  for (const [id, p] of replica.players) {
    if (id === myEntity) continue;
    let m = playerMeshes.get(id);
    if (!m) {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4), new THREE.MeshLambertMaterial({ color: 0x7a5533 }));
      scene.add(m);
      playerMeshes.set(id, m);
    }
    m.position.set(p.x / 100, p.y / 100 + 0.9, p.z / 100);
  }
  for (const [id, m] of playerMeshes) if (!replica.players.has(id)) {
    scene.remove(m);
    playerMeshes.delete(id);
  }

  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

void start();
