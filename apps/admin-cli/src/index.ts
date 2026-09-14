#!/usr/bin/env tsx
/**
 * Localhost-only host administration (GDD §23.2).
 * M0: health/status. Kick/ban/grant arrive with the admin socket in M9.
 * Admin capability is never inferred from player name or IP.
 */
export {};
const arg = process.argv[2] ?? "help";
const port = Number(process.env.DUSTFALL_PORT ?? 3000);

switch (arg) {
  case "help":
    console.log("dustfall-admin: help | status | save (later milestones)");
    break;
  case "status": {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    console.log(JSON.stringify(await res.json(), null, 2));
    break;
  }
  default:
    console.error(`unknown admin command: ${arg}`);
    process.exit(1);
}
