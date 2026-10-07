import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Темы, где раздела «Перед началом» нет по решению автора курса. */
const WITHOUT_PREREQ = new Set(['lessons/object-model']);

/**
 * Обязательные блоки темы — и проверка, что они на месте.
 *
 * Тонкие места (`<Pitfalls>`) с 2026-10-06 необязательны — решение автора курса: блок остаётся
 * там, где в нём есть что сказать, и не держится ради единообразия.
 *
 * Направление не курс: читатель приходит за одной темой из поиска и уходит, прочитав один
 * разбор. Поэтому тема обязана быть самодостаточной, и правило об этом записано в `AGENTS.md`
 * («Зачин темы: обязательные блоки»). Раньше правило держалось только на записи,
 * а собирается тема всё равно зелёной: ни сборка, ни типы про пропавший словарь не скажут.
 *
 * Отсюда и проверка. Она смотрит **на факт отрисовки**, а не на имена констант. Там, где блок живёт в данных и печатается в теме, проверяются оба
 * конца: объявлено в `data.ts` и выведено в `index.mdx`. Иначе легко получить константу,
 * которую никто не показывает, — ровно тот случай, когда «в данных всё есть», а читатель
 * не видит ничего.
 *
 * Отдельно проверяется согласованность оглавления: пункт `nav` без своей секции и секция
 * без пункта — обе ошибки тихие. Первая роняет `anchors.spec` (сторож кликает по пилюле
 * и не находит раздела), вторая делает раздел недостижимым по оглавлению — так в «Объектной
 * модели» когда-то потерялась половина интерактива.
 *
 * Почему с диска, а не через `astro:content`: тест идёт в обычном Node, где виртуального
 * модуля коллекций не существует. Диск с контентом доступен всегда — тем же приёмом собирает
 * список страниц `tests/e2e/pages.ts`.
 */

/** Каталоги коллекций: те же четыре, что объявлены в `src/content.config.ts`. */
const COLLECTIONS = ['lessons', 'render', 'frameworks', 'platform', 'tooling', 'delivery', 'algorithms', 'data', 'patterns'];

interface Topic {
  /** `render/webgl` — как тема называется в сообщениях об ошибке. */
  id: string;
  mdx: string;
  data: string;
}

function collect(): Topic[] {
  const topics: Topic[] = [];

  for (const collection of COLLECTIONS) {
    const root = new URL(`../../src/content/${collection}/`, import.meta.url);
    if (!existsSync(root)) continue;

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const mdxPath = new URL(`${entry.name}/index.mdx`, root);
      if (!existsSync(mdxPath)) continue;

      const dataPath = new URL(`${entry.name}/data.ts`, root);
      topics.push({
        id: `${collection}/${entry.name}`,
        mdx: readFileSync(mdxPath, 'utf8'),
        data: existsSync(dataPath) ? readFileSync(dataPath, 'utf8') : '',
      });
    }
  }

  return topics.sort((a, b) => a.id.localeCompare(b.id));
}

const TOPICS = collect();

/**
 * ⚠️ Молчаливый ноль — главная опасность обхода: переименовали каталог, и проверка радостно
 * проходит по пустому списку. Пустой результат здесь ошибка, а не пустой список.
 */
if (TOPICS.length < 20) {
  throw new Error(
    `Обход контента нашёл подозрительно мало тем (${TOPICS.length}). ` +
      'Похоже, сменилась структура src/content — проверьте её, прежде чем верить зелёному прогону.',
  );
}

/** Пункты оглавления из frontmatter: `- { id: s1, label: … }`. */
function navIds(mdx: string): string[] {
  const block = mdx.match(/\nnav:\n([\s\S]*?)\n---/);
  if (!block) return [];
  return [...block[1].matchAll(/id:\s*([a-z0-9-]+)/g)].map((m) => m[1]);
}

