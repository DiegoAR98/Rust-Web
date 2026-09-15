import * as THREE from "three";
import { GameSocket } from "./net.js";
import { Replica } from "./replica.js";
import { ITEMS, RECIPES, BLUEPRINTS } from "@dustfall/content";

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
const structureMeshes = new Map<string, THREE.Group>();
const structureHealthBars = new Map<string, THREE.Mesh>();

// ---- UI elements ----
const hud = document.getElementById("hud")!;
const notice = document.getElementById("notice")!;
const deathOverlay = document.getElementById("death")!;
const respawnBtn = document.getElementById("respawn") as HTMLButtonElement;
const invPanel = document.getElementById("inv")!;
const invGrid = document.getElementById("inv-grid")!;
const hotbar = document.getElementById("hotbar")!;
const craftPanel = document.getElementById("craft")!;
const craftList = document.getElementById("craft-list")!;
const craftProg = document.getElementById("craftProg")!;
const placeHint = document.getElementById("placeHint")!;
const ghostEl = document.getElementById("ghost")!;
// M4: storage structure panel
const storagePanel = document.getElementById("storage")!;
const storagePanelTitle = document.getElementById("storage-title")!;
const storageGrid = document.getElementById("storage-grid")!;
const depositRow = document.getElementById("deposit-row")!;

const ui = {
  inventoryOpen: false,
  craftOpen: false,
  dead: false,
  held: null as null | { fromSlot: number; itemId: string; qty: number },
  /** M3: slot the placement ghost is anchored to (null = not placing) */
  placing: null as null | { slot: number; itemId: string },
  /** M3: craft progress bar state (own hand-craft or nearest station) */
  craftBar: null as null | { recipeId: string; completesAtTick: number; totalTicks: number },
};

// ---- input ----
const keys = new Set<string>();
let yaw = 0;
let pitch = 0;
let locked = false;
let jumpQueued = false;
let heldSlot = 0;

