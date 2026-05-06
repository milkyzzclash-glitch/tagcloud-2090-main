import { eq } from 'drizzle-orm';
import { db } from '../db';
import { questions } from '../schema';
import { aggregateQuestion } from '../cloud/aggregate';
import { CSV_BOM, csvEscape } from './csv-escape';

export async function buildSurveyCsv(surveyId: string): Promise<string> {
  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.surveyId, surveyId))
    .orderBy(questions.position);

  // Параллельный fan-out по вопросам: для опроса с 30+ вопросами это
  // заметно ускоряет экспорт (был последовательный round-trip на каждый
  // вопрос). Порядок сохраняем через индекс в map+await.
  const aggregates = await Promise.all(qs.map((q) => aggregateQuestion(q.id, 1000)));

  // Заголовки на русском — основные пользователи опросов читают CSV
  // в Excel/Numbers с русской локалью; «question/word/count» вызывали
  // вопросы у нетехнических создателей опросов.
  const rows: string[] = ['вопрос,ответ,количество ответов'];
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const top = aggregates[i];
    if (top.length === 0) {
      rows.push([csvEscape(q.text), '', '0'].join(','));
      continue;
    }
    for (const [word, count] of top) {
      rows.push([csvEscape(q.text), csvEscape(word), String(count)].join(','));
    }
  }
  return CSV_BOM + rows.join('\n');
}
