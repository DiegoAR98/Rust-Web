# Frontier Legacy: Dustfall

## Game Design Document

Version 1.1 — 2026-09-13  
Status: validated production baseline, conditional on the M-1 hardware/runtime spike  
Owner: Diego Araujo  
Source adaptation: `Personal/Frontier_Legacy` and the canonical Unity GDD at `Development/Unity_Games/Frontier_Legacy/docs/Frontier_Legacy_GDD.md`

> This is an original western survival game inspired by the feel and systemic priorities of early Rust Legacy. It does not reuse Rust branding, maps, text, assets, or proprietary code. The working title is **Frontier Legacy: Dustfall**.

## Executive summary

The player wakes half-dressed on the shore of a sealed frontier territory with a rock, a torch and two bandages. They gather timber and stone, hunt, cook, craft, build a fragile shack, smelt ore, learn blueprints, and decide whether to risk the dangerous settlements for guns and medicine. Every carried item can be lost on death. Every base can be breached. The most valuable warning is the sound of chopping, a smoke column on the horizon, or a stranger's lantern moving between the trees.

The key difference from the Unity project is delivery: Dustfall is a browser game with multiplayer as the primary release. A small authoritative server runs on Diego's computer whenever it is online. Players connect from a desktop browser over LAN or the public internet. The client renders the world with WebGL; the server owns all outcomes and persists the world locally. The game should be playable without installing Unity, Unreal, or a native game launcher.

The game targets the compact, learnable, high-consequence loop of Rust Legacy rather than the feature breadth of modern Rust: no thirst, stamina, electricity, vehicles, procedural map, skill tree, tool cupboard, item durability, quests, minimap, or MMO-scale population in the initial release.

### Validation status

The design and architecture were re-audited against the canonical Unity GDD and the intended DGX Spark/Qwen3.8-27B workflow. The document is implementation-ready after the corrections in version 1.1, with two measured prerequisites:

1. **M-1A, DGX runtime:** prove the exact Qwen3.8-27B checkpoint and serving runtime on the Spark, then record the immutable model revision, quantization, context limit, runtime image and measured tokens/s.
2. **M-1B, browser/server spike:** prove two browser clients, the deterministic Rapier build, the 30 Hz server tick, the 15 Hz replica stream and SQLite recovery on the Spark before gameplay work begins.

The Qwen model is a development tool. It is not an NPC brain, runtime service, authentication service or gameplay dependency. The game remains fully functional when the model server is stopped.

## Contents

1. Product definition and design pillars  
2. Setting and fiction  
3. Player experience and progression  
4. Controls and accessibility  
5. Character, camera and movement  
6. Survival systems  
7. Gathering and world resources  
8. Inventory and items  
9. Crafting, research and blueprints  
10. Building and base defense  
11. Combat and damage  
12. Wildlife and human AI  
13. Multiplayer threat model and raids  
14. World layout and points of interest  
15. Loot, radiation and airdrops  
16. Time, weather and environment  
17. Interface and player feedback  
18. Art direction  
19. Audio direction  
20. Persistence and world lifecycle  
21. Web technical architecture  
22. Multiplayer hosting and networking  
23. Security, operations and moderation  
24. Data contracts and identifiers  
25. Production roadmap  
26. Test plan and release gates  
27. Risks and decisions  
28. Handoff rules  
Appendix A. Content catalog  
Appendix B. Recipes and economy  
Appendix C. Building catalog  
Appendix D. Loot tables  
Appendix E. Creatures and human archetypes  
Appendix F. Tuning constants  
Appendix G. Save schema  
Appendix H. Glossary

## 1. Product definition and design pillars

| Field | Decision |
|---|---|
| Working title | Frontier Legacy: Dustfall |
| Genre | First-person multiplayer survival, crafting, base building and emergent PvP/PvE |
| Platform | Desktop browsers with WebGL2; Chrome, Edge and Firefox first |
| Camera | First-person only; no third-person combat |
| Session | 30–120 minutes; the world remains persistent between sessions |
| Server population | 8 players at launch; protocol designed for 16 |
| World size | 2 km × 2 km hand-authored frontier basin |
| Server | Authoritative Node.js process hosted on Diego's computer |
| Client | TypeScript, Vite, Three.js/WebGL2; WebGPU enhancement later |
| Simulation | Shared TypeScript package, fixed 30 Hz tick, deterministic seeded RNG where practical |
| Persistence | Local SQLite world database plus versioned JSON export/import |
| Business model | Free prototype; no monetization or account system in the first release |
| Visual target | Readable low-poly western frontier, 60 render fps on a normal desktop GPU |
| Design target | Early Rust Legacy's scarcity, short item ladder, permanent loss and landmark navigation |

### Design pillars

1. **The world teaches through evidence.** Landmarks, smoke, lanterns, gunshots, corpses and handwritten notes carry information. The HUD is deliberately quiet.
2. **Loss creates a new objective.** Death drops the entire carried inventory. A raider may carry it home, turning recovery into a trackable story.
3. **Players and AI obey the same rules.** Human NPCs use the same weapons, doors, armor, movement constraints and damage model as players.
4. **A short ladder creates meaningful choices.** One Workbench, a small number of resources, and recognizable weapon tiers are preferable to menu sprawl.
5. **Minutes to shelter, hours to power.** The first shack is fast. A metal door, rifle, radiation suit and raid stock require dangerous excursions.
6. **The server is a world, not a match.** The basin continues to age, refill, decay and remember while players are online. When the host shuts down, the saved world pauses.

### Explicitly out of scope for launch

Modern Rust-style electricity, vehicles, farming, horses, boats, procedural terrain, monuments with puzzle rooms, clans with account persistence, cosmetics, seasonal wipes, thirst, stamina, skill trees, item durability, repair benches, map/minimap, voice chat, full-body avatars, dedicated cloud hosting, and pay-to-win systems.

## 2. Setting and fiction

### The Dustfall Basin

Dustfall is a remote frontier basin built around a failed silver-and-uranium extraction project. The territory was once a company town with a rail spur, a military fort, a hydro plant and scattered ranch terraces. A containment failure known only as **the Quiet** ended outside communication over eleven days. The official record stops mid-sentence. Buildings remain stocked, some machinery still runs, and no authority remains capable of closing the gates.

The game never reveals a canonical explanation for the Quiet. Notes disagree: a foreman blames a mine collapse, a medic blames poisoned water, and a guard blames orders from the capital. The unresolved mystery is atmosphere, not a quest line.

### Relief and arrivals

An automated relief contract still drops supply crates at marked clearings. A mail plane crosses the basin on a fixed schedule; the player hears it before seeing it. The same abandoned relief route explains why new survivors arrive at Bootheel Landing and why the player can respawn there.

### Factions

- **The player and other survivors:** unaffiliated settlers competing for the same scarce resources.
- **Outlaw bands:** named AI crews that settle, craft, scout, fight, raid and decline over time. They are the multiplayer replacement for some of the pressure created by a populated Legacy server and remain active when fewer than eight players are online.
- **The Wardens:** a six-person garrison occupying Fort Ashby. They never leave their perimeter, never raid, and never negotiate. They are a high-risk source of weapons and armor.

### Tone

Dry wind, long sightlines, rough timber, canvas, rusted rail, sun-bleached signage and warm firelight. The western theme is a visual and social frame, not a fantasy setting: no magic, monsters, steampunk firearms, cowboy parody, or historical claim of exact realism.

## 3. Player experience and progression

### Nested loops

| Loop | Length | Player question | Closure |
|---|---:|---|---|
| Moment | 30–90 s | What can I gather, and who can see me? | A node is harvested or an observed threat is understood |
| Errand | 10–20 min | Can I reach the destination and return before danger finds me? | Materials are inside the base, or the run becomes a recovery objective |
| Session | 45–120 min | Which rung am I buying today? | Shack, Furnace, Workbench, weapon, armor, metal door or raid |
| World | 10–25 h | Who owns the basin, and what have I made worth taking? | No final victory; the world settles into an arms race |

### First-session arc

| Time | Intended player state | World pressure |
|---:|---|---|
| 0–5 min | Rock, torch, Stone Hatchet, Campfire, cooked meat | Bootheel Landing is safe; a distant campfire or smoke column hints at a nearby band |
| 5–30 min | Wood Shelter, first storage, Sleeping Bag, Cloth clothing | A two-person road party passes within sight; it does not fire unless attacked |
| 30–60 min | Bow, larger wood hut, Furnace or Workbench | Night reveals lanterns, wolves, smoke and the first evidence tokens |
| 1–2 h | Pipe Shotgun, metal fragments, first ore run | A crew scout may leave a colored cloth strip near the player's base |
| 2–5 h | Metal Door, better storage, first blueprint research | The first raid is telegraphed and resolved; the player either defends or begins recovery |
| 5–10 h | Leather or Rad Suit pieces, sidearm, explosives, fortified base | Fort Ashby and supply drops become contestable objectives |
| 10 h+ | Metal compound, rifles, repeated raids and retaliation | Outlaw bands rise, decline, relocate and leave a persistent history |

