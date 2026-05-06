import { eq } from 'drizzle-orm';
import { db } from '../db';
import { surveys, questions, type Survey } from '../schema';
import { aggregateQuestion } from '../cloud/aggregate';
import { renderPng } from '../cloud/render-png';
import { buildSurveyCsv } from '../export/csv';
import { sendResultsEmail, type EmailAttachment } from '../email/send';
import { getLogoPng } from '../email/logo';
import { notifyClosed, notifyUserSurveyStatus } from '../realtime/broadcast';
import { redis } from '../redis';
import { log } from '../log';

/**
 * Удаляет агрегаты `cloud:${questionId}` из Redis. Вызывается ПОСЛЕ
 * успешной отправки email — иначе при повторной попытке `processExpired`
 * (recovery-ветка cron) топ-слова пришли бы пустыми.
 */
async function cleanupCloudKeys(questionIds: string[]): Promise<void> {
  if (questionIds.length === 0) return;
  try {
    const keys = questionIds.map((id) => `cloud:${id}`);
    await redis.del(...keys);
  } catch (err) {
    // Не критично — TTL в submit.ts (7 дней) подметёт ключи, если DEL не прошёл.
    log.error('expiry_cleanup_failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

export async function processExpired(survey: Survey): Promise<void> {
  log.info('expiry_processing', { surveyCode: survey.code });
  let questionIds: string[] = [];
  try {
    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.surveyId, survey.id))
      .orderBy(questions.position);
    questionIds = qs.map((q) => q.id);

    const aggregated = await Promise.all(
      qs.map(async (q) => {
        // Берём с запасом (×2): рендерим maxWords, но email-шаблон может
        // показывать чуть больше в текстовой версии (top-N в письме).
        const topWords = await aggregateQuestion(q.id, Math.max(100, survey.maxWords * 2));
        const totalVotes = topWords.reduce((s, [, c]) => s + c, 0);
        return { question: q, topWords, totalVotes };
      })
    );

    const attachments: EmailAttachment[] = [];

    const logo = await getLogoPng();
    if (logo) {
      attachments.push({
        filename: 'logo.png',
        content: logo,
        contentType: 'image/png',
        cid: 'logo'
      });
    }

    for (let i = 0; i < aggregated.length; i++) {
      const a = aggregated[i];
      // Inline-облака пропускаем для пустых вопросов — нечего показывать.
      if (a.totalVotes === 0) continue;
      const png = await renderPng(a.topWords, survey.colorScheme, survey.customPalette, undefined, {
        maxWords: survey.maxWords,
        allowVertical: survey.allowVertical
      });
      attachments.push({
        filename: `cloud_q${i + 1}.png`,
        content: png,
        contentType: 'image/png',
        cid: `cloud_q${i + 1}`
      });
    }

    const csv = await buildSurveyCsv(survey.id);
    attachments.push({
      filename: `results-${survey.code}.csv`,
      content: Buffer.from(csv, 'utf-8'),
      contentType: 'text/csv; charset=utf-8'
    });

    await sendResultsEmail({
      to: survey.creatorEmail,
      surveyTitle: survey.title ?? `Опрос ${survey.code}`,
      surveyCode: survey.code,
      questions: aggregated.map((a) => ({
        question: { text: a.question.text, answerType: a.question.answerType },
        topWords: a.topWords,
        totalVotes: a.totalVotes
      })),
      attachments
    });

    await db.update(surveys).set({ status: 'sent' }).where(eq(surveys.id, survey.id));
    await cleanupCloudKeys(questionIds);
    notifyClosed(survey.code, 'sent');
    notifyUserSurveyStatus(survey.userId, survey.code, 'sent');
    log.info('expiry_sent', { surveyCode: survey.code });
  } catch (err) {
    log.error('expiry_failed', {
      surveyCode: survey.code,
      err: err instanceof Error ? err.message : String(err)
    });
    await db.update(surveys).set({ status: 'failed' }).where(eq(surveys.id, survey.id));
    // Чистим ключи и в failed-ветке: повторная отправка через /retry заново
    // подберёт голоса из Postgres (SELECT word, wordNorm), агрегаты в Redis
    // более не нужны.
    await cleanupCloudKeys(questionIds);
    notifyClosed(survey.code, 'failed');
    notifyUserSurveyStatus(survey.userId, survey.code, 'failed');
  }
}
