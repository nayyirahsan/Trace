import { nanoid } from 'nanoid';
import type { SessionData } from './types';

export async function saveSession(db: D1Database, data: SessionData): Promise<string> {
  const id = nanoid(10);
  await db
    .prepare('INSERT INTO sessions (id, data, created_at) VALUES (?, ?, ?)')
    .bind(id, JSON.stringify(data), Date.now())
    .run();
  return id;
}

export async function getSession(db: D1Database, id: string): Promise<SessionData | null> {
  const row = await db
    .prepare('SELECT data FROM sessions WHERE id = ?')
    .bind(id)
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as SessionData) : null;
}