### Progression rules

- Blueprints are the only persistent progression. They survive death but belong to the current world save.
- The player never receives XP, levels, attributes or skill points.
- Death is immediate at zero health; there is no downed state in the initial release.
- Death drops all inventory, hotbar contents, equipped armor and the held item in one corpse bag.
- Respawn is at the most recent valid Sleeping Bag/Bed or a random Bootheel Landing beach spawn.
- Every spawn gives a Rock, Torch and two Bandages.
- The progression ladder is intentionally parallel: building, weapons, armor, radiation access and base defense do not require one single linear quest.

### Difficulty presets

| Preset | AI accuracy | AI perception | Active humans | Active animals | Warden relief |
|---|---:|---:|---:|---:|---:|
| Quiet Trail | 0.7× | 0.8× | 10 | 8 | 3 days |
| Dustfall (default) | 1.0× | 1.0× | 14 | 8 | 2 days |
| Hard Country | 1.2× | 1.2× | 16 | 8 | 1 day |

Difficulty changes human pressure and refill timing only. It does not secretly weaken hunger, gathering, crafting, structure HP or player weapons.

## 4. Controls and accessibility

### Default desktop controls

| Action | Input |
|---|---|
| Move | W/A/S/D |
| Look | Mouse |
| Jump | Space |
| Crouch | Left Ctrl; hold by default, toggle option |
| Sprint | Left Shift; free, no stamina |
| Primary use / fire / gather | Left mouse |
| Secondary use / ADS / alternate | Right mouse |
| Reload | R |
| Interact | E |
| Inventory | Tab |
| Crafting | C |
| Building | B |
| Hotbar | 1–8; mouse wheel |
| Drop item | G while inventory is open |
| Toggle torch/light | F |
| Chat | Enter; multiplayer only |
| Pause/options | Esc; host pauses simulation only in solo mode, never in multiplayer |

The browser must request pointer lock only after an explicit click. If pointer lock is denied, a non-locked look mode remains available at reduced usability.

Accessibility launch set: remappable keyboard actions, hold/toggle crouch and sprint, FOV slider 70–100, UI scale 80–140%, color-blind-safe status icons, reduced camera shake, reduced flashing, subtitles for bark/important audio cues, high-contrast interaction outlines, and a low-quality mode for integrated GPUs.

## 5. Character, camera and movement

The player is a 1.8 m capsule with a 0.3 m radius. Server movement is intent-based: each input packet contains buttons, camera yaw/pitch, client tick and sequence number; it never contains an outcome or teleport.

| Parameter | Starting value |
|---|---:|
| Walk speed | 3.5 m/s |
| Sprint speed | 5.5 m/s |
| Crouch speed | 1.8 m/s |
| Jump impulse | 5.0 m/s |
| Gravity | 19.6 m/s² |
| Max step height | 0.30 m |
| Blocking lip | 0.40 m |
| Swim speed | 2.2 m/s |
| Fall damage threshold | 3.0 m |
| Fall damage | 10 hp per meter above threshold |
| Default FOV | 80° |
| Simulation tick | 30 Hz |
| Render target | 60 fps |

No stamina bar exists. Sprint is free; tool swings cost calories. Swimming is slow and exposes the player. Water deeper than chest height blocks ordinary building.

The client predicts only cosmetic locomotion and camera motion. The server's replicated position is authoritative; correction is smoothed over 100–200 ms unless the error exceeds 2 m, in which case the client snaps and logs a correction event.

## 6. Survival systems

### Player vitals

| Vital | Range | Default | Rule |
|---|---:|---:|---|
| Health | 0–100 | 100 | Zero causes immediate death |
| Calories | 0–3000 | 1500 | Passive drain; food restores calories and may heal |
| Radiation | 0–500 | 0 | At 500, radiation sickness becomes lethal without treatment |
| Bleeding | 0–100 | 0 | Damage-over-time until bandaged or medically treated |
| Cold deficit | 0–100 | 0 | Derived from environment minus warmth |
| Poisoned | flag + timer | off | Raw meat can apply it |
| Radiation sickness | flag + timer | off | High dose applies escalating health loss |
| Comfort | flag + timer | off | Near a lit fire with no cold deficit; improves healing |

There is no thirst and no stamina. The omission is deliberate Legacy fidelity and keeps the web HUD legible.

### Calories

Base drain is 0.35 calories/s while idle, 0.55 while moving and 0.80 while sprinting. A tool swing adds the tool's authored calorie cost. At zero calories, health drains at 0.25 hp/s. Food values are owned by Appendix B.

### Cold

Each tick computes `coldPressure = regionBase + altitude + night + weather - shelterBonus`. Worn warmth is summed from armor and active heat sources. `coldDeficit = max(0, coldPressure - warmth)`. At deficit 1–24 the player is cold and drains extra calories; at 25–59 health regeneration stops; at 60+ the player takes 0.5 hp/s and gains bleeding risk. A lit Campfire within 6 m grants Comfort if deficit is zero, raising passive regeneration from 0.15 to 0.50 hp/s.

### Radiation

Four authored zones use concentric rim/mid/core rings. Dose rates are never summed across overlaps; the highest current zone wins. Starting band values:

| Band | Rim | Mid | Core |
|---|---:|---:|---:|
| Low | 0.5 rads/s | 1.0 | 2.0 |
| High | 1.5 | 3.0 | 5.0 |
| Extreme | 12.0 | 24.0 | 40.0 |

Full Rad Suit protection is 90%, so an Extreme core applies 4.0 rads/s to a fully suited player and reaches 500 rads in 125 seconds. A naked player in a High core takes 5.0 rads/s and reaches 500 in 100 seconds. This restores the canonical distinction: Fort Ashby is a timed raid-town run; Greywater Plant remains dangerous even in the specialist suit. The browser client displays radiation only as a bar and icon; the exact number is not shown by default.

### Bleeding and medicine

Bleeding ticks for 2.0 hp/s. Bandage stops it and heals 5 hp over 10 s. Small Medkit heals 40 hp over 8 s; Large Medkit heals 100 hp over 20 s. Medical use is a channel: movement is allowed at walking speed, firing/sprinting/switching cancels it, and a shared 4 s medical cooldown prevents spam. Anti-Radiation Pills remove 200 rads immediately. Raw meat has a 30% Poisoned chance; cooked meat has none.

## 7. Gathering and world resources

### Nodes

The world contains trees, wood piles, stone rocks, metal ore rocks, sulfur ore rocks and animal corpses. Nodes have a finite local resource pool and respawn after an authored timer. A swing is resolved at the server's hit time, not when the client animation began.

| Node | Primary yield | Tool preference |
|---|---|---|
| Tree / wood pile | Wood | Stone Hatchet, Hatchet |
| Stone rock | Stone | Rock, Pickaxe |
| Metal ore rock | Metal Ore | Pickaxe |
| Sulfur ore rock | Sulfur Ore | Pickaxe |
| Animal corpse | Meat, Cloth, Fat, occasional Blood | Hatchet best; Pickaxe still works |

Each node has a resource pool, not hit points. A swing adds `toolMultiplier` to a harvest accumulator; each whole unit pays out exactly one resource unit. This permits half-rate tools to pay every second swing without rounding exploits.

Node respawns are seeded and region-specific. Respawn never occurs within 60 m of a live player, so a player cannot watch a tree pop into existence. World cap: 400 loose dropped item stacks.

### Evidence emitted by gathering

Daytime chopping creates `activity` and `hammer` evidence; night chopping also creates `light` if a torch is equipped. The evidence system is the only legal route by which AI can learn a player's location.

## 8. Inventory and items

The inventory is a 36-slot grid: slots 0–27 main inventory and 28–35 hotbar. Equipment has helmet, vest, pants and boots slots. Weapons and tools stack to 1; resources and consumables use catalog-defined stack limits. There is no item condition or durability at launch.

Containers are deliberately insecure unless physically defended. A Wood Storage Box has 12 slots, a Large Wood Storage Box has 30, a Small Stash has 3 and is hidden unless a player is close and looking toward it. A Furnace and Workbench expose their own input/output slots.

Rules:

- Stacks merge only when item id and blueprint payload match.
- Moving items is server-authoritative and atomic; either the whole move is accepted or the UI rolls back.
- A death transaction creates one corpse with inventory, hotbar and equipment in stable slot order.
- Ground pickups merge within 1.5 m with the same item/payload and despawn after their catalog timer.
- A client may optimistically animate a drag but may not display a confirmed count until the replica accepts it.

## 9. Crafting, research and blueprints

Crafting uses one queue per player and one shared queue per Campfire/Furnace. A player may move while crafting. Taking damage does not cancel ordinary crafting; combat and movement interrupts cancel research, healing and building placement channels.

### Stations

- **Hand crafting:** default tools, starter weapons, Campfire, Sleeping Bag, basic building pieces and Cloth clothing.
- **Campfire:** cooks meat and creates Charcoal; three cook slots and one fuel slot.
- **Furnace:** smelts Metal Ore to Metal Fragments, Sulfur Ore to Sulfur, Cloth to Leather, and Wood to Charcoal; three input and three output slots.
- **Workbench:** required for advanced weapons, Research Kits, medkits, explosives, attachments and metal building upgrades.

