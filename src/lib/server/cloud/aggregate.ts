import { sql } from 'drizzle-orm';
import { db } from '../db';
import type { CloudWord } from '$lib/types/cloud';

/**
 * Считает топ-N слов по нормализованной форме для опроса.
 *
 * Старая реализация вытягивала `topN * 5` строк, сгруппированных по паре
 * (word, wordNorm), и схлопывала в JS — это сжигало память и сеть на
 * длинных хвостах. Новый запрос делает агрегацию в Postgres за один
 * проход:
 *   1. CTE `agg` суммирует count по wordNorm.
 *   2. CTE `picked` выбирает «канонический» word для каждой нормы
 *      (самый частый исходный вариант — DISTINCT ON + ORDER BY count DESC).
 *   3. SELECT соединяет их, режет до topN, сортирует по убыванию.
 *
 * Возвращаем `[displayWord, totalCount]` — формат, ожидаемый рендером.
 */
export async function aggregateQuestion(
  questionId: string,
  topN: number = 100
): Promise<CloudWord[]> {
  const rows = await db.execute<{ word: string; total: number }>(sql`
    WITH agg AS (
      SELECT word_norm, count(*)::int AS total
      FROM responses
      WHERE question_id = ${questionId}
      GROUP BY word_norm
      ORDER BY total DESC
      LIMIT ${topN}
    ),
    display AS (
      SELECT word_norm, word,
             ROW_NUMBER() OVER (
               PARTITION BY word_norm
               ORDER BY count(*) DESC, word ASC
             ) AS rn
      FROM responses
      WHERE question_id = ${questionId}
        AND word_norm IN (SELECT word_norm FROM agg)
      GROUP BY word_norm, word
    )
    SELECT d.word, a.total
    FROM agg a
    JOIN display d ON d.word_norm = a.word_norm AND d.rn = 1
    ORDER BY a.total DESC
  `);

  // postgres-js возвращает rows напрямую, drizzle-orm execute оборачивает.
  // Учитываем оба варианта.
  const list =
    (rows as unknown as { rows?: Array<{ word: string; total: number }> }).rows ??
    (rows as unknown as Array<{ word: string; total: number }>);

  return list.map((r) => [r.word, Number(r.total)] as CloudWord);
}
