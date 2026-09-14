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
scene.fog = new THREE.Fog(0xc8b088, 100, 800);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.8, 0);

const sun = new THREE.DirectionalLight(0xfff2d0, 1.2);
sun.position.set(100, 200, 100);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x887755, 0.6));

// ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshLambertMaterial({ color: 0x8a7a55 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// spawn marker
const spawnMarker = new THREE.Mesh(
  new THREE.CylinderGeometry(2, 2, 0.2, 24),
  new THREE.MeshLambertMaterial({ color: 0x558855 }),
);
scene.add(spawnMarker);

// other players
const playerMeshes = new Map<string, THREE.Mesh>();

// ---- input ----
const keys = new Set<string>();
let yaw = 0;
let pitch = 0;
let locked = false;
let jumpQueued = false;

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Space") jumpQueued = true;
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

renderer.domElement.addEventListener("click", () => {
  if (!locked) renderer.domElement.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
});
document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  yaw -= e.movementX * 0.002;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch - e.movementY * 0.002));
});

// ---- network ----
const replica = new Replica();
const socket = new GameSocket(serverUrl);
let me = "";
let lastInput = 0;

const hud = document.getElementById("hud")!;
socket.onHello = () => {
  hud.textContent = "Connected. Click the canvas to lock the pointer.";
};
socket.onSnapshot = (s) => {
  replica.apply(s);
  if (me === "") {
    const first = replica.players.values().next().value;
    if (first) {
      me = first.entityId;
      spawnMarker.position.set(first.x / 100, 0.1, first.z / 100);
    }
  }
};
socket.start();

// send movement at 30 Hz
setInterval(() => {
  const now = performance.now();
  if (now - lastInput > 33.4) {
    lastInput = now;
    let dx = 0;
    let dz = 0;
    if (keys.has("KeyW")) { dx += Math.sin(yaw); dz += Math.cos(yaw); }
    if (keys.has("KeyS")) { dx -= Math.sin(yaw); dz -= Math.cos(yaw); }
    if (keys.has("KeyA")) { dx -= Math.cos(yaw); dz += Math.sin(yaw); }
    if (keys.has("KeyD")) { dx += Math.cos(yaw); dz -= Math.sin(yaw); }
    // quantize to cm/s
    const k = 100;
    socket.sendMovement({
      wishX: Math.round(dx * k),
      wishZ: Math.round(dz * k),
      jump: jumpQueued,
      crouch: keys.has("ControlLeft"),
      sprint: keys.has("ShiftLeft"),
      inWater: false,
      yawHundredths: Math.round((yaw * 180) / Math.PI * 100),
      pitchHundredths: Math.round((pitch * 180) / Math.PI * 100),
    });
    jumpQueued = false;
  }
}, 16);

// ---- render loop (decoupled from simulation tick, GDD §21.8) ----
const smooth = new Map<string, { x: number; y: number; z: number }>();

renderer.setAnimationLoop(() => {
  const mine = me !== "" ? replica.players.get(me) : undefined;
  if (mine) {
    // server position is authoritative; smooth small corrections
    const s = smooth.get(me) ?? { x: mine.x / 100, y: mine.y / 100 + 1.8, z: mine.z / 100 };
    const tx = mine.x / 100;
    const ty = mine.y / 100 + 1.8;
    const tz = mine.z / 100;
    const err = Math.hypot(tx - s.x, tz - s.z);
    if (err > 2) {
      s.x = tx; s.y = ty; s.z = tz; // snap (GDD §5)
    } else {
      s.x += (tx - s.x) * 0.25;
      s.y += (ty - s.y) * 0.25;
      s.z += (tz - s.z) * 0.25;
    }
    smooth.set(me, s);
    camera.position.set(s.x, s.y, s.z);
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));

    const hp = mine.health;
    const cal = mine.calories;
    hud.innerHTML =
      `tick ${replica.serverTick} | pos ${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}<br>` +
      `health <span class="bar"><div style="width:${hp}%;background:#a33"></div></span> ${Math.round(hp)}<br>` +
      `calories <span class="bar"><div style="width:${(cal / 3000) * 100}%;background:#b98"></div></span> ${Math.round(cal)}`;
  }

  for (const [id, p] of replica.players) {
    if (id === me) continue;
    let mesh = playerMeshes.get(id);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 1.8, 0.4),
        new THREE.MeshLambertMaterial({ color: 0x7a5533 }),
      );
      scene.add(mesh);
      playerMeshes.set(id, mesh);
    }
    mesh.position.set(p.x / 100, p.y / 100 + 0.9, p.z / 100);
  }

  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