### Research

A Research Kit plus one unit of a researchable item at a Workbench takes 5 s and permanently teaches its blueprint payload. A physical Blueprint item can be studied directly and consumed. Research refuses default recipes, loot-only items and an already-known payload. `bp_metal_building` is the one payload that comes only from loot; no item carries it.

## 10. Building and base defense

Building uses a 4 m square grid with sockets and levels. Placement is server-validated against terrain, occupancy, support, height, water, range, ownership and build rate limits. The client shows a ghost that is explicitly provisional until the replica confirms placement.

### Structural pieces

Wood is the initial tier. Metal is an in-place upgrade, not a separate wall item. Foundations, pillars and ceilings are immune to damage and removed only by decay; doors, shutters, gates, barricades, spikes, deployables and walls have authored damage rules.

| Piece | Role | Starting rule |
|---|---|---|
| Foundation | 4 m × 4 m base cell | Terrain only; damage immune |
| Pillar | Supports walls and floors | Socketed to foundation |
| Wall | Main enclosure | Explosives only |
| Doorway | Wall with door socket | Accepts Wood or Metal Door |
| Window | Sightline and shooting opening | Accepts shutter or metal bars |
| Ceiling | Upper floor / roof | Damage immune |
| Stairs / Ramp | Vertical circulation | Occupies authored sockets |
| Shelter | 2 m × 2 m first-night hut | Wood-only, terrain only |
| Gateway / Gate | Perimeter entrance | Door-like breach target |

### Doors and decay

Wood Door: 500 HP, owner-only lock, breakable by melee and explosives. Metal Door: immune to melee and bullets, vulnerable to charges. Walls cannot be chopped through. No tool cupboard exists. Decay refreshes when the owner is within 50 m; unattended pieces decay on a tier-specific timer. Decay is the maintenance pressure that keeps the persistent basin from filling permanently.

### Base design choices

The player is expected to choose between a cheap single-room hut, an airlock, a high storage floor, a perimeter of spikes, concealed Small Stashes, and a remote low-evidence location. A base is not invulnerable; an unreachable door causes a siege rather than an engine exception.

## 11. Combat and damage

Combat is server-authoritative. The client sends intent—weapon slot, yaw, pitch, target-independent sequence and client tick—not damage or hit confirmation.

### Weapon model

- Melee: animation-timed sphere check, 1.5 m forward reach, first hit only.
- Bow: physical arrow projectile with gravity and recoverable misses.
- Firearms: hitscan with falloff, spread, bloom, recoil and magazine/reload rules.
- Explosives: fixed fuse, line-of-sight character damage, predictable structure splash.
- No weapon penetrates walls.

### Damage formula

`finalDamage = baseDamage × falloff × zoneMultiplier × (1 - clamp(sumArmorReduction, 0, 0.60))`

Head multiplier is 1.5. Limb multiplier is 0.75. Armor reductions are summed across worn pieces and damage type, not applied only to the struck slot. Every hittable character has a server-authored capsule profile; the animated mesh never decides hits.

### Rewind and fairness

The server stores 20 ticks of position history. A shot resolves against the target pose at the shooter's acknowledged client tick, clamped to that history window. Offline and LAN play still use the same path. The server rejects impossible fire rates, impossible aim deltas, stale sequence numbers and commands outside the allowed rewind window.

### Explosives

Hand Grenade: 4 s fuse, 85 structure damage. Explosive Charge: 10 s fuse, 600 damage to its planted target, with predictable splash. Reference breach counts: six grenades for a Wood Door, one charge for a Wood Door, two charges for a Metal Door or Wood Wall, four charges for a Metal Wall.

### Feedback contract

The client can play a swing, shot, shell eject, muzzle flash and recoil immediately. Hit markers, health changes, ammo counts, kills, broken doors and placed pieces wait for authoritative replica events. There are no damage numbers or kill feed in the initial release.

## 12. Wildlife and human AI

### Wildlife

Eight animal definitions ship: Rabbit, Chicken, Deer, Boar, Wolf, Bear, Red Wolf and Red Bear. Rabbits, chickens and deer flee. Boar is neutral until cornered. Wolves attack and may pack; bears are solitary and dangerous. Red variants spawn only near radiation boundaries and have higher harvest value.

Wildlife uses a simple finite-state machine: Idle, Wander, Flee, Investigate, Attack, Search, Return and Dead. No more than eight animals are active at once. Spawning avoids the camera frustum and never creates an animal directly beside a player.

### Human archetypes

Forager, Hunter, Bruiser, Sapper, Marksman and Chief are shared archetypes for Outlaw bands. A human has 100 base HP, a real inventory, a weapon, armor, a role and a tactical state. Human NPCs can gather, eat, heal, carry loot, open doors, place explosives, retreat, die and leave a corpse.

The tactical machine is intentionally small: Sleep, Idle, Guard, Travel, Patrol, Ambush, Investigate, Wary, Combat, Breach, Loot, Carry, Flee, Stuck and Dead. Adding a new state requires a test scenario and a written design decision.

### Perception

AI can detect players through sight, hearing and persistent evidence. Detection time ranges from 0.4 s at 15 m to 1.5 s at sight range, doubled at night and multiplied by 0.65 when the player crouches. Torch visibility reaches 150 m; muzzle flash reaches 200 m without a silencer. Last-known position lasts 30 s. A low-Heat encounter enters Wary rather than immediate combat.

## 13. Multiplayer threat model and raids

### Outlaw bands

At world creation, the Director seeds 2–3 named bands with color, glyph, temperament and a settlement site. Temperaments are Timid, Opportunist and Warlord. Bands progress through T0 Landing, T1 Shack, T2 Lodge and T3 Compound, then Decline and Dissolved. Their bases use the same grid and piece definitions as players.

### Evidence and belief

Evidence tokens: `smoke`, `light`, `glow`, `hammer`, `shot`, `blast`, `sighting`, `crime`, `activity`, `corpse`. Each token contains type, location, tick, emitter and decay time. An AI band stores a `PlayerBaseBelief` with confidence, last position, believed door tier and estimated base value. There is no omniscient AI shortcut.

### Threat and raid tier

`raidTier = min(crewStage, playerThreatTier, baseValueTier + 1)`.

Player Threat rises with weapons, armor, stored loot and survival time, and falls after death. Base Value sums value points in owned containers, Furnace and Workbench; carried inventory does not increase it. This prevents a player from being punished for merely holding a bow while making a rich storage base visible to raiders.

### Raid flow

1. Evidence creates or updates a belief.
2. A scout confirms the position and leaves a colored Cloth Strip 40–80 m away.
3. The Director checks grace period, raid spacing, recovery period and feasibility.
4. A squad forms with roles, supplies and a provenance tag on every carried item.
5. The squad travels by world path, pauses at an 80 m stage line for 30 s, and approaches the door's 1.5 m approach node.
6. The squad breaches, loots for a maximum of 8 minutes, plants a Calling Card and withdraws.
7. A Looter can carry a player's corpse contents to the crew's actual storage box.

Tier 1 uses melee against Wood Doors. Tier 2 adds grenades and a larger party. Tier 3 uses charges, marksmen and a Sapper. If no door is reachable, the squad performs a siege: it camps, destroys exterior deployables and pressures the player on exit. A night probe may strike a door for 30 s after seeing a light and steal one stack.

The first raid is guaranteed by the end of day five only if no organic raid happened earlier. It is readable, not a surprise: the player sees the Cloth Strip, hears travel, can detect the stage line, and receives no magic warning banner.

### Wardens

Fort Ashby has three Warden Guards, two Warden Marksmen and one Warden Captain. They defend a 120 m perimeter, converge on alarms for 90 s, never pursue beyond the perimeter, never loot, and are replenished by relief after 1–3 days depending on difficulty. The Captain always drops the Assault Rifle and Ballistic set.

## 14. World layout and points of interest

The basin is hand-authored as sixteen 500 m terrain tiles. Ridge Road loops through all major regions and acts as the player's first navigation lesson. There is no minimap and no default compass. A debug/admin map may exist behind a server flag but never ships to ordinary players.

| Region | Function | Resources / danger |
|---|---|---|
| Bootheel Landing | Spawn beaches, jetty, wreckage | Wood, stone, small crates; safest region |
| Pinewatch | Central pine forest and logging yard | Dense timber, deer, boar, wolves at night |
| Sunscorched Terraces | Farm ruins, barns and silo | Open sightlines, stone, food, ambush risk |
| Shalefield Mine | First low-radiation mining town | Metal and sulfur; first crew expedition target |
| Cinder Rail Station | Rail yard and abandoned depot | Barrels, ammo and long sightlines |
| Fort Ashby | Warden military compound | Weapons, armor, highest human threat |
| Greywater Plant | Extreme radiation industrial site | Best loot, Rad Suit requirement |
| Coldspine | High mountain and snow line | Cold, red wildlife, rifle sightlines |
| Ridge Road | Landmark loop and travel corridor | Ambush spots, road parties and navigation |

