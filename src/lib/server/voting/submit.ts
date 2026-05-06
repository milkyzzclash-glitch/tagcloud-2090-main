import { db } from '../db';
import { responses } from '../schema';
import { redis } from '../redis';
import { log } from '../log';
import { incVotesAccepted, incVotesFlushed, setVotesPending } from '../metrics';
import type { ProcessedAnswer } from './validate';

type QueueItem = {
  questionId: string;
  word: string;
  wordNorm: string;
};

const FLUSH_INTERVAL_MS = 200;
const FLUSH_THRESHOLD = 100;
// Жёсткий потолок in-memory очереди. Если БД/Redis лежат и flush'и
// возвращают batch обратно, без потолка буфер растёт линейно с RPS до
// OOM. 100k items × ~100 байт = ~10 МБ — переживаемо, в 100 раз больше
// FLUSH_THRESHOLD; превышение → сервис отдаёт 503 в `/answer`, чтобы
// клиент попробовал позже, пока не дренируется очередь.
const MAX_BUFFER_SIZE = 100_000;
// Fallback-TTL для агрегатов в Redis (`cloud:${questionId}`).
// Первичная очистка — в `expiry/process.ts` после отправки email; этот TTL
// нужен только чтобы данные не висели вечно, если процесс завершения не дошёл
// до DEL (упал, был убит, опрос «застрял» в expired). 7 дней покрывает любой
// разумный срок жизни опроса (UI ограничивает создание `expires_at` ближайшим
// будущим, и cron форсит закрытие через ~5 мин после истечения).
const CLOUD_KEY_TTL_SEC = 7 * 24 * 60 * 60;

const buffer: QueueItem[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing = false;

async function flush(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    await db.insert(responses).values(batch);
    const pipeline = redis.pipeline();
    // Дедуплицируем questionId, чтобы EXPIRE вызывался один раз на ключ за
    // батч — это всё равно «sliding» TTL: каждый flush обновляет срок жизни.
    const seenKeys = new Set<string>();
    for (const item of batch) {
      const key = `cloud:${item.questionId}`;
      pipeline.zincrby(key, 1, item.wordNorm);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        pipeline.expire(key, CLOUD_KEY_TTL_SEC);
      }
    }
    await pipeline.exec();
    incVotesFlushed(batch.length, 'ok');
  } catch (err) {
    // Возвращаем неотданный пакет в начало буфера, чтобы повторить попытку
    // на следующем тике — иначе голоса терялись бы при первой ошибке БД/Redis.
    buffer.unshift(...batch);
    incVotesFlushed(batch.length, 'failed');
    log.error('voting_flush_failed', { batchSize: batch.length, err: String(err) });
  } finally {
    setVotesPending(buffer.length);
    flushing = false;
  }
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    await flush();
    if (buffer.length > 0) scheduleFlush();
  }, FLUSH_INTERVAL_MS);
}

export type SubmitResult = { ok: true; accepted: number } | { ok: false; code: 'overloaded' };

/**
 * Кладёт обработанные ответы в in-memory буфер. Если буфер переполнен
 * (БД/Redis недоступны и flush'и возвращают batch обратно), отдаёт
 * `{ ok: false, code: 'overloaded' }` — вызывающий должен вернуть HTTP
 * 503 с Retry-After. Это защищает от OOM при затяжных авариях нижнего
 * стека: голос не теряется ради корректности, клиент ретраится.
 */
export async function submitAnswers(processed: ProcessedAnswer[]): Promise<SubmitResult> {
  let toAdd = 0;
  for (const answer of processed) toAdd += answer.words.length;

  if (buffer.length + toAdd > MAX_BUFFER_SIZE) {
    log.warn('voting_buffer_overflow', { pending: buffer.length, attempted: toAdd });
    return { ok: false, code: 'overloaded' };
  }

  let added = 0;
  for (const answer of processed) {
    for (let i = 0; i < answer.words.length; i++) {
      buffer.push({
        questionId: answer.questionId,
        word: answer.words[i],
        wordNorm: answer.normalized[i]
      });
      added++;
    }
  }
  if (added > 0) {
    incVotesAccepted(added);
    setVotesPending(buffer.length);
  }
  if (buffer.length >= FLUSH_THRESHOLD) {
    await flush();
  } else {
    scheduleFlush();
  }
  return { ok: true, accepted: added };
}

/**
 * Дренирует in-memory очередь. Используется обработчиком сигналов
 * остановки процесса в `hooks.server.ts`, чтобы не терять голоса при
 * graceful shutdown (SIGTERM/SIGINT).
 */
export async function flushPending(): Promise<void> {
  // Несколько попыток на случай, если первая упадёт и положит batch обратно.
  for (let i = 0; i < 3 && buffer.length > 0; i++) {
    await flush();
  }
}

export function pendingCount(): number {
  return buffer.length;
}
