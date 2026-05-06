import { randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users } from '../schema';

export const COOKIE_NAME = 'tagcloud_session';
export const SESSION_TTL_DAYS = 30;

export type AuthUser = { id: string; email: string };

function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

export async function getSessionUser(
  sessionId: string | undefined | null
): Promise<AuthUser | null> {
  if (!sessionId) return null;
  const rows = await db
    .select({ id: users.id, email: users.email, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (rows.length === 0) return null;
  return { id: rows[0].id, email: rows[0].email };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function purgeExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return deleted.length;
}