The vertical slice is Bootheel Landing, Pinewatch and Shalefield. The full MVP includes all regions, 24 Outlaw settlement sites, 10 drop zones, 4 radiation areas, animal spawn markers, crate markers, ambush spots and authored note/radio props.

## 15. Loot, radiation and airdrops

### Containers

Small Wooden Crates, Barrels, Ammo Crates, Medical Crates, Weapon Crates and Warden stores use fixed seeded loot tables. Containers refill on timers but not while a player is actively looting them. A container's inventory is server-owned and persists.

### Supply drops

The relief plane drops a crate every 35 real minutes at a scheduled drop zone. A Supply Signal can call a drop near the thrower: purple smoke for 60 s, then the plane arrives within 40 m. Outlaw bands contest scheduled and signaled drops. Players hear the engine and see the crate descent; the HUD never marks it.

### Radiation economy

Radiation is a timer, not a puzzle. Shalefield is survivable in ordinary clothing for a short run. Greywater requires a Rad Suit or pills and a planned route. Food, Water Bottles and Anti-Radiation Pills remove fixed amounts of accumulated radiation.

## 16. Time, weather and environment

One in-game day is 60 real minutes: 45 daylight and 15 night. The server owns the clock. Thirty simulation ticks advance exactly 1.0 game second; 108,000 ticks advance exactly 86,400 game seconds.

Night starts at 23:00:00 and ends at 05:00:00. At night, visibility and AI sight ranges fall, lanterns matter, wolves become more active, and fire/smoke evidence becomes valuable.

Weather states: Clear, Overcast, Rain, Fog and Dry Wind. Weather changes temperature, visibility, audio propagation and fire behavior. It does not become a separate survival stat. Rain and fog are seeded, bounded events with a minimum clear interval so the world remains readable.

## 17. Interface and player feedback

The HUD contains health, calories, radiation, a compact status strip, hotbar, interaction prompt, crosshair and notices. It does not show a map, quest marker, raid warning, damage numbers, enemy names, exact coordinates or an inventory count in world space.

Screens: inventory, crafting, research, building, container, death/respawn, settings, server browser/connect, host controls and chat. The UI uses DOM/CSS overlays for menus and a single canvas for the world. Menus must pause input but never silently pause a multiplayer server.

State rule: confirmed values come from the replica store. Cosmetic optimism is allowed for animations and audio only. A rejected operation produces a small, readable notice and restores the previous UI state.

## 18. Art direction

Low-poly, stylized, readable at medium distance. Geometry is chunky enough to silhouette in fog and at night. Materials use dusty ochres, pine greens, faded blue paint, iron gray, canvas tan and hazard green. Western signals: telegraph poles, rail ties, horse troughs, saloon-style signage, mining headframes, fort palisades and hand-painted crew glyphs.

Performance rules: atlas small props, use instancing for trees/rocks, limit real-time lights to fire/lanterns and one directional sun, use baked or cheap ambient lighting, stream region chunks, avoid dense transparency, and use simple impostors beyond 150 m. View-model weapons are separate from world meshes so they read clearly in first person.

Art milestones use greybox shapes first, then a coherent free/owned asset set. No asset is copied from Rust or another commercial game.

## 19. Audio direction

Audio is a gameplay sensor. Footsteps, tool impacts, doors, fire, furnace, animal calls and weapon classes must be distinguishable at distance. Firearm audible radius is the same number used by AI hearing evidence.

Launch groups: Master, Music/ambience, SFX, Weapons, UI, Voice placeholder and World. Use pooled positional sources and distance layers: near, mid and far. Audio files should be compressed for browser delivery, loaded by region or category, and unloaded when not needed. Voice chat is later.

## 20. Persistence and world lifecycle

The server persists:

- world seed, schema version and server settings;
- clock, weather and RNG state;
- players, blueprints, vitals, inventories, equipment, bags and last positions;
- structures, tiers, ownership, locks, health and decay timestamps;
- containers, furnaces, workbenches, loot state and ground pickups;
- resource-node depletion and respawn timestamps;
- animals, Outlaw bands, beliefs, Heat, raids and Warden relief timers;
- notes, markers, airdrops and event history needed for recovery.

Autosave every 5 minutes, on clean shutdown, and after a high-impact transaction such as death, building placement, raid breach or blueprint learn. Write to a transaction table first, then commit. Keep the last three backups. A crash may lose at most 5 minutes of ordinary progress and must never duplicate an item or erase a confirmed death transaction.

World slots are separate SQLite files under the host's configured data directory. JSON export is for debugging, backup and future migrations, not for live writes. Every save has a schema version and a migration function.

## 21. Web technical architecture

### 21.1 Runtime separation

There are three independent planes. They communicate only where explicitly stated.

| Plane | Runs where | Responsibility | Forbidden dependency |
|---|---|---|---|
| Browser client | Each player's computer | Input, rendering, audio, UI, interpolation and cosmetic prediction | Cannot write authoritative world state |
| Game host | DGX Spark or another Linux host | HTTP assets, WebSocket gateway, 30 Hz simulation, AI, validation and SQLite persistence | Cannot call Qwen or require a GPU |
| Development agent | DGX Spark, localhost only | Qwen3.8-27B inference plus a coding harness operating on the repository | Cannot access the live world database or public game port |

Stopping Qwen must not disconnect players. Restarting the game host must not restart Qwen. The game host container requests no GPU device. If both run simultaneously, the game host receives reserved CPU and memory and Qwen yields resources; release performance is measured once with Qwen stopped and once with it running.

### 21.2 Pinned stack

The baseline is deliberately narrow so Qwen never has to choose a framework during implementation.

| Concern | Selected technology | Rule |
|---|---|---|
| Language | TypeScript with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | No untyped JavaScript in authoritative code |
| Runtime | Node.js 24 LTS, exact minor pinned in `.node-version` and container digest | Upgrade only between milestones |
| Workspace | pnpm, exact version in `packageManager` | Commit `pnpm-lock.yaml`; CI uses `--frozen-lockfile` |
| Browser build | Vite | Production build must be reproducible from a clean clone |
| Renderer | Three.js `WebGLRenderer` / WebGL2 | WebGPU is Later; no renderer fork during MVP |
| Physics | `@dimforge/rapier3d-deterministic` WASM | Same pinned package in browser and server; server remains authoritative |
| HTTP | Node HTTP server behind Caddy | Caddy owns TLS and static compression in public mode |
| Realtime | `ws` WebSocket library | One connection per player; binary frames only after handshake |
| Wire codec | `@msgpack/msgpack` plus Zod boundary schemas | Version every envelope; reject invalid input before dispatch |
| Database | Node 24 `node:sqlite`, WAL mode | M-1 must prove it on ARM64; only approved fallback is `better-sqlite3`, recorded before M0 |
| Unit tests | Vitest | Fake clock and seeded RNG required in simulation tests |
| Browser tests | Playwright, Chromium first | Firefox gate begins at M5 |
| Deployment | Docker Compose on DGX OS | ARM64 images only; pin image digests for releases |

Rapier's deterministic build is chosen because ordinary Rapier does not guarantee cross-platform determinism. Vite can load the WASM package directly; do not use a compatibility build that requires weakening the Content Security Policy unless M-1 proves the standard build cannot load.

### 21.3 Repository layout

```text
apps/client/                 Vite browser client
apps/server/                 authoritative host process
apps/admin-cli/              localhost-only host administration
packages/contracts/          branded ids, math structs, content/wire/save DTOs
packages/sim/                fixed-tick simulation, rules and components
packages/protocol/           schemas, codecs, commands and events
packages/content/            item/recipe/region data
packages/physics/            Rapier implementation of the physics-port contract
packages/persistence/        SQLite repositories, migrations and backup code
packages/testkit/            deterministic fixtures and fake clients
tools/                       validators, asset pipeline, soak and packet inspection
docs/adr/                    architecture decisions; one file per decision
docs/milestones/             current and completed milestone briefs
```

Dependency direction is one-way. In this diagram, `A -> B` means A may import B:

```text
content     -> contracts
protocol    -> contracts
sim         -> contracts + content
physics     -> contracts
persistence -> contracts
server      -> contracts + content + protocol + sim + physics + persistence
client      -> contracts + content + protocol + physics
```

`client` never imports server, sim or persistence. `sim` never imports Rapier, Node, DOM, Three.js, WebSocket, SQLite, filesystem, timers or wall-clock APIs; it calls a `PhysicsPort` interface from contracts. `physics` implements that port. `protocol` contains transport contracts only and never applies gameplay outcomes.

### 21.4 Authority boundary

`packages/sim` is engine-free. It owns components, intents, rules, systems, fixed time, seeded randomness, combat, gathering, crafting, building, survival, AI and persistence DTOs. The client submits intents and renders a read-only replica. The server is the only process allowed to mutate the live world.

