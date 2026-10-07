/**
 * Выполнить пример прямо на странице и вернуть его вывод.
 *
 * Зачем это фича, а не данные в уроке: линейка в оригинале только выглядела замером, а на
 * деле показывала числа, вписанные руками, — и два из девяти оказались неверными. Вывод,
 * полученный в браузере читателя, устареть не может и спорить с движком не станет.
 *
 * Как считается цена. Рядом с примером запускается «линейка» — цепочка `.then` известной
 * длины, где каждое звено ровно одна микрозадача. Порядок важен: сначала линейка, потом
 * пример, иначе продолжение примера встанет в очередь раньше первой ступени.
 *
 * Опасности тут нет: код лежит в самом уроке, а не приходит от пользователя. Но `new Function`
 * может быть запрещён политикой безопасности на чужом хостинге — тогда возвращается
 * `ok: false`, и урок показывает заранее посчитанный вывод.
 */
export interface RunResult {
  lines: string[];
  ok: boolean;
  /**
   * Почему не получилось. Раньше `ok: false` не объяснял ничего, и это было терпимо, пока код
   * приходил только из урока. Как только его правит читатель, пустая консоль вместо сообщения
   * об ошибке — худший из возможных ответов.
   */
  error?: string;
}

const TICK = (n: number) => `tick ${n}`;

export async function runWithRuler(code: string, steps = 6): Promise<RunResult> {
  const lines: string[] = [];
  const sandbox = {
    log: (...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '));
    },
  };

  try {
    let chain = Promise.resolve();
    for (let i = 1; i <= steps; i++) {
      const n = i;
      chain = chain.then(() => {
        lines.push(TICK(n));
      });
    }
    new Function('console', code)(sandbox);
  } catch {
    return { lines: [], ok: false };
  }

  // Одна макрозадача — и микроочередь заведомо слита до конца.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { lines, ok: true };
}

/** Тот же вывод, собранный из известной цены, — для сервера и для случая `ok: false`. */
export function rulerLines(n: number, hit: string, steps = 6): string[] {
  const lines: string[] = [];
  for (let i = 1; i <= steps; i++) {
    lines.push(TICK(i));
    if (i === n) lines.push(hit);
  }
  return n === 0 ? [hit, ...lines] : lines;
}
