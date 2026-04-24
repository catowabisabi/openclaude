import { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_allowed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  working_directory TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TEXT,
  is_expired INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS tool_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT,
  tool_output TEXT,
  success INTEGER,
  duration_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS pending_approvals (
  prompt_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  question TEXT,
  action_type TEXT,
  working_directory TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cost_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_id TEXT,
  cost_usd REAL NOT NULL,
  model TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  payload TEXT,
  signature TEXT,
  processed INTEGER DEFAULT 0,
  processed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_threads (
  chat_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  project_path TEXT NOT NULL,
  last_sync_at TEXT,
  PRIMARY KEY (chat_id, topic_id)
);
`;

export class TelegramDatabase {
  private db: Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.db.run(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  run(sql: string, ...params: unknown[]): void {
    this.db.run(sql, ...params);
  }

  query<T>(sql: string, ...params: unknown[]): T[] {
    const stmt = this.db.query(sql);
    return stmt.all(...params) as T[];
  }

  queryOne<T>(sql: string, ...params: unknown[]): T | null {
    const stmt = this.db.query(sql);
    return stmt.get(...params) as T | null ?? null;
  }
}

let _instance: TelegramDatabase | null = null;

export function getDatabase(dbPath?: string): TelegramDatabase {
  if (!_instance) {
    _instance = new TelegramDatabase(dbPath);
  }
  return _instance;
}

export function resetDatabase(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}