```text
Browser input
    -> validated command
    -> server tick / simulation
    -> authoritative events + snapshot delta
    -> client replica
    -> rendering, UI and audio
```

The server must never trust a client-provided health value, damage value, inventory result, final world position, blueprint unlock, structure tier, loot roll, RNG seed, target damage or “I hit target” claim. An intent may carry buttons, look direction, selected slot, target entity id, requested recipe, requested socket, client tick and monotonic sequence. The server independently proves range, line of sight, ownership, cost, cooldown and result.

### 21.5 Deterministic simulation

- Fixed tick is exactly 30 Hz. All simulation durations are integer ticks. Wall-clock time is used only to schedule catch-up and write timestamps.
- Each host frame executes at most five catch-up ticks. If still behind, it records `tick_overrun`, lowers nonessential AI work and never increases `dt`.
- Entity iteration is stable ascending `EntityId`; unordered object/map iteration is forbidden in outcome-producing code.
- Gameplay RNG is a named seeded stream using one specified algorithm. Each subsystem owns a stream derived from `worldSeed + subsystemId`; `Math.random()` is forbidden in `packages/sim`.
- Floating-point values crossing the wire are quantized: position centimeters as signed integers, yaw/pitch in 1/100 degree, velocity centimeters/s. Authoritative internal physics may use float32 through Rapier.
- Tests may replay the same command log twice and require identical authoritative hashes every 300 ticks.

Tick order is fixed and tested. Commands for one tick are sorted by `PlayerId`, then sequence:

1. drain and validate inbound commands;
2. session, spawn and respawn transitions;
3. player movement and posture;
4. interactions, gathering, inventory, crafting and building intents;
5. weapon fire, projectiles, fuses and hit resolution;
6. damage, death, corpse and destruction transitions;
7. survival, status effects, stations, node respawn, weather and decay;
8. AI perception/evidence, planning, movement and action intents;
9. process AI actions through the same authoritative handlers;
10. collect durable transactions, authoritative events and dirty components;
11. build per-client interest sets and replica batches;
12. advance tick exactly once.

No system directly invokes a later system to force an immediate second pass. It emits a typed request consumed at the documented point in this order.

### 21.6 Physics ownership

Rapier owns terrain collision, character shape casts, static build colliders, projectiles and line-of-sight queries. The server is the authority. The browser uses the same movement adapter only for local prediction and immediately accepts server correction. Dynamic rigid-body sandbox behavior is out of scope; dropped items use cheap kinematic settling and sleep.

The physics adapter exposes only `moveCharacter`, `raycast`, `shapeCast`, `overlap`, `addStaticCollider`, `removeCollider` and `step`. Rapier handles never escape `packages/physics`. Every collider stores an `EntityId`; rendered meshes are not hitboxes.

### 21.7 Tick and replication

Clients send input batches at 30 Hz. The server sends replica batches at exactly 15 Hz for the initial release. Every batch carries protocol version, server tick, batch sequence, acknowledged client-input sequence and baseline id. Interest enters at 200 m and leaves at 300 m; globally important low-frequency records such as day phase and airdrop aircraft are sent separately.

Each entity has a monotonic `EntityId`. Replica records are Spawn, Delta, Event and Forget. Unknown or malformed records are rejected without mutating the replica. The server sends a full baseline on join, then deltas.

WebSocket is reliable and ordered. Therefore no message is described as “unreliable.” Instead:

- old unsent movement snapshots are superseded before entering the socket queue;
- authoritative inventory, damage, death, build, blueprint and connection events are never dropped;
- `perMessageDeflate` is disabled for high-frequency binary frames;
- average post-baseline budget is 32 KiB/s per client and the 5-second burst ceiling is 128 KiB/s;
- an encoded baseline may be at most 2 MiB and is chunked into 64 KiB frames;
- if queued socket bytes exceed 4 MiB for 10 seconds, the server disconnects that slow client with `BACKPRESSURE` rather than growing memory without bound.

WebTransport datagrams are a Later experiment only after browser support and the WebSocket implementation are measured.

### 21.8 Browser rendering and streaming

The client uses a single WebGL canvas, chunked world streaming, instanced foliage, pooled effects and a fixed view-model layer. The render loop is decoupled from simulation tick. When a tab is backgrounded, the client stops requesting frames but remains connected; the server continues until the player times out or disconnects.

World content is divided into 250 m render chunks, independent from the 500 m authoring tiles. Load the current chunk plus one ring; prefetch the movement-facing ring. Static collision required by prediction loads before visuals. Launch budgets at 1080p High: 1,500 draw calls maximum, 2.0 million visible triangles maximum, 512 MiB estimated GPU textures maximum, four shadow-casting local lights maximum and one directional shadow map. Low mode targets 750 draw calls, 800k triangles and 256 MiB textures.

The client listens for `visibilitychange`, pointer-lock loss, WebGL context loss and network offline/online events. A hidden tab sends a heartbeat but no movement. After 30 seconds hidden, the server marks the body idle; after the configured disconnect timeout, normal disconnect-body rules apply.

### 21.9 Persistence contract

SQLite runs with `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL` for release worlds and a 5-second busy timeout. Schema migrations run inside one transaction before the world starts. A failed migration leaves the previous database untouched and prevents hosting.

Tables are normalized around `world`, `player`, `entity`, `component`, `inventory_slot`, `blueprint`, `crew`, `scheduled_event`, `command_journal` and `schema_migration`. Every irreversible command carries an idempotency key `(playerId, sessionId, sequence)` with a unique constraint. The same command replay returns the stored result and does not apply twice.

Persistence has three explicit durability classes:

| Class | Examples | Commit/ack rule |
|---|---|---|
| A: economy/identity | pickup, inventory move, loot, gather payout, craft start/completion, blueprint, build, destruction, death/corpse, raid transfer, admin grant | Group into a transaction at most 100 ms wide; send the confirming event only after commit |
| B: recoverable state | position, vitals, weather, AI travel, node timer | Flush dirty rows once per second; crash may rewind at most one second |
| C: cosmetic | particles, transient audio, camera recoil | Never persisted |

Death and corpse creation are one Class-A transaction: clear carried slots, create exactly one corpse, transfer stacks, mark dead and append the journal row atomically. The 5-minute autosave is a consistency checkpoint, not the only persistence path. On clean shutdown the host stops accepting commands, drains the current tick, commits, checkpoints WAL and exits. Backups retain daily copies for seven days plus the three newest clean-shutdown copies.

### 21.10 Failure behavior

| Failure | Required behavior |
|---|---|
| Client loses network | Freeze new intents, show reconnect overlay, attempt capped exponential reconnect for 60 s |
| Server process crashes | Supervisor restarts; load last committed journal state; never synthesize missing commands |
| Database write fails | Stop accepting state-changing commands, keep clients informed, retry once, then graceful shutdown |
| Tick overload | Defer nonresident AI and cosmetic events; never skip survival, movement, combat or persistence ordering |
| Invalid content | Refuse world start with exact file, id and validation rule |
| Protocol mismatch | Reject at handshake with server/client versions and update instruction |
| WebGL context lost | Pause rendering, preserve connection, restore assets or offer reload |

## 22. Multiplayer hosting and networking

### 22.1 DGX Spark deployment topology

The DGX Spark is an ARM64 Linux host with unified CPU/GPU memory. The players' browsers perform rendering; the Spark does not render game frames. The game host is CPU-only.

```text
Internet/LAN
    -> Caddy :443 HTTPS/WSS
        -> static client assets
        -> game-server :3000 (private Docker network)
            -> world SQLite volume

localhost only
    -> Qwen3.8-27B runtime :8000
        -> coding-agent process
            -> Rust-Web repository checkout
```

Caddy and the game server share only the game network. Qwen is not attached to that network, receives no public port and cannot mount the live save directory. The coding agent gets the repository mount, not `/`, not the user's entire home directory and not Docker's control socket.

### 22.2 Resource reservations

| Service | CPU | Memory ceiling | GPU | Notes |
|---|---:|---:|---|---|
| Game server | 4 cores reserved | 8 GiB | none | Launch population and AI; alert at 6 GiB |
| Caddy | 0.5 core | 256 MiB | none | TLS, static assets, WebSocket proxy |
| Qwen runtime | remaining compute | 80 GiB | GB10 | Development only; 64k context ceiling |
| OS/build/cache reserve | — | at least 24 GiB free | shared | Prevent unified-memory pressure |

These are safety envelopes, not claimed measured needs. M-1 records actual memory, tokens/s and game tick cost. Release performance must pass with Qwen stopped; development coexistence must pass a separate 30-minute gate without swap thrashing or tick misses.

### 22.3 Host model

Launch is self-hosted:

1. Diego starts the pinned Docker Compose release on the DGX Spark.
2. The host loads or creates a local world and prints the LAN address and configured public address.
3. Players open the client URL and enter the host address or a shared invite code.
4. The Spark runs the simulation, database and static client assets; each browser renders locally.

