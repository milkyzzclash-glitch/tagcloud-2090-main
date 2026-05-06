import { createHash, randomBytes } from 'node:crypto';
import { redis } from '../redis';

const SALT_TTL_SEC = 48 * 60 * 60;
const RATE_WINDOW_SEC = 60;
const RATE_MAX = 30;
const MIN_VOTED_TTL_SEC = 60;

// Auth-эндпоинты — отдельные более жёсткие бакеты, чтобы перебор пароля
// не попадал в общий "30 запросов/мин" бюджет голосовалок.
const AUTH_WINDOW_SEC = 15 * 60;
const AUTH_IP_MAX = 30; // 30 попыток с одного IP за 15 минут
const AUTH_EMAIL_MAX = 5; // 5 попыток на конкретный email за 15 минут

// WebSocket upgrade — отдельный бакет: легитимный клиент открывает
// 1 WS на дашборд, реконнект-петля 3с. 60 апгрейдов/мин с одного IP
// многократный запас, защита от бот-перебора creatorToken через
// массовые reconnect'ы.
const WS_WINDOW_SEC = 60;
const WS_MAX = 60;

function todaySaltKey(): string {
  const d = new Date();
  return `salt:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function getOrCreateSalt(): Promise<string> {
  const key = todaySaltKey();
  const existing = await redis.get(key);
  if (existing) return existing;
  const salt = randomBytes(32).toString('hex');
  await redis.setex(key, SALT_TTL_SEC, salt);
  return salt;
}

async function ipHash(ip: string): Promise<string> {
  const salt = await getOrCreateSalt();
  return createHash('sha256').update(`${ip}:${salt}`).digest('hex');
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const hash = await ipHash(ip);
  const key = `rl:${hash}`;
  const cnt = await redis.incr(key);
  if (cnt === 1) await redis.expire(key, RATE_WINDOW_SEC);
  if (cnt > RATE_MAX) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSec: ttl > 0 ? ttl : RATE_WINDOW_SEC };
  }
  return { allowed: true };
}

export async function hasVoted(ip: string, code: string): Promise<boolean> {
  const hash = await ipHash(ip);
  return (await redis.exists(`voted:${hash}:${code}`)) === 1;
}

export async function markVoted(ip: string, code: string, expiresAt: Date): Promise<void> {
  const hash = await ipHash(ip);
  const ttlSec = Math.max(MIN_VOTED_TTL_SEC, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  await redis.setex(`voted:${hash}:${code}`, ttlSec, '1');
}

/**
 * Рейт-лимит для auth-эндпоинтов (`/api/auth/login`, `/register`).
 * Считаем два независимых бакета и блокируем, если превышен любой из них:
 *   - по IP (защита от brute-force с одного хоста);
 *   - по email (защита от перебора пароля для конкретного аккаунта,
 *     даже если идёт с пула IP).
 *
 * Email нормализуется (`trim().toLowerCase()`) и хэшируется тем же
 * salted-sha256, чтобы Redis не хранил адреса в открытом виде.
 */
export async function checkAuthRateLimit(ip: string, email: string): Promise<RateLimitResult> {
  const ipKey = `auth_rl:ip:${await ipHash(ip)}`;
  const emailKey = `auth_rl:email:${await emailHash(email)}`;

  // INCR-ы выполняем последовательно, но без транзакции: гонка может пропустить
  // 1–2 попытки сверх лимита, для защиты от перебора это не существенно.
  const ipCnt = await redis.incr(ipKey);
  if (ipCnt === 1) await redis.expire(ipKey, AUTH_WINDOW_SEC);

  const emailCnt = await redis.incr(emailKey);
  if (emailCnt === 1) await redis.expire(emailKey, AUTH_WINDOW_SEC);

  if (ipCnt > AUTH_IP_MAX || emailCnt > AUTH_EMAIL_MAX) {
    const [ipTtl, emailTtl] = await Promise.all([redis.ttl(ipKey), redis.ttl(emailKey)]);
    const retryAfterSec = Math.max(ipTtl, emailTtl, 60);
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true };
}

async function emailHash(email: string): Promise<string> {
  const salt = await getOrCreateSalt();
  return createHash('sha256').update(`email:${email.trim().toLowerCase()}:${salt}`).digest('hex');
}

/**
 * Лимит WebSocket-апгрейдов с одного IP. Защищает от bot-perebora
 * creatorToken через массовые reconnect'ы. На WS-handshake обычный
 * rate-limit не работает — там нет SvelteKit-обёртки.
 */
export async function checkWsRateLimit(ip: string): Promise<RateLimitResult> {
  const key = `ws_rl:${await ipHash(ip)}`;
  const cnt = await redis.incr(key);
  if (cnt === 1) await redis.expire(key, WS_WINDOW_SEC);
  if (cnt > WS_MAX) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSec: ttl > 0 ? ttl : WS_WINDOW_SEC };
  }
  return { allowed: true };
}
