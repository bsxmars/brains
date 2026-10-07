/// <reference lib="webworker" />
import { loadImpl, loadSample, runMethods } from './run';
import type { MethodResult } from './types';

/**
 * Код примера пишет читатель, поэтому он исполняется не на главном потоке, а здесь: опечатка
 * `while (true) ;` убьёт воркер, а не вкладку с уроком (компонент снимает его по таймауту).
 * Наружу уходят только строки — копии и их печать остаются в воркере.
 */
export interface CloneJob {
  stringifyCode: string;
  cloneCode: string;
  code: string;
}

export type CloneReply = { ok: true; results: MethodResult[] } | { ok: false; error: string };

self.onmessage = (event: MessageEvent<CloneJob>) => {
  const { stringifyCode, cloneCode, code } = event.data;
  let reply: CloneReply;
  try {
    const impl = loadImpl(stringifyCode, cloneCode);
    const make = loadSample(code);
    make(); // ошибка в самом примере — до копирования, чтобы не путать её с отказом способа
    reply = { ok: true, results: runMethods(make, impl) };
  } catch (e) {
    reply = { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
  self.postMessage(reply);
};