LAN works without external services. Internet play requires either router port forwarding for HTTPS/WebSocket traffic or a user-chosen tunnel/VPN such as Tailscale. A later release may add a relay, but launch must not require a paid relay or cloud account.

Use HTTPS/WSS for public play. Local development may use HTTP/WS. Public mode binds only Caddy; port 3000 and port 8000 stay private. The host has a configurable public hostname, port, max players, password hash, world slot, save interval, AI population, PvP flag and disconnect-body policy. Secrets are environment variables or Docker secrets and never committed.

### 22.4 Player identity and connection lifecycle

The game has no global account service. On first use, Web Crypto creates an ECDSA P-256 key pair and stores it in IndexedDB. The server stores only the public JWK. `PlayerId` is derived from SHA-256 of `serverId + canonical public key`. For login the server sends a 32-byte nonce and the client signs it with ECDSA/SHA-256; the server verifies the signature. The UI offers an explicit private-key recovery export with a prominent secrecy warning. Clearing browser storage without that recovery data creates a new identity.

Optional server passwords are transmitted only inside TLS, stored with Node `crypto.scrypt`, a unique 16-byte salt and constant-time comparison. After successful identity signature and password check, the server issues a 24-hour HMAC-SHA-256 session token scoped to server id, player id and session id. Tokens are revocable and never appear in URLs or logs.

Lifecycle: TLS → HTTP health/version → WebSocket upgrade → protocol/version hello → challenge → identity/password proof → rules acknowledgement → baseline chunks → baseline acknowledgement → Ready. Gameplay input received before Ready is rejected. Disconnect stops input, commits player state and applies the configured body policy. Reconnect within five minutes resumes the same session; a newer session invalidates the older socket.

### 22.5 Multiplayer rules

- No server pause in multiplayer.
- The host may kick, ban and shut down gracefully.
- Player-vs-player damage is on by default; a server setting may disable it for testing, never in a hidden way.
- Blueprints are per-player per-world, not global across servers.
- Server tick and world seed are never client-controlled.
- Chat is text-only at launch, rate-limited and server-filtered.

Default disconnect-body policy is **Sleeper**: the body remains in the world for 15 minutes and can be killed/looted, matching the persistent-risk design without leaving bodies forever. Graceful server shutdown does not create sleepers.

### 22.6 Network limits

| Boundary | Limit |
|---|---:|
| WebSocket handshake body | 16 KiB |
| Binary gameplay frame | 64 KiB |
| Commands accepted per player | 60/s burst, 30/s sustained |
| Inventory/craft/build commands | 10/s each, then throttle |
| Chat | 5 messages/10 s; 256 UTF-8 bytes/message |
| Invalid frames | disconnect after 5 within 60 s |
| Handshake timeout | 10 s |
| Baseline acknowledgement | 30 s |
| Heartbeat | every 5 s; timeout after 15 s |
| Reconnect attempts | exponential 1, 2, 4, 8, 15, 30 s |

## 23. Security, operations and moderation

The browser is an untrusted view. Validate every message with a schema and a maximum byte size. Rate-limit input, inventory moves, chat, interaction requests, build attempts and reconnects. Reject impossible movement, fire cadence, reach, line-of-sight, stack changes and duplicate sequence numbers.

Operational tooling: host console, structured logs, server health endpoint bound to localhost by default, tick-time metrics, player count, save age, database size, memory usage, active entity counts, rejected-command counters, and a graceful shutdown command. Never log passwords or full chat transcripts by default.

Moderation at launch is host-level: password, kick, ban by player id/IP where legal, whitelist option, chat mute and server shutdown. No global account moderation is implied.

### 23.1 Required HTTP security headers

Public responses set HSTS after HTTPS is verified, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a restrictive Permissions Policy and a Content Security Policy allowing only same-origin scripts/assets plus the minimum directive required for WebAssembly. No third-party analytics, ad script or CDN runtime is permitted in the MVP.

### 23.2 Administration

Admin commands run through `apps/admin-cli` over a Unix-domain socket or localhost loopback protected by a separate admin token. Admin capability is never inferred from player name or IP. Every kick, ban, item grant, teleport, save, shutdown and settings change is appended to an audit log. The public client contains no hidden admin password.

### 23.3 Supply-chain rules

Lockfile changes are reviewed as code. CI runs dependency audit, secret scan, TypeScript compile, unit tests, protocol fixtures, content validation and production build. Docker images are pinned by digest in release manifests, run as non-root, have read-only root filesystems where possible, and mount only explicit data directories. Qwen may propose dependency changes but may not add one without the task brief naming it or an ADR explaining it.

## 24. Data contracts and identifiers

Content is data-first. No gameplay tuning value may exist only as a code literal. Definitions are validated at startup and in CI.

Identifier families:

| Family | Format | Example |
|---|---|---|
| Item | category + snake_case | `weapon_repeater` |
| Recipe | `recipe_` + output id | `recipe_weapon_revolver` |
| Building/deployable | `build_` or `deploy_` | `build_wood_wall` |
| Loot table | `loot_`, `stock_`, `pocket_` | `loot_medical` |
| Creature | `animal_`, `crew_`, `warden_` | `animal_bear` |
| Region | `region_` | `region_pinewatch` |
| Blueprint | `bp_` + payload | `bp_repeater` |
| Entity | `e_` + lowercase hex | `e_01af` |
| Player | `p_` + stable hash | `p_3f9a0c21d4e78b56` |
| Evidence | fixed enum | `smoke`, `shot`, `corpse` |

Core contracts:

```ts
type ItemStack = { itemId: ItemId; quantity: number; payload?: BlueprintId };
type ClientEnvelope = { protocol: 1; sessionId: string; sequence: number; clientTick: number; commands: ClientCommand[] };
type Snapshot = { protocol: 1; serverTick: number; batchSequence: number; ackInputSequence: number; baselineId: number; records: ReplicaRecord[] };
type ReplicaRecord = SpawnRecord | DeltaRecord | EventRecord | ForgetRecord;
```

The wire schema is versioned and discriminated. Unknown fields may be ignored only when the schema marks them optional; unknown command and record kinds are rejected. Every command has one handler and one authorization test. A content validator checks ids, recipe references, stack sizes, station requirements, loot references, creature kits, building sockets and blueprint payloads. Numeric schema fields define finite bounds; `NaN`, infinity, negative quantities and unsafe integers are rejected.

## 25. Production roadmap

| Milestone | Outcome | Exit gate |
|---|---|---|
| M-1 | DGX Spark bootstrap, Qwen runtime evaluation, ARM64 dependency spike, two-client network/physics/SQLite proof | Hardware report and all M-1 gates pass; exact versions and model revision recorded |
| M0 | Web monorepo, dev server, client canvas, lint/test/CI, content schema | Clean install and browser loads a blank authenticated session |
| M1 | Shared sim loop, player movement, camera, replica codec | Two browser clients move in one authoritative world |
| M2 | Inventory, pickup, items, gathering and death corpse | Gather, move, die, loot and reconnect without duplication |
| M3 | Crafting, Campfire, Furnace, Workbench and blueprints | First-session arc reaches shelter, furnace and bow |
| M4 | Building grid, doors, storage, decay and sleeping bags | Two players build and breach the same test base |
| M5 | Survival, weather, radiation, wildlife and loot POIs | 60-minute day and radiation acceptance suite pass |
| M6 | Melee, bow, firearms, explosives, armor and combat feedback | Combat, lag compensation and breach tests pass |
| M7 | Outlaw bands, perception, evidence, raids and Wardens | AI can find a base only through emitted evidence |
| M8 | Full basin dressing, airdrops, settings, onboarding and optimization | 8-player 2-hour soak on the host machine |
| M9 | Public self-hosting, HTTPS/WSS, backups, admin console and release packaging | A remote browser joins through documented port forwarding |
| M10 | Stabilization and post-MVP scale probe | No critical save, duplication or authority defects in release candidate |

Each milestone has a written brief, data changes, tests, a vault log entry and a playable acceptance scenario. The vertical slice is complete at M6–M7; the full multiplayer MVP is M9.

## 26. Test plan and release gates

### Simulation tests

Pure tests cover: fixed time, day/night boundaries, survival drains, food and medicine, radiation rates, resource accumulators, stack merging, craft prerequisites, blueprint persistence, building occupancy/support, door HP, decay, damage formula, armor sums, falloff, hit zones, bow recovery, explosive splash, AI perception, raid feasibility, corpse completeness and migrations.

### Browser and server integration tests

Playwright tests cover: load → connect → move → interact → inventory → craft → build → disconnect → reconnect; two clients see the same confirmed door and item count; hostile commands fail; death creates one corpse; a remote client survives 10 minutes of snapshots without memory growth.

### Literal release scenarios

