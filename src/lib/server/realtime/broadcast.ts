import type { WebSocket } from 'ws';
import { redis } from '../redis';
import { encode, type ServerMsg } from './protocol';
import { incWsConnected, decWsConnected } from '../metrics';
import type { CloudWord, SurveyStatus } from '$lib/types/cloud';

const TICK_MS = 2500;
const TOP_N = 50;

type Room = {
  code: string;
  questionIds: string[];
  subscribers: Set<WebSocket>;
  lastTop: Map<string, string>;
};

const rooms = new Map<string, Room>();
let tickerHandle: NodeJS.Timeout | null = null;

async function fetchTop(questionId: string): Promise<CloudWord[]> {
  const raw = await redis.zrevrange(`cloud:${questionId}`, 0, TOP_N - 1, 'WITHSCORES');
  const out: CloudWord[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const word = raw[i];
    const count = Number.parseInt(raw[i + 1], 10);
    if (Number.isFinite(count) && count > 0) out.push([word, count]);
  }
  return out;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(encode(msg));
}

export function getRoom(code: string, questionIds: string[]): Room {
  let room = rooms.get(code);
  if (!room) {
    room = {
      code,
      questionIds,
      subscribers: new Set(),
      lastTop: new Map()
    };
    rooms.set(code, room);
  } else {
    room.questionIds = questionIds;
  }
  return room;
}

export async function addSubscriber(room: Room, ws: WebSocket): Promise<void> {
  room.subscribers.add(ws);
  incWsConnected();
  ensureTicker();
  for (const qid of room.questionIds) {
    const words = await fetchTop(qid);
    send(ws, { type: 'snapshot', questionId: qid, words });
    room.lastTop.set(qid, JSON.stringify(words));
  }
}

export function removeSubscriber(room: Room, ws: WebSocket): void {
  if (room.subscribers.delete(ws)) {
    decWsConnected();
  }
  if (room.subscribers.size === 0) {
    rooms.delete(room.code);
  }
}

export function notifyClosed(code: string, reason: 'expired' | 'sent' | 'failed'): void {
  const room = rooms.get(code);
  if (!room) return;
  for (const ws of room.subscribers) {
    send(ws, { type: 'closed', reason });
    if (ws.readyState === ws.OPEN) ws.close(1000, reason);
    decWsConnected();
  }
  rooms.delete(code);
}

// ───────────────────────────────────────────────────────────
// Per-user push: для /my (страница со списком опросов).
//
// Раньше /my узнавал об изменении статуса (active→sent) только на
// следующем 30-сек polling-цикле. Это давало ощущение «зависшего»
// статуса «Истёк» даже после того, как письмо уже ушло.
//
// Теперь каждый авторизованный клиент `/ws/u` подписывается на
// канал `userChannels[userId]`, а `processExpired` / `/finish` /
// `/retry` пушат `survey-status` сразу после фактической смены
// статуса в БД.
// ───────────────────────────────────────────────────────────

const userChannels = new Map<string, Set<WebSocket>>();

export function addUserSubscriber(userId: string, ws: WebSocket): void {
  let set = userChannels.get(userId);
  if (!set) {
    set = new Set();
    userChannels.set(userId, set);
  }
  set.add(ws);
  incWsConnected();
}

export function removeUserSubscriber(userId: string, ws: WebSocket): void {
  const set = userChannels.get(userId);
  if (!set) return;
  if (set.delete(ws)) {
    decWsConnected();
  }
  if (set.size === 0) userChannels.delete(userId);
}

export function notifyUserSurveyStatus(
  userId: string | null | undefined,
  code: string,
  status: SurveyStatus
): void {
  if (!userId) return;
  const set = userChannels.get(userId);
  if (!set) return;
  const msg = encode({ type: 'survey-status', code, status });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function ensureTicker(): void {
  if (tickerHandle) return;
  tickerHandle = setInterval(() => {
    void tick();
  }, TICK_MS);
}

async function tick(): Promise<void> {
  for (const room of rooms.values()) {
    if (room.subscribers.size === 0) continue;
    for (const qid of room.questionIds) {
      const words = await fetchTop(qid);
      const serialized = JSON.stringify(words);
      if (serialized === room.lastTop.get(qid)) continue;
      const msg = encode({ type: 'snapshot', questionId: qid, words });
      for (const ws of room.subscribers) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
      }
      room.lastTop.set(qid, serialized);
    }
  }
}
