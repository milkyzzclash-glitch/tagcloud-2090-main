import { error } from '@sveltejs/kit';
import { isValidCode } from '$lib/server/surveys/codes';
import { getSurveyPublic } from '$lib/server/surveys/get';
import { aggregateQuestion } from '$lib/server/cloud/aggregate';
import type { CloudWord } from '$lib/types/cloud';
import type { PageServerLoad } from './$types';

/**
 * Публичный просмотр облак(а) по коду опроса. Используется респондентами
 * после прохождения опроса (правка №2: ссылка со страницы «Спасибо!»),
 * а также со страницы «Опрос создан» (правка №7).
 *
 * Доступ публичный (как у /r/[code]): любой, у кого есть код, видит уже
 * накопленные ответы. Сами ответы анонимны, поэтому это не утечка PII.
 */
export const load: PageServerLoad = async ({ params }) => {
  const code = params.code;
  if (!isValidCode(code)) error(404, 'Опрос не найден');

  const survey = await getSurveyPublic(code);
  if (!survey) error(404, 'Опрос не найден');

  // SSR-снэпшот облак для каждого вопроса. Дальше клиент подключается
  // к публичному WS `/ws/c/<code>`, где сервер бродкастит cloud:<qid>
  // snapshots по pub/sub (без поллинга и без нагрузки на Postgres).
  const entries = await Promise.all(
    survey.questions.map(async (q) => [q.id, await aggregateQuestion(q.id, 200)] as const)
  );
  const initialWords: Record<string, CloudWord[]> = Object.fromEntries(entries);

  return { survey, initialWords };
};
