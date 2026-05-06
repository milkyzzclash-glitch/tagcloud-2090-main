import { eq, desc, sql, inArray, asc } from 'drizzle-orm';
import { db } from '../db';
import { surveys, questions, responses } from '../schema';

export type QuestionPublic = {
  id: string;
  text: string;
  answerType: 'single' | 'multi';
  maxAnswers: number;
  position: number;
};

export type SurveyPublic = {
  code: string;
  title: string | null;
  expiresAt: Date;
  status: 'active' | 'expired' | 'sent' | 'failed';
  questions: QuestionPublic[];
  colorScheme: 'mono' | 'random' | 'custom' | 'custom_gradient';
  customPalette: string[] | null;
  maxWords: number;
  allowVertical: boolean;
};

export type SurveyForCreator = SurveyPublic & {
  id: string;
  creatorEmail: string;
  creatorToken: string;
  caseSensitive: boolean;
  createdAt: Date;
};

/**
 * Грузит опрос вместе с вопросами одним SQL-запросом (LEFT JOIN). Раньше
 * было два round-trip: `select surveys`, потом `select questions`. Один JOIN
 * сокращает задержку SSR-загрузки ~на половину RTT до Postgres.
 */
async function loadSurveyWithQuestions(
  code: string
): Promise<{ survey: typeof surveys.$inferSelect; questions: QuestionPublic[] } | null> {
  const rows = await db
    .select({ survey: surveys, question: questions })
    .from(surveys)
    .leftJoin(questions, eq(questions.surveyId, surveys.id))
    .where(eq(surveys.code, code))
    .orderBy(asc(questions.position));

  if (rows.length === 0) return null;
  const survey = rows[0].survey;
  const qs: QuestionPublic[] = [];
  for (const row of rows) {
    const q = row.question;
    if (!q) continue; // LEFT JOIN: возможен null если вопросов нет
    qs.push({
      id: q.id,
      text: q.text,
      answerType: q.answerType,
      maxAnswers: q.maxAnswers,
      position: q.position
    });
  }
  return { survey, questions: qs };
}

export async function getSurveyPublic(code: string): Promise<SurveyPublic | null> {
  const data = await loadSurveyWithQuestions(code);
  if (!data) return null;
  const { survey, questions: qs } = data;
  return {
    code: survey.code,
    title: survey.title,
    expiresAt: survey.expiresAt,
    status: survey.status,
    questions: qs,
    colorScheme: survey.colorScheme,
    customPalette: survey.customPalette,
    maxWords: survey.maxWords,
    allowVertical: survey.allowVertical
  };
}

export async function getSurveyForCreator(
  code: string,
  opts: { userId?: string; token?: string }
): Promise<SurveyForCreator | null> {
  const data = await loadSurveyWithQuestions(code);
  if (!data) return null;
  const { survey, questions: qs } = data;

  // Доступ: либо session (userId матчит surveys.user_id), либо старый ?t=token
  const ok =
    (opts.userId !== undefined && survey.userId === opts.userId) ||
    (opts.token !== undefined && survey.creatorToken === opts.token);
  if (!ok) return null;

  return {
    id: survey.id,
    code: survey.code,
    title: survey.title,
    expiresAt: survey.expiresAt,
    status: survey.status,
    creatorEmail: survey.creatorEmail,
    creatorToken: survey.creatorToken,
    caseSensitive: survey.caseSensitive,
    colorScheme: survey.colorScheme,
    customPalette: survey.customPalette,
    maxWords: survey.maxWords,
    allowVertical: survey.allowVertical,
    createdAt: survey.createdAt,
    questions: qs
  };
}

export type UserSurveyListItem = {
  code: string;
  title: string | null;
  status: 'active' | 'expired' | 'sent' | 'failed';
  expiresAt: Date;
  createdAt: Date;
  questionsCount: number;
  responsesCount: number;
};

export async function listUserSurveys(userId: string): Promise<UserSurveyListItem[]> {
  const rows = await db
    .select()
    .from(surveys)
    .where(eq(surveys.userId, userId))
    .orderBy(desc(surveys.createdAt));
  if (rows.length === 0) return [];

  const surveyIds = rows.map((s) => s.id);

  const qCounts = await db
    .select({ surveyId: questions.surveyId, cnt: sql<number>`count(*)::int` })
    .from(questions)
    .where(inArray(questions.surveyId, surveyIds))
    .groupBy(questions.surveyId);
  const qBy = new Map(qCounts.map((r) => [r.surveyId, r.cnt]));

  const rCounts = await db
    .select({
      surveyId: questions.surveyId,
      cnt: sql<number>`count(${responses.id})::int`
    })
    .from(questions)
    .leftJoin(responses, eq(questions.id, responses.questionId))
    .where(inArray(questions.surveyId, surveyIds))
    .groupBy(questions.surveyId);
  const rBy = new Map(rCounts.map((r) => [r.surveyId, r.cnt]));

  return rows.map((s) => ({
    code: s.code,
    title: s.title,
    status: s.status,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
    questionsCount: qBy.get(s.id) ?? 0,
    responsesCount: rBy.get(s.id) ?? 0
  }));
}