| Id | Pass condition |
|---|---|
| T01 | 30 ticks = 1 game second; 108,000 ticks = 24 game hours |
| T02 | Night true at 23:00:00 and 04:59:59; false at 22:59:59 and 05:00:00 |
| T03 | High core naked = 5.0 rads/s; 500 rads in 100 s |
| T04 | Extreme core full Rad Suit = 4.0 rads/s; 500 rads in 125 s |
| T05 | A Wood Door takes 500 HP; six Hand Grenades or one Charge breaches it |
| T06 | A Metal Wall requires four Explosive Charges under the authored rule |
| T07 | A death drops every carried/equipped item once and only once |
| T08 | Reconnect restores the saved player without duplicating inventory |
| T09 | A client cannot award itself health, items, blueprints, hits or position |
| T10 | A shot aimed at a four-tick-old target pose hits after rewind; current pose misses |
| T11 | AI cannot locate a hidden base without a matching evidence token |
| T12 | Eight clients plus AI sustain a two-hour soak with no tick overrun or save corruption |
| T13 | A remote browser joins the host through HTTPS/WSS and receives a baseline |
| T14 | Replaying the same seed and command log twice produces the same authoritative hash every 300 ticks |
| T15 | A slow client's queue never exceeds 4 MiB; it is disconnected with `BACKPRESSURE` after 10 s |
| T16 | Crash immediately after a death acknowledgement restores exactly one corpse and zero duplicated items |
| T17 | A schema migration failure leaves the original database byte-for-byte recoverable and refuses world start |
| T18 | Clearing browser storage creates a new identity; importing the recovery code restores the original identity |
| T19 | Malformed, oversized, NaN, stale and duplicate commands mutate no authoritative state |
| T20 | WebGL context loss restores the scene or presents a reload action without duplicating the player session |
| T21 | With Qwen stopped, the DGX Spark sustains the release soak and all resource targets |
| T22 | With Qwen running at the approved limit, a 30-minute coexistence soak has no swapping and no p99 tick above 33.3 ms |
| T23 | Qwen's bootstrap task edits a fixture branch, runs the required checks and produces a reviewable commit without touching files outside the checkout |

### Performance targets

Client: 60 fps at 1080p on a GTX 1060/RX 580-class desktop, 8 players, 14 active NPC humans and 8 animals. Server: 30 Hz with p95 tick under 20 ms, p99 under 30 ms and no sustained tick above the 33.3 ms budget; p95 snapshot encode under 8 ms; game-server RSS below 6 GiB; no unbounded growth over two hours. Network after baseline averages at most 32 KiB/s per client. Initial download target is under 25 MB compressed for the vertical slice and under 60 MB for the full MVP.

## 27. Risks and decisions

| Risk | Mitigation |
|---|---|
| WebGL cannot sustain a large 3D world | Small hand-authored basin, chunk streaming, instancing, aggressive LOD and a strict entity budget |
| Home-host NAT blocks friends | Document LAN, port forwarding and VPN/tunnel paths; add relay only later |
| Browser tabs sleep or lose pointer lock | Reconnect state, explicit focus handling, graceful disconnect and cosmetic prediction only |
| Self-hosted server exposes the home network | Bind localhost by default, explicit public opt-in, HTTPS/WSS, password, rate limits, no admin endpoint on public bind |
| AI becomes expensive | Resident bubbles, capped humans/animals, server bodies without renderers, measured soak tests |
| Qwen competes with the game for unified memory | Separate services and networks, 80 GiB model ceiling, 24 GiB system reserve, release benchmark with Qwen stopped |
| ARM64/native-addon incompatibility | Prefer TypeScript, WebAssembly and Node built-ins; M-1 tests every selected dependency on the Spark |
| Local model confidently invents missing requirements | Atomic task briefs, no placeholders, tests as literal acceptance, human/strong-model review before merge |
| Multiplayer desync | Shared engine-free sim package, authoritative events, snapshot baselines, invariant tests |
| Content scope expands | Preserve the Rust Legacy-shaped short ladder; all Later features require a written decision |
| Western reskin feels cosmetic | Make POIs, resources, weapons, audio, AI names and evidence vocabulary support the frontier fantasy |
| Copyright confusion | Original title, writing, assets, item names where practical, and no copied Rust files or branding |

### Locked launch decisions

| Id | Decision | Rejected alternative |
|---|---|---|
| D01 | Browser-first TypeScript/WebGL game | Unity/Unreal runtime |
| D02 | Multiplayer primary; self-hosted authoritative server | Offline-first release |
| D03 | 8 players at launch, protocol ceiling 16 | MMO population |
| D04 | 30 Hz simulation, 15 Hz snapshots | Client-authoritative movement |
| D05 | No thirst or stamina | Modern survival stat stack |
| D06 | No map/minimap by default | GPS-style navigation |
| D07 | 4 m snapped building grid, wood and metal tiers | Free-form voxel building |
| D08 | Blueprints persist through death | XP/skill tree |
| D09 | Death drops everything carried | Protected inventory |
| D10 | Outlaw bands replace some offline human pressure | Zombies or scripted raid calendar |
| D11 | Local SQLite saves with migrations and backups | Cloud-only persistence |
| D12 | No account/telemetry dependency at launch | Mandatory online services |
| D13 | Western Dustfall Basin setting | Direct Rust setting or copied island |
| D14 | No durability, vehicles, electricity or farming at launch | Feature-complete modern Rust clone |
| D15 | Qwen3.8-27B is development tooling only | LLM-driven runtime NPCs or mandatory inference |
| D16 | Node 24 LTS, Three.js WebGL2, deterministic Rapier, `ws`, MessagePack and SQLite are the locked baseline | Per-task framework selection |
| D17 | WebSocket MVP is reliable/ordered; stale snapshots are superseded before enqueue | Pretending WebSocket supports unreliable datagrams |
| D18 | DGX Spark is the primary Linux/ARM64 build and host target | Assuming x86-only development |

## 28. Handoff rules

1. Read this GDD and the latest vault work log before changing a system.
2. `packages/sim` remains engine-free and authoritative.
3. Intents carry inputs, never outcomes.
4. All tuning lives in content/config data with one owner.
5. Do not add an item, recipe, loot entry, AI state or building piece without a catalog id and test.
6. Never trust browser state; revalidate on the server.
7. Never show confirmed state before a replica event.
8. Keep save migrations and duplication tests in the same change as schema changes.
9. Prefer a small verified system over a broad untested feature.
10. Record each completed milestone and each design change in the vault.
11. Qwen receives one bounded task at a time with owned files, prerequisites, exact commands and literal pass/fail conditions.
12. Qwen never receives production passwords, the live save volume, the Docker socket or unrestricted filesystem access.
13. A Qwen change is incomplete until compile, lint, unit tests, content validation and the task-specific acceptance command all pass.
14. Any ambiguity becomes a written question or ADR; the agent must not silently choose a new framework, protocol, schema or gameplay value.

---

# Appendix A. Content catalog

The launch catalog is adapted from the Unity Frontier Legacy catalog and westernized through presentation, not by adding a second resource economy. Stable ids are retained where they are useful for migration and tests; new web content uses the same id conventions.

### Tools and light

Rock, Stone Hatchet, Hatchet, Pickaxe, Torch, Flashlight, Flare, Research Kit and Blood Draw Kit.

### Weapons

Hunting Bow, Hand Cannon, Pipe Shotgun, Revolver, 9mm Pistol, Semi-Auto Pistol, Submachine Gun, Pump Shotgun, Assault Rifle, Bolt-Action Rifle, Hand Grenade and Explosive Charge. Western presentation may label the Revolver as a Six-Shooter and the Assault Rifle as a Military Carbine in UI flavor text, but the mechanical id remains stable.

### Attachments

Flashlight Mod, Laser Sight, Holo Sight and Silencer.

### Ammunition

Arrow, Handmade Shell, 9mm Round, Rifle Round and Shotgun Shell.

### Armor

Cloth Helmet/Vest/Pants/Boots; Leather Helmet/Vest/Pants/Boots; Ballistic Helmet/Vest/Pants/Boots; Rad Suit Helmet/Vest/Pants/Boots.

### Medical, food and resources

Bandage, Small Medkit, Large Medkit, Anti-Radiation Pills; Raw Rabbit, Chicken, Venison, Pork, Wolf and Bear Meat; Cooked versions of each; Chocolate Bar, Granola Bar, Can of Beans, Can of Tuna, Relief Ration and Water Bottle; Wood, Stone, Metal Ore, Sulfur Ore, Metal Fragments, Sulfur, Charcoal, Cloth, Leather, Animal Fat, Blood, Low Grade Fuel, Gunpowder and Explosives.

### Building and deployables

Wood Foundation, Foundation Steps, Pillar, Wall, Doorway, Window, Ceiling, Stairs, Ramp, Wood Door, Metal Door, Metal Window Bars, Wood Shutter, Wood Shelter, Wood Gateway and Wood Gate; Campfire, Furnace, Workbench, Wood Storage Box, Large Wood Storage Box, Small Stash, Sleeping Bag, Bed, Wood Barricade, Spike Wall, Large Spike Wall and Crew Sign.

### Miscellaneous

Blueprint, Supply Signal, Calling Card, Cloth Strip and Note.

### Persistent blueprint payloads