/** Идентификаторы секций: тег `<Section>` бывает многострочным, поэтому разбор по всему тегу. */
function sectionIds(mdx: string): string[] {
  return [...mdx.matchAll(/<Section\b([\s\S]*?)>/g)]
    .map((m) => m[1].match(/\bid="([a-z0-9-]+)"/)?.[1])
    .filter((id): id is string => Boolean(id));
}

describe('анатомия темы: обязательные блоки у каждой', () => {
  it(`темы найдены (${TOPICS.length})`, () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(20);
  });

  describe.each(TOPICS)('$id', (topic) => {
    it('есть вводный раздел', () => {
      expect(
        topic.mdx.includes('variant="intro"'),
        `${topic.id}: нет вводного раздела (<Section variant="intro">). ` +
          'С него начинается каждая тема: зачем она существует и что даёт.',
      ).toBe(true);
    });

    it('есть словарь, и он выведен в теме', () => {
      const declared = /\bGLOSSARY(_CARDS)?\b/.test(topic.data);
      const rendered = /\bGLOSSARY(_CARDS)?\b/.test(topic.mdx);

      expect(
        declared,
        `${topic.id}: в data.ts нет GLOSSARY. Словарь — слова, которые тема употребляет ` +
          'раньше, чем объясняет; без него читатель из поиска спотыкается на третьем абзаце.',
      ).toBe(true);
      expect(
        rendered,
        `${topic.id}: GLOSSARY объявлен, но в index.mdx не выведен — данные есть, ` +
          'а читатель их не видит.',
      ).toBe(true);
    });

    it('есть раздел «Перед началом» и он первым в оглавлении', () => {
      // Решение автора курса 2026-09-30: в «Объектной модели» блок не нужен — тема
      // начинается с самого объекта `dog`, а обе карточки «Перед началом» были про
      // внутренние имена V8, которые этой теме ни к чему.
      if (WITHOUT_PREREQ.has(topic.id)) return;
      const nav = navIds(topic.mdx);
      const sections = sectionIds(topic.mdx);

      expect(
        sections.includes('s0'),
        `${topic.id}: нет секции id="s0" — раздела «Перед началом». В нём тема честно ` +
          'говорит, что считает известным, и куда идти, если это не на месте.',
      ).toBe(true);
      expect(
        nav[0],
        `${topic.id}: «Перед началом» должно стоять первым пунктом nav, а там ${nav[0] ?? '—'}.`,
      ).toBe('s0');
    });

    /**
     * «Что осталось за кадром» больше не обязателен — решение автора курса (2026-09-28): всё, что
     * тема задевает, раскрывается в её тексте, а большие предметы уходят в отдельные темы.
     * Выход из темы держит «Смежное на сайте». Если блок всё же есть, он обязан быть выведен
     * и не пуст: объявленный, но пустой список — это тот самый тупик, от которого уходили.
     */
    it('«Что осталось за кадром», если есть, выведен и не пуст', () => {
      if (!topic.data.includes('export const OFFSCREEN')) return;
      expect(
        topic.mdx.includes('OFFSCREEN'),
        `${topic.id}: OFFSCREEN объявлен, но в index.mdx не выведен.`,
      ).toBe(true);
      const body = topic.data.slice(topic.data.indexOf('export const OFFSCREEN'));
      const list = body.slice(0, body.indexOf('\n];') + 3);
      expect(
        /\bt:/.test(list),
        `${topic.id}: OFFSCREEN объявлен, но пуст — убери блок целиком вместе с выводом в index.mdx.`,
      ).toBe(true);
    });

    it('есть «Источники», и они выведены', () => {
      expect(
        topic.data.includes('SOURCES'),
        `${topic.id}: в data.ts нет SOURCES. Числа и утверждения темы должны быть ` +
          'подписаны источником, иначе их нечем перепроверить.',
      ).toBe(true);
      expect(
        topic.mdx.includes('SOURCES'),
        `${topic.id}: SOURCES объявлены, но в index.mdx не выведены.`,
      ).toBe(true);
    });

    it('есть «Смежное на сайте» — выход из темы', () => {
      const related = topic.mdx.includes('Смежное на сайте') || topic.data.includes('Смежное на сайте');
      expect(
        related,
        `${topic.id}: нет блока «Смежное на сайте». Без него тема — тупик: читатель ` +
          'дочитал и не знает, куда идти дальше.',
      ).toBe(true);
    });

    /**
     * Номер в подписи раздела обязан совпадать с числом в его `id`.
     *
     * Полоса разделов печатает номер, разобрав `id` (`s2` → «2»), а подпись внутри темы
     * набрана руками — и разойтись они могут молча. Именно это и случилось, когда у всех
     * тем появился раздел «Перед началом»: он встал первым пунктом, прежняя нумерация
     * по порядку сдвинулась, и полоса показывала «3 · Прототипы» над разделом с подписью
     * «Раздел 2». Ошибка была сразу в 31 теме, а поймал её читатель, не проверка.
     *
     * Здесь сверяется вторая половина связки — та, что живёт в контенте.
     */
    it('номер в подписи раздела совпадает с его id', () => {
      const sections = [...topic.mdx.matchAll(/<Section\b([\s\S]*?)>/g)].map((m) => ({
        id: m[1].match(/\bid="(s\d+)"/)?.[1],
        eyebrow: m[1].match(/\beyebrow="([^"]*)"/)?.[1] ?? '',
      }));

      const broken = sections
        .filter((s) => s.id && /Раздел\s+\d+/.test(s.eyebrow))
        .map((s) => ({ ...s, want: s.id!.slice(1), got: /Раздел\s+(\d+)/.exec(s.eyebrow)![1] }))
        .filter((s) => s.want !== s.got)
        .map((s) => `${s.id} подписан «${s.eyebrow}» (ожидалось «Раздел ${s.want}»)`);

      expect(
        broken,
        `${topic.id}: подпись раздела разошлась с его id: ${broken.join('; ')}. ` +
          'Полоса берёт номер из id, и читатель увидит два разных числа над одним разделом.',
      ).toEqual([]);
    });

    /** «Перед началом» — зачин, а не раздел номер ноль: номера у него быть не должно. */
    it('«Перед началом» не пронумерован', () => {
      const s0 = [...topic.mdx.matchAll(/<Section\b([\s\S]*?)>/g)]
        .map((m) => m[1])
        .find((attrs) => /\bid="s0"/.test(attrs));

      const eyebrow = s0?.match(/\beyebrow="([^"]*)"/)?.[1] ?? '';
      expect(
        /Раздел\s+\d+/.test(eyebrow),
        `${topic.id}: у s0 подпись «${eyebrow}» с номером. Полоса его не нумерует, ` +
          'и номер в подписи создаст расхождение.',
      ).toBe(false);
    });

    it('оглавление сходится с разделами', () => {
      const nav = navIds(topic.mdx);
      const sections = sectionIds(topic.mdx);

      // Пункт без секции: `anchors.spec` кликнет по пилюле и не найдёт, куда прокручивать.
      const orphanNav = nav.filter((id) => !sections.includes(id));
      expect(
        orphanNav,
        `${topic.id}: в nav есть пункты без своей секции: ${orphanNav.join(', ')}. ` +
          'Пилюля есть, раздела нет — проверка якорей упадёт по таймауту.',
      ).toEqual([]);

      // Секция без пункта: раздел существует, но по оглавлению до него не добраться.
      const orphanSections = sections.filter((id) => !nav.includes(id));
      expect(
        orphanSections,
        `${topic.id}: есть секции, которых нет в nav: ${orphanSections.join(', ')}. ` +
          'Раздел, которого нет в оглавлении, для читателя не существует.',
      ).toEqual([]);
    });
  });
});