renderer.domElement.addEventListener("click", () => {
  if (ui.placing) {
    placeAtCrosshair();
    return;
  }
  if (!locked && !ui.inventoryOpen && !ui.craftOpen && !ui.dead) renderer.domElement.requestPointerLock();
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

const bindSocket = (s: GameSocket): void => {
  s.onSnapshot = (snap) => {
    replica.apply(snap);
    const pid = s.playerIdentity?.playerId;
    if (pid) {
      const ent = replica.entityForPlayer(pid);
      if (ent) myEntity = ent;
    }
    onM3Events();
    // M4: refresh the storage panel live (stacks + integrity change on the wire)
    if (storagePanelFor && storagePanel.style.display !== "none") buildStoragePanel();
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
    notice.textContent = "Click canvas to lock pointer. E = gather/loot, Tab = inventory, C = crafting, 1-8 = hotbar, right-click slot = drop or place (structures).";
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
      const def = ITEMS.find((it) => it.id === (grid?.[i]?.itemId ?? ""));
      if (def && (def.category === "building" || def.category === "deployable")) {
        beginPlacement(i);
      } else {
        onSlotRightClick(i);
      }
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
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const def = ITEMS.find((it) => it.id === (s?.itemId ?? ""));
      if (def && (def.category === "building" || def.category === "deployable")) beginPlacement(i);
      else if (s) socket.send({ ...moveFrame(), heldSlot, drop: { slot: i } });
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

// ---- M3: crafting + structures + research (GDD §9) ----
const ITEM_NAMES = new Map<string, string>(ITEMS.map((i) => [i.id, i.id.replace(/_/g, " ")]));
const itemName = (id: string): string => ITEM_NAMES.get(id) ?? id;

/** Count of an item across the local player's grid. */
const have = (itemId: string, qty: number): boolean => {
  const grid = myEntity ? replica.players.get(myEntity)?.inventory : undefined;
  let n = 0;
  for (const s of grid ?? []) n += s?.itemId === itemId ? s.quantity : 0;
  return n >= qty;
};

const knownBlueprints = (): Set<string> => new Set(myEntity ? replica.players.get(myEntity)?.blueprints ?? [] : []);

/** Nearest structure of a given content type within `reachM` of the player. */
const nearestStation = (contentId: string, reachM: number): string | null => {
  const myP = myEntity ? replica.players.get(myEntity) : undefined;
  if (!myP) return null;
  let best: string | null = null;
  let bestD = reachM * reachM;
  for (const st of replica.structures.values()) {
    if (st.contentId !== contentId) continue;
    const d = sq(myP.x, st.x) + sq(myP.z, st.z);
    if (d < bestD) {
      bestD = d;
      best = st.entityId;
    }
  }
  return best;
};

/**
 * Build the recipe list: every hand recipe the player can attempt, plus the
 * recipes of the nearest in-reach station (GDD §9). Blueprints the player has
 * not learned are shown locked (craftable only after research at a Workbench).
 */
const buildCraftList = (): void => {
  craftList.innerHTML = "";
  const myP = myEntity ? replica.players.get(myEntity) : undefined;
  if (!myP) return;
  const blueprints = knownBlueprints();
  const inReach: Record<string, string> = {};
  for (const st of ["workbench", "campfire", "furnace"]) {
    const id = nearestStation(st, 5);
    if (id) inReach[st] = id;
  }
  const active = ui.craftBar ?? myP.handCraft;

  for (const rec of RECIPES) {
    const stationOk = rec.station === "hand" || inReach[rec.station];
    if (!stationOk) continue;
    const locked = rec.requiresBlueprint !== undefined && !blueprints.has(rec.requiresBlueprint);
    const row = document.createElement("div");
    row.className = "rrow" + (locked ? " locked" : "");
    const out = rec.outputQuantity > 1 ? `${itemName(rec.outputItemId)} x${rec.outputQuantity}` : itemName(rec.outputItemId);
    const cost = rec.inputs.map((i) => `${i.quantity} ${itemName(i.itemId)}`).join(", ");
    const stationTag = rec.station === "hand" ? "" : ` @${rec.station}`;
    row.innerHTML = `<div><div class="iname">${out}${stationTag}${active?.recipeId === rec.id ? " …" : ""}</div><div class="cost">${cost}</div></div>`;
    if (locked) {
      const bp = BLUEPRINTS.find((b) => b.payload === rec.requiresBlueprint);
      const src = bp?.sourceItemId ? itemName(bp.sourceItemId) : "blueprint";
      const bench = inReach["workbench"];
      const canResearch = bench !== undefined && bp?.sourceItemId ? have(bp.sourceItemId, 1) && have("research_kit", 1) : false;
      const btn = document.createElement("button");
      btn.textContent = `Research ${src}`;
      btn.disabled = !canResearch;
      btn.addEventListener("click", () => {
        if (!bench || !bp?.sourceItemId) return;
        socket.send({ ...moveFrame(), heldSlot, research: { structureEntityId: bench, itemId: bp.sourceItemId } });
        flashNotice(`Researching ${src}…`);
      });
      row.appendChild(btn);
    } else {
      const btn = document.createElement("button");
      const busy = !!active;
      const canAfford = rec.inputs.every((i) => have(i.itemId, i.quantity));
      btn.textContent = busy ? "busy" : "Craft";
      btn.disabled = busy || !canAfford;
      btn.addEventListener("click", () => {
        const stationId = rec.station === "hand" ? undefined : inReach[rec.station];
        if (!stationId && rec.station !== "hand") return;
        socket.send({ ...moveFrame(), heldSlot, craft: { recipeId: rec.id, ...(stationId ? { structureEntityId: stationId } : {}) } });
      });
      row.appendChild(btn);
    }
    craftList.appendChild(row);
  }
};

/** Refresh the craft progress bar from the authoritative state each tick. */
const updateCraftBar = (): void => {
  const myP = myEntity ? replica.players.get(myEntity) : undefined;
  if (!myP) return;
  let craft: { recipeId: string; completesAtTick: number } | null = myP.handCraft;
  let stationLabel = "";
  // station craft in reach overrides the display when the player is standing there
  for (const st of ["workbench", "campfire", "furnace"]) {
    const id = nearestStation(st, 5);
    if (!id) continue;
    const s = replica.structures.get(id);
    if (s?.craft && s.craft.startedBy === me) {
      craft = s.craft;
      stationLabel = ` @${st}`;
      break;
    }
  }
  if (!craft) {
    ui.craftBar = null;
    craftProg.style.display = "none";
    return;
  }
  const rec = RECIPES.find((r) => r.id === craft!.recipeId);
  if (!rec) {
    ui.craftBar = null;
    craftProg.style.display = "none";
    return;
  }
  ui.craftBar = { recipeId: craft.recipeId, completesAtTick: craft.completesAtTick, totalTicks: rec.timeTicks };
  const remaining = Math.max(0, craft.completesAtTick - replica.serverTick);
  const pct = Math.max(0, Math.min(100, (1 - remaining / rec.timeTicks) * 100));
  craftProg.style.display = "block";
  craftProg.innerHTML = `crafting ${itemName(rec.outputItemId)}${stationLabel}<br><span class="bar" style="width:200px;display:inline-block"><div style="width:${pct}%"></div></span> ${Math.ceil(remaining / 30)}s`;
};

// notice helper
let lastFlash = 0;
const flashNotice = (msg: string): void => {
  const now = performance.now();
  if (now - lastFlash < 300) return;
  lastFlash = now;
  notice.textContent = msg;
};

// craft / blueprint events: refresh the panel + show a toast
const onM3Events = (): void => {
  let refresh = false;
  let msg: string | null = null;
  for (const ev of replica.drainEvents()) {
    const pid = socket.playerIdentity?.playerId;
    if (ev.event === "death" && pid && ev.payload.playerId === pid) {
      ui.dead = true;
      deathOverlay.style.display = "flex";
      document.exitPointerLock?.();
      continue;
    }
    if (ev.event === "craft" && pid && ev.payload.playerId === pid) {
      refresh = true;
      const dropped = ev.payload.dropped === true;
      msg = `${itemName(String(ev.payload.itemId))} x${ev.payload.quantity} ${dropped ? "(grid full — dropped at the station)" : "crafted"}`;
    } else if (ev.event === "blueprint" && pid && ev.payload.playerId === pid) {
      refresh = true;
      const bp = BLUEPRINTS.find((b) => b.payload === ev.payload.payload);
      msg = bp?.sourceItemId ? `Blueprint learned: ${itemName(bp.sourceItemId)}` : "Blueprint learned";
    } else if (ev.event === "build") {
      refresh = true; // structure spawn arrives with the same batch
    }
  }
  if (msg) flashNotice(msg);
  if (refresh) buildCraftList();
};

// ---- M3: craft panel + structure placement ----
const toggleCraftPanel = (): void => {
  ui.craftOpen = !ui.craftOpen;
  craftPanel.style.display = ui.craftOpen ? "block" : "none";
  if (ui.craftOpen) {
    document.exitPointerLock?.();
    buildCraftList();
  } else {
    placeHint.style.display = "none";
  }
};
(document.getElementById("craft-close") as HTMLButtonElement).addEventListener("click", toggleCraftPanel);

/**
 * Begin placing the item in `slot` (must be a building/deployable).
 * The ghost follows the crosshair; the server proves reach/spacing/cap.
 */
const beginPlacement = (slot: number): void => {
  const stack = myEntity ? replica.players.get(myEntity)?.inventory?.[slot] ?? null : null;
  if (!stack) return;
  const def = ITEMS.find((i) => i.id === stack.itemId);
  if (!def || (def.category !== "building" && def.category !== "deployable")) return;
  ui.placing = { slot, itemId: stack.itemId };
  placeHint.style.display = "block";
  ghostEl.style.display = "block";
  document.exitPointerLock?.();
};

const cancelPlacement = (): void => {
  ui.placing = null;
  placeHint.style.display = "none";
  ghostEl.style.display = "none";
};

/** Raycast the crosshair onto the ground plane; returns world cm or null. */
const crosshairGround = (): { x: number; z: number } | null => {
  const myP = myEntity ? replica.players.get(myEntity) : undefined;
  if (!myP) return null;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const origin = camera.position.clone();
  const denom = dir.y;
  if (Math.abs(denom) < 1e-4) return null;
  const t = -origin.y / denom;
  if (t < 0) return null;
  const wx = origin.x + dir.x * t;
  const wz = origin.z + dir.z * t;
  return { x: Math.round(wx * 100), z: Math.round(wz * 100) };
};

/** Update the placement ghost each frame; called from the render loop. */
const updatePlacement = (): void => {
  if (!ui.placing) {
    ghostEl.style.display = "none";
    return;
  }
  ghostEl.style.display = "block";
  const pt = crosshairGround();
  const myP = myEntity ? replica.players.get(myEntity) : undefined;
  let inReach = false;
  if (pt && myP) {
    const d2 = sq(pt.x, myP.x) + sq(pt.z, myP.z);
    inReach = d2 <= 500 * 500; // 5 m; the server proves the authoritative value
  }
  ghostEl.classList.toggle("out", !inReach || !pt);
};

const placeAtCrosshair = (): void => {
  if (!ui.placing) return;
  const pt = crosshairGround();
  if (!pt) return;
  const slot = ui.placing.slot;
  ui.placing = null;
  ghostEl.style.display = "none";
  socket.send({ ...moveFrame(), heldSlot, place: { slot, position: { x: pt.x, y: 0, z: pt.z } } });
};

// ---- interact: E gathers the nearest node, loots corpse/ground, breaches a
// structure, or opens a storage structure's UI (M4) ----
const interact = (): void => {
  const now = performance.now();
  if (now - lastSwingMs < 250) return;
  lastSwingMs = now;
  const myP = myEntity ? replica.players.get(myEntity) : undefined;
  if (!myP) return;
  const REACH2 = 250 * 250; // 2.5 m; the server proves actual reach
  let best: { id: string; type: "swing" | "pickup" | "structure" | "storage" } | null = null;
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
  // M4: structures — storage boxes open their UI; sleeping bags rest; everything
  // else is breached with a tool swing (server enforces the breach rule).
  for (const s of replica.structures.values()) {
    const d = sq(myP.x, s.x) + sq(myP.z, s.z);
    if (d < bestD) {
      bestD = d;
      const def = ITEMS.find((i) => i.id === s.contentId);
      if (def?.building?.storageSlots && def.building.storageSlots > 0) {
        best = { id: s.entityId, type: "storage" };
      } else if (def?.building?.restable) {
        best = { id: s.entityId, type: "structure" };
      } else {
        best = { id: s.entityId, type: "structure" };
      }
    }
  }
  if (!best) return;
  const f = moveFrame();
  if (best.type === "swing") socket.send({ ...f, heldSlot, swing: { targetEntityId: best.id } });
  else if (best.type === "pickup") socket.send({ ...f, heldSlot, pickup: { sourceEntityId: best.id } });
  else if (best.type === "storage") openStoragePanel(best.id);
  else {
    // M4 structures: a restable piece (sleeping bag) regenerates health next to
    // it; everything else is breached with a tool swing (the server enforces
    // the authored breach rule and ignores swings on explosive_only/immune).
    const def = ITEMS.find((i) => i.id === (replica.structures.get(best.id)?.contentId ?? ""));
    if (def?.building?.restable) socket.send({ ...f, heldSlot, rest: { structureEntityId: best.id } });
    else socket.send({ ...f, heldSlot, swing: { targetEntityId: best.id } });
  }
};

// ---- M4: storage structure UI (GDD §10) ----
let storagePanelFor: string | null = null;
const openStoragePanel = (structureEntityId: string): void => {
  storagePanelFor = structureEntityId;
  ui.craftOpen = false;
  craftPanel.style.display = "none";
  buildStoragePanel();
  storagePanel.style.display = "block";
  document.exitPointerLock?.();
};
const closeStoragePanel = (): void => {
  storagePanelFor = null;
  storagePanel.style.display = "none";
};
(document.getElementById("storage-close") as HTMLButtonElement).addEventListener("click", closeStoragePanel);
const buildStoragePanel = (): void => {
  const st = storagePanelFor ? replica.structures.get(storagePanelFor) : undefined;
  if (!st) return closeStoragePanel();
  const hpPct = st.maxHp > 0 ? Math.round((st.hp / st.maxHp) * 100) : 100;
  storagePanelTitle.textContent = `${st.contentId.replace(/_/g, " ")} — ${Math.round(st.hp)}/${st.maxHp} (${hpPct}%)`;
  storageGrid.innerHTML = "";
  for (let i = 0; i < st.storage.length; i++) {
    const s = st.storage[i];
    const cell = document.createElement("div");
    cell.className = "slot";
    cell.textContent = s ? `${s.itemId.replace(/_/g, " ")} ×${s.quantity}` : "";
    cell.addEventListener("click", () => {
      // click: withdraw into the first free inventory slot
      const myP = myEntity ? replica.players.get(myEntity) : undefined;
      if (!myP?.inventory) return;
      const free = myP.inventory.findIndex((x) => x === null || x === undefined);
      if (free < 0) return;
      socket.send({ ...moveFrame(), heldSlot, withdraw: { structureEntityId: st.entityId, fromSlot: i, toSlot: free } });
    });
    storageGrid.appendChild(cell);
  }
  // deposit row: one button per occupied inventory slot
  depositRow.innerHTML = "";
  const myP = myEntity ? replica.players.get(myEntity) : undefined;
  if (myP?.inventory) {
    myP.inventory.forEach((s, i) => {
      if (!s) return;
      const b = document.createElement("button");
      b.className = "craft-btn";
      b.textContent = `→ ${s.itemId.replace(/_/g, " ")} ×${s.quantity}`;
      b.addEventListener("click", () => {
        const freeSlot = st.storage.findIndex((x) => x === null || x === undefined);
        if (freeSlot < 0) return;
        socket.send({ ...moveFrame(), heldSlot, deposit: { structureEntityId: st.entityId, fromSlot: i, toSlot: freeSlot } });
      });
      depositRow.appendChild(b);
    });
  }
};
const sq = (a: number, b: number): number => {
  const d = a - b;
  return d * d;
};

// ---- key handling: movement keys, hotbar, inventory, interact, craft, place ----
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
  if ((e.key === "c" || e.key === "C") && !ui.dead) toggleCraftPanel();
  if (e.key === "Escape" && ui.placing) cancelPlacement();
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
  // M3 structures: simple colored boxes per content type + a craft-progress tint
  // M4: integrity bar when damaged + wall/door/barricade shapes
  const healthBars = structureHealthBars; // alias for clarity
  for (const [id, st] of replica.structures) {
    let g = structureMeshes.get(id);
    if (!g) {
      g = structureMeshFor(st.contentId);
      scene.add(g);
      structureMeshes.set(id, g);
    }
    g.position.set(st.x / 100, structureBaseY(st.contentId) + st.y / 100, st.z / 100);
    const child = g.children[0] as THREE.Mesh | undefined;
    if (child) {
      const mat = child.material as THREE.MeshLambertMaterial;
      mat.emissive.set(st.craft ? 0x664400 : 0x000000);
    }
    // M4: a red integrity bar above damaged pieces
    const frac = st.maxHp > 0 ? Math.max(0, st.hp / st.maxHp) : 1;
    let bar = healthBars.get(id);
    if (frac < 1 && st.hp > 0) {
      if (!bar) {
        bar = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.08, 0.08),
          new THREE.MeshBasicMaterial({ color: 0xc04030 }),
        );
        scene.add(bar);
        healthBars.set(id, bar);
      }
      bar.position.set(st.x / 100, structureBaseY(st.contentId) + 1.8 + st.y / 100, st.z / 100);
      (bar.material as THREE.MeshBasicMaterial).color.setHSL(0.0 + 0.35 * frac, 0.9, 0.5);
      bar.scale.x = Math.max(0.05, frac);
    } else if (bar) {
      scene.remove(bar);
      healthBars.delete(id);
    }
  }
  for (const [id, g] of structureMeshes) if (!replica.structures.has(id)) {
    scene.remove(g);
    structureMeshes.delete(id);
  }
  for (const [id, bar] of structureHealthBars) if (!replica.structures.has(id)) {
    scene.remove(bar);
    structureHealthBars.delete(id);
  }
};

/** A low-poly stand-in per structure content id (M4 adds a real build kit). */
const structureBaseY = (contentId: string | undefined): number => {
  switch (contentId) {
    case "wood_shelter":
      return 1.2;
    case "wood_wall":
      return 1.3;
    case "wood_door":
      return 1.2;
    case "wood_barricade":
      return 0.6;
    case "furnace":
      return 0.7;
    case "workbench":
      return 0.45;
    case "wood_storage_box":
      return 0.4;
    case "sleeping_bag":
      return 0.2;
    case "campfire":
    default:
      return 0.15;
  }
};

const structureMeshFor = (contentId: string | undefined): THREE.Group => {
  const g = new THREE.Group();
  let geo: THREE.BufferGeometry;
  let color = 0x5a4a30;
  switch (contentId) {
    case "wood_shelter":
      geo = new THREE.BoxGeometry(3, 2.4, 3);
      color = 0x8a6a40;
      break;
    case "wood_wall":
      geo = new THREE.BoxGeometry(4, 2.6, 0.3);
      color = 0x6a5030;
      break;
    case "wood_door":
      geo = new THREE.BoxGeometry(1.4, 2.4, 0.2);
      color = 0x9a7a40;
      break;
    case "wood_barricade":
      geo = new THREE.BoxGeometry(2.4, 1.2, 0.4);
      color = 0x7a6040;
      break;
    case "furnace":
      geo = new THREE.BoxGeometry(0.9, 1.4, 0.9);
      color = 0x666058;
      break;
    case "workbench":
      geo = new THREE.BoxGeometry(1.1, 0.9, 0.8);
      color = 0x7a5a30;
      break;
    case "wood_storage_box":
      geo = new THREE.BoxGeometry(0.9, 0.8, 0.9);
      color = 0x6a5030;
      break;
    case "sleeping_bag":
      geo = new THREE.BoxGeometry(1.1, 0.4, 0.8);
      color = 0x4a5a6a;
      break;
    case "campfire":
    default:
      geo = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 10);
      color = contentId === "campfire" ? 0xa05020 : 0x5a4a30;
  }
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color })));
  return g;
};

renderer.setAnimationLoop(() => {
  syncMeshes();
  updatePlacement();
  updateCraftBar();
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