Pickaxe; 9mm Pistol; Semi-Auto Pistol; Submachine Gun; Pump Shotgun; Assault Rifle; Bolt-Action Rifle; Rifle Round; Shotgun Shell; Hand Grenade; Explosive Charge; Explosives; Flare; all four attachments; all four Leather pieces; all four Ballistic pieces; all four Rad Suit pieces; Small Medkit; Large Medkit; Blood Draw Kit; Research Kit; Large Wood Storage Box; Metal Building.

# Appendix B. Recipes and economy

The full recipe table is data, not prose. The following is the launch economy spine; every row must exist in `packages/content` with input ids, quantities, output, craft time, station, blueprint requirement and by-products.

| Output | Inputs | Station | Time |
|---|---|---|---:|
| Stone Hatchet | Wood + Stone + Cloth | Hand | 5 s |
| Hatchet | Wood + Metal Fragments | Hand | 8 s |
| Pickaxe | Wood + Metal Fragments + Stone | Workbench / BP | 12 s |
| Arrow ×2 | Wood + Stone | Hand | 1 s |
| Handmade Shell ×4 | Stone + Gunpowder | Hand | 2 s |
| 9mm Round ×8 | Metal Fragments + Gunpowder | Hand | 3 s |
| Rifle Round ×4 | Metal Fragments + Gunpowder | Workbench / BP | 4 s |
| Shotgun Shell ×4 | Metal Fragments + Gunpowder | Workbench / BP | 4 s |
| Bandage | Cloth | Hand | 2 s |
| Low Grade Fuel ×4 | Animal Fat ×2 + Cloth | Hand | 3 s |
| Gunpowder ×2 | Charcoal ×2 + Sulfur ×2 | Hand | 3 s |
| Campfire | Wood + Stone | Hand | 5 s |
| Furnace | Stone + Wood | Hand | 12 s |
| Workbench | Wood + Stone + Metal Fragments | Hand | 15 s |
| Sleeping Bag | Cloth | Hand | 8 s |
| Wood Storage Box | Wood | Hand | 6 s |
| Wood Shelter | Wood | Hand | 5 s |
| Wood Foundation / Wall | Wood | Hand | 2 s |
| Wood Door | Wood | Hand | 4 s |
| Metal Door | Metal Fragments | Workbench | 8 s |
| Small Medkit | Blood + Cloth + Metal Fragments | Workbench / BP | 8 s |
| Large Medkit | Blood + Cloth + Metal Fragments | Workbench / BP | 12 s |
| Explosive Charge | Explosives + Cloth + Low Grade Fuel | Workbench / BP | 20 s |

Furnace conversions: Metal Ore → Metal Fragments; Sulfur Ore → Sulfur; Cloth → Leather; Wood → Charcoal. Campfire conversions: raw meat → cooked meat and Wood → Charcoal. Fuel is consumed over time and never makes smelting faster than the authored furnace rate.

# Appendix C. Building catalog

| Tier | HP | Breach rule | Decay |
|---|---:|---|---:|
| Wood Door | 500 | 200 Hatchet hits, 6 grenades, 1 Charge | 7 days |
| Metal Door | 1000 | 2 Charges | 14 days |
| Wood Wall | 1000 | 2 Charges | 7 days |
| Metal Wall | 2000 | 4 Charges | 14 days |
| Foundation/Pillar/Ceiling | immune | Decay only | 7/14 days |
| Wood Shelter | 500 | 1 Charge | 3 days |
| Wood Barricade | 250 | Melee | 3 days |
| Spike Wall | 300 | Melee/explosive | 5 days |

Sockets are deterministic: foundation centers and corners, wall spans between pillars, doorways accept door entities, windows accept shutters/bars, ceilings require four supports, and higher floors may not exceed the authored height cap. Stability is local and testable; no unsupported piece may be placed merely because the client ghost looked valid.

# Appendix D. Loot tables

| Table | Contents focus | Location |
|---|---|---|
| `loot_wooden_crate` | Wood, stone, cloth, basic tools, food | Roads, cabins, ruins |
| `loot_barrel` | Low-grade fuel, food, cloth, fragments | Rail and road |
| `loot_ammo` | Ammunition, gunpowder, occasional weapon BP | Rail, Hangar/Depot |
| `loot_medical` | Bandages, pills, medkits, Rad Suit pieces | Medical POIs |
| `loot_weapon` | Weapons, attachments, armor, BP items | Fort outskirts, high danger |
| `loot_supply_drop` | Explosives, rifles, ballistic armor, rations | Airdrops |
| `stock_t1` | Band, bow, stone tools, cloth, food | Outlaw T1 base |
| `stock_t2` | Pistols, Leather, grenades, fragments | Outlaw T2 base |
| `stock_t3` | Rifle parts, charges, ballistic gear | Outlaw T3 base |
| `pocket_<archetype>` | Archetype kit and carried loot | Human corpses |

Loot rolls are seeded from world seed, container id and refill sequence. A player opening a container never receives a client-generated roll.

# Appendix E. Creatures and human archetypes

| Entity | HP | Role | Primary threat |
|---|---:|---|---|
| Rabbit | 30 | prey | flees |
| Chicken | 25 | prey | flees |
| Deer | 80 | prey | flees |
| Boar | 120 | neutral | charges when cornered |
| Wolf | 100 | hostile | pack bite |
| Bear | 250 | hostile | heavy bite |
| Red Wolf | 130 | irradiated hostile | stronger pack bite |
| Red Bear | 300 | irradiated hostile | stronger heavy bite |
| Forager | 100 | gatherer/looter/scout | bow, hatchet |
| Hunter | 100 | ranged/tracker | bow, shotgun or pistol |
| Bruiser | 100 | point man/door breaker | hatchet or shotgun |
| Sapper | 100 | explosives | grenades and charges |
| Marksman | 100 | overwatch | bolt-action rifle |
| Chief | 100 | leader | best band weapon |
| Warden Guard | 100 | fort defender | submachine gun |
| Warden Marksman | 100 | tower defender | bolt-action rifle |
| Warden Captain | 100 | fort leader | assault rifle |

Outlaw roster sizes: T0 2–3, T1 2–4, T2 3–5, T3 4–6. Raid parties: Tier 1 2–3, Tier 2 3–4, Tier 3 4–6. The same content definitions drive player and NPC weapons.

# Appendix F. Tuning constants

All values are starting points. Each has a stable key and a single data owner.

| Key | Value |
|---|---:|
| `time.tick_hz` | 30 |
| `time.day_seconds` | 3600 |
| `time.daylight_seconds` | 2700 |
| `time.night_seconds` | 900 |
| `survival.max_health` | 100 |
| `survival.max_calories` | 3000 |
| `survival.max_radiation` | 500 |
| `survival.bleed_damage_per_second` | 2.0 |
| `move.walk_speed` | 3.5 |
| `move.sprint_speed` | 5.5 |
| `move.crouch_speed` | 1.8 |
| `move.melee_reach` | 1.5 m |
| `build.grid_size` | 4 m |
| `build.max_height_levels` | 6 |
| `loot.ground_pickup_radius` | 1.5 m |
| `loot.max_ground_stacks` | 400 |
| `ai.max_humans` | 14 |
| `ai.max_animals` | 8 |
| `ai.evidence_memory_seconds` | 30 |
| `raid.max_loot_seconds` | 480 |
| `raid.stage_line_distance` | 80 m |
| `raid.approach_distance` | 1.5 m |

# Appendix G. Save schema

```ts
type WorldSave = {
  schemaVersion: number;
  worldId: string;
  seed: string;
  serverSettings: ServerSettings;
  clock: { tick: number; gameSeconds: number; weather: string; weatherSeed: number };
  players: PlayerSave[];
  entities: EntitySave[];
  crews: CrewSave[];
  lootState: LootState[];
  migrationsApplied: string[];
  lastSavedAt: string;
};

type PlayerSave = {
  playerId: string;
  blueprints: string[];
  inventory: ItemStack[];
  equipment: ItemStack[];
  position: Vec3;
  vitals: Vitals;
  lastSeenTick: number;
};
```

Save migrations are pure functions `vN → vN+1`, tested with fixtures from every released schema. Inventory transactions include an idempotency key. A duplicate transaction id returns the original result rather than applying again.

# Appendix H. Glossary

**Authority:** the server's right to decide a state change.  
**Blueprint:** a recipe unlock that survives death.  
**Cold deficit:** environmental cold pressure minus worn warmth.  
**Evidence token:** a position-tagged sound, light, smoke, combat or activity record available to AI.  
**Heat:** a band's grudge score toward a player.  
**Interest radius:** the area whose entities a player receives in the replica.  
**Legacy fidelity:** the deliberate focus on scarcity, short progression, landmark navigation, permanent loss and readable combat rather than modern feature breadth.  
**Outlaw band:** a generated hostile human crew with a base, roster, stage and beliefs.  
**Replica:** the client's read-only copy of authoritative state.  
**Resident bubble:** the radius within which AI bodies are instantiated and simulated.  
**Threat:** the score derived from player wealth, gear and survival time that caps raid strength.  
**World slot:** one independent persistent SQLite save owned by the host.
