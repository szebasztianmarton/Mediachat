export type ServiceStatus = "online" | "offline" | "checking";
export type UserRole = "admin" | "user";

// ── Authentication ──────────────────────────────────────────────────────────

export interface AuthData {
  token: string;
  userId: string;
  username: string;
  role: UserRole;
}

// ── User management (backend API) ────────────────────────────────────────────

export interface ApiUser {
  id: string;
  username: string | null;
  display_name: string;
  role: UserRole;
  created_at: string | null;
}

// ── Service health ───────────────────────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  key: string;
  status: ServiceStatus;
  latency?: number;
  error?: string;
}

// ── App settings ─────────────────────────────────────────────────────────────

export type TorrentClient = "qbittorrent" | "transmission";
export type TruenasAuthMode = "apikey" | "credentials";

export interface AppSettings {
  // Sonarr
  sonarrEnabled: boolean;
  sonarrUrl: string;
  sonarrApiKey: string;
  // Radarr
  radarrEnabled: boolean;
  radarrUrl: string;
  radarrApiKey: string;
  // Ollama
  ollamaEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  // TMDB
  tmdbEnabled: boolean;
  tmdbApiKey: string;
  // Trakt
  traktEnabled: boolean;
  traktClientId: string;
  traktClientSecret: string;
  // Telegram
  telegramEnabled: boolean;
  telegramBotToken: string;
  // Discord
  discordEnabled: boolean;
  discordBotToken: string;
  // TrueNAS
  truenasEnabled: boolean;
  truenasUrl: string;
  truenasAuthMode: TruenasAuthMode;
  truenasApiKey: string;
  truenasUsername: string;
  truenasPassword: string;
  // Torrent client
  torrentEnabled: boolean;
  torrentClient: TorrentClient;
  torrentUrl: string;
  torrentUsername: string;
  torrentPassword: string;
  // Plex
  plexEnabled: boolean;
  plexUrl: string;
  plexToken: string;
  // Jellyfin
  jellyfinEnabled: boolean;
  jellyfinUrl: string;
  jellyfinApiKey: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sonarrEnabled: true,
  sonarrUrl: "",
  sonarrApiKey: "",
  radarrEnabled: true,
  radarrUrl: "",
  radarrApiKey: "",
  ollamaEnabled: true,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2:3b",
  tmdbEnabled: true,
  tmdbApiKey: "",
  traktEnabled: false,
  traktClientId: "",
  traktClientSecret: "",
  telegramEnabled: false,
  telegramBotToken: "",
  discordEnabled: false,
  discordBotToken: "",
  truenasEnabled: false,
  truenasUrl: "",
  truenasAuthMode: "apikey",
  truenasApiKey: "",
  truenasUsername: "",
  truenasPassword: "",
  torrentEnabled: false,
  torrentClient: "qbittorrent",
  torrentUrl: "",
  torrentUsername: "",
  torrentPassword: "",
  plexEnabled: false,
  plexUrl: "",
  plexToken: "",
  jellyfinEnabled: false,
  jellyfinUrl: "",
  jellyfinApiKey: "",
};

export const SETTINGS_KEY = "mediachat-settings";
export const AUTH_KEY = "mediachat-auth";
