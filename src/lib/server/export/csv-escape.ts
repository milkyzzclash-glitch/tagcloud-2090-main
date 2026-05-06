// Чистая функция RFC 4180 escape — вынесена из csv.ts, чтобы её можно было
// тестировать без подтягивания db/schema (csv.ts импортирует runtime БД).

// UTF-8 BOM — нужен Excel'ю для корректной кодировки кириллицы при открытии CSV.
export const CSV_BOM = '\uFEFF';

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}
