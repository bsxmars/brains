/** Тон вердикта: `ok` — так и надо, `warn` — молча испортили, `err` — падает с ошибкой. */
export type TransferTone = 'ok' | 'warn' | 'err';

/**
 * Владение буфером после вызова — то, ради чего демо и существует.
 *
 * Transfer — это не копия и не ссылка, а смена владельца: у отправителя `byteLength`
 * становится нулём в тот же момент, когда получатель ещё даже не проснулся.
 *
 * Обе строки заполняет прогон, а не автор: `sender` — это `byteLength`, прочитанный после
 * настоящего `postMessage`, `receiver` — то, что действительно доехало до второго порта.
 */
export interface TransferOwnership {
  sender: string;
  senderTone: TransferTone | 'dim';
  receiver: string;
  receiverTone: TransferTone | 'dim';
}

/**
 * Случай transfer-списка в том виде, в каком его знает `data.ts` урока.
 *
 * ⚠️ Тип оставлен ради совместимости: `src/content/lessons/message-channel/data.ts` объявляет
 * им массив `TRANSFER`, а компонент до сих пор принимает его пропом. Сам компонент этих готовых
 * вердиктов больше не показывает — он выполняет случай и печатает то, что ответил движок.
 * Когда проп уйдёт из темы, вместе с ним отсюда уйдёт и этот интерфейс.
 */
export interface TransferCase {
  key: string;
  label: string;
  code: string;
  /** Короткая строка вердикта — то, что видно сразу. */
  result: string;
  tone: TransferTone;
  why: string;
  /** Показывается только там, где в игре есть буфер. */
  owner?: TransferOwnership;
}

/** Шесть случаев transfer-списка. Ключи те же, что были у `TRANSFER`: адреса и `initial` целы. */
export type TransferKey = 'self' | 'no-list' | 'orphan' | 'view' | 'ok' | 'twice';

/** Одно замеренное число рядом с его подписью. Ни одной строки здесь не написано заранее. */
export interface TransferValue {
  label: string;
  value: string;
}

/**
 * Итог одного настоящего прогона: свежий `MessageChannel`, свежий буфер, живой `postMessage`.
 *
 * `threw`, `errorName` и `error` — то, что реально бросил движок, а не пересказ. Имя лежит
 * отдельно от текста намеренно: `DataCloneError` нормативно, а формулировку каждый движок
 * пишет свою («Port at index 0 contains the source port» в Chromium, «Transfer list contains
 * source port» в Node). Утверждать в тесте можно только имя, показывать читателю — и то и другое.
 */
export interface TransferRun {
  key: TransferKey;
  /** `false`, если в среде нет `MessageChannel`: тогда демо честно молчит, а не выдумывает ответ. */
  supported: boolean;
  /** Строки кода, которые исполнились, — те же, что видит читатель. */
  code: string[];
  threw: boolean;
  /** `DataCloneError`, `TypeError` — имя, и ничего кроме имени. */
  errorName: string;
  /** Дословный текст движка вместе с именем. */
  error: string;
  /**
   * Те же замеры числами — ровно те, из которых собраны подписи в `values` и `owner`.
   *
   * ⚠️ Поля добавлены не для показа, а потому что утверждать подпись нельзя: строка
   * `'buf.byteLength → 0, доступа больше нет'` написана для читателя, и проверка, зацепившаяся
   * за неё, ломалась бы от косметической правки, ничего не гарантируя по существу. Число живёт
   * отдельно, строка показа собирается из него же — разойтись им негде.
   *
   * `null` значит «такого объекта в случае нет вовсе»: буфера нет у первого случая, вида —
   * у всех, кроме двух, а до получателя в трёх случаях не доезжает ни одного байта.
   */
  senderBytes: number | null;
  senderViewBytes: number | null;
  /** `ArrayBuffer.prototype.detached`: ноль байт и отсоединение — не одно и то же. */
  senderDetached: boolean | null;
  receiverBytes: number | null;
  /** Первый байт у получателя: метка, по которой видно, что данные доехали, а не обнулились. */
  receiverMark: number | null;
  /** Сообщения, реально доехавшие до второго порта: без форматирования и в порядке доставки. */
  arrivals: unknown[];
  /** Замеры: что вернул движок, сколько байт осталось, что доехало. */
  values: TransferValue[];
  /** Судьба буфера. Отсутствует там, где буфера в случае нет вовсе. */
  owner?: TransferOwnership;
  tone: TransferTone;
  verdict: string;
}

/** Случай в переключателе: подпись, заголовок, объяснение и исходник — всё, кроме ответа. */
export interface TransferScenario {
  key: TransferKey;
  label: string;
  title: string;
  lead: string;
  why: string;
  code: string[];
}
