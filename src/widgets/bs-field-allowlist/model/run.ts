import type { FieldCode, FieldRow, Profile } from './types';

/**
 * Демо и тест исполняют строки темы — `NAIVE_MASS_CODE` (`Object.assign`) и `PICK_CODE`
 * (список имён) — одним и тем же способом. Схема zod сюда не входит: библиотеку в браузер
 * демо не везёт, её ответы сверяет тест отдельно.
 *
 * Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadFieldCode(naiveCode: string, pickCode: string): FieldCode {
  return new Function(`"use strict";\n${naiveCode}\n${pickCode}\nreturn { updateProfile, pickEditable };`)() as FieldCode;
}

/** Ключи, на которые стоит смотреть: поля записи, поля тела и то, что могло прийти через прототип. */
function keysOf(before: Profile, body: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(body).filter((k) => k !== '__proto__'), 'isAdmin']);
  const proto = Object.hasOwn(body, '__proto__') ? body.__proto__ : null;
  if (proto && typeof proto === 'object') for (const k of Object.keys(proto)) keys.add(k);
  return [...keys];
}

/**
 * Что стало с записью. Значение читается обычным обращением `record[key]` — так, как его
 * прочитает код сервера, — поэтому унаследованное через подменённый прототип тоже видно.
 */
export function changedFields(before: Profile, after: Profile, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keysOf(before, body)) {
    if (after[key] !== before[key]) out[key] = after[key];
  }
  return out;
}

export type Applied = { error: string } | { rows: FieldRow[]; naiveChanged: Record<string, unknown>; patch: Profile };

/** Одно состояние второго демо: тело запроса строкой → запись после обоих способов. */
export function applyBody(code: FieldCode, record: Profile, text: string): Applied {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (e) {
    return { error: `JSON не разобран: ${(e as Error).message}` };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Тело должно быть объектом `{ … }`.' };
  }
  const obj = body as Record<string, unknown>;
  const naive = code.updateProfile({ ...record }, obj);
  const patch = code.pickEditable(obj);
  const picked: Profile = { ...record, ...patch };
  const rows = keysOf(record, obj).map((key) => ({
    key,
    before: record[key],
    naive: naive[key],
    inherited: !Object.hasOwn(naive, key) && naive[key] !== undefined,
    pick: picked[key],
  }));
  return { rows, naiveChanged: changedFields(record, naive, obj), patch };
}
