/**
 * Host configuration (GDD §22.3). Defaults are local-development.
 * Public mode binds only Caddy; port 3000 stays private.
 */
export interface ServerConfig {
  host: string;
  port: number;
  worldSlot: string;
  maxPlayers: number;
  /** password hash; undefined = no password */
  passwordHash?: string;
  pvpEnabled: boolean;
  dataDir: string;
}

export const DEFAULT_CONFIG: ServerConfig = {
  host: "0.0.0.0",
  port: 3000,
  worldSlot: "default",
  maxPlayers: 8,
  pvpEnabled: true,
  dataDir: "data",
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => ({
  ...DEFAULT_CONFIG,
  port: env.DUSTFALL_PORT ? Number(env.DUSTFALL_PORT) : DEFAULT_CONFIG.port,
  worldSlot: env.DUSTFALL_WORLD_SLOT ?? DEFAULT_CONFIG.worldSlot,
  maxPlayers: env.DUSTFALL_MAX_PLAYERS ? Number(env.DUSTFALL_MAX_PLAYERS) : DEFAULT_CONFIG.maxPlayers,
  dataDir: env.DUSTFALL_DATA_DIR ?? DEFAULT_CONFIG.dataDir,
});
