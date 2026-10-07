import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parse as icuParse } from '@formatjs/icu-messageformat-parser';
import MessageFormat from '@messageformat/core';
import compileModule from '@messageformat/core/lib/compile-module';
import { build, transform } from 'esbuild';
import { Window } from 'happy-dom';
import { IntlMessageFormat } from 'intl-messageformat';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/i18n/data';
import { argsOf, flatten, loadDirection, loadIcu } from '@/widgets/i18n-lab/model/run';

/**
 * Тема «Интернационализация во фронтенде: ICU MessageFormat и словари».
 *
 * `ICU_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она сверяется
 * с `intl-messageformat` и `@messageformat/core` на полном наборе стенда (34 506 сочетаний
 * сообщений, чисел и локалей). Код примеров со стрелками `// →` исполняется как есть: строка
 * со стрелкой превращается в проверку «выражение слева равно значению справа». Литералы стенда
 * (`MF_MODULE_OUT`, `SIZE_ROWS`, `FALLBACK_ROWS`) пересобираются теми же вызовами.
 *
 * Глобалы happy-dom ставятся до загрузки `vue` и `vue-i18n` (оба — через `require`, чтобы копия
 * Vue была одна).
 */

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'Event', 'SVGElement', 'MutationObserver'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
afterAll(() => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const Vue = require('vue') as typeof import('vue');
const VueI18n = require('vue-i18n') as typeof import('vue-i18n');
/**
 * `createI18n` с ослабленными типами: строгие типы vue-i18n выводят локали из `messages`
 * и не дают переключиться на ещё не загруженную — а тест именно это и делает.
 */
interface LooseI18n {
  install: (app: unknown) => void;
  global: {
    t: (key: string, ...args: unknown[]) => string;
    locale: { value: string };
    availableLocales: string[];
    setLocaleMessage: (locale: string, messages: Record<string, unknown>) => void;
  };
}
const createI18n = VueI18n.createI18n as unknown as (options: Record<string, unknown>) => LooseI18n;
const coreBase = require('@intlify/core-base') as { fallbackWithLocaleChain: (ctx: object, fallback: unknown, start: string) => string[] };

const icu = loadIcu(t.ICU_CODE);

/**
 * Строки `выражение;  // → значение` (или `// → значение` на следующей строке) превращаются
 * в `__check(выражение, значение)`. Возвращает пары «получено / ожидалось».
 */
function runArrows(code: string, params: Record<string, unknown> = {}): [unknown, unknown, string][] {
  const out: string[] = [];
  for (const line of code.split('\n')) {
    const next = /^\s*\/\/ → (.+)$/.exec(line);
    if (next) {
      const prev = /^(\s*)(.+?);\s*$/.exec(out[out.length - 1]);
      if (!prev) throw new Error(`стрелке не к чему относиться: ${line}`);
      out[out.length - 1] = `${prev[1]}__check(${prev[2]}, ${next[1]}, ${JSON.stringify(prev[2])});`;
      continue;
    }
    const same = /^(\s*)(.+?);\s*\/\/ → (.+)$/.exec(line);
    out.push(same ? `${same[1]}__check(${same[2]}, ${same[3]}, ${JSON.stringify(same[2])});` : line);
  }
  const pairs: [unknown, unknown, string][] = [];
  const names = Object.keys(params);
  new Function(...names, '__check', out.join('\n'))(...names.map((n) => params[n]), (got: unknown, want: unknown, src: string) => {
    pairs.push([got, want, src]);
  });
  expect(pairs.length, 'в примере есть проверки').toBeGreaterThan(0);
  return pairs;
}

function expectArrows(code: string, params: Record<string, unknown> = {}) {
  for (const [got, want, src] of runArrows(code, params)) expect(got, src).toEqual(want);
}

// ─── Учебный разбор против двух библиотек ─────────────────────────────────────────────────

const LOCALES = ['ru', 'en', 'uk', 'pl', 'ar', 'ja'];
const NUMS = [...Array(201).keys(), 0.5, 1.5, 2.25, 3.1, 5.5, 11.5, 21.5, 0.1, 100.75, 1.001, 2.5, 22.5];

/** Девять видов сообщений; ветки — ровно категории локали, иначе `@messageformat/core` откажется. */
function messagesFor(loc: string): string[] {
  const cats = new Intl.PluralRules(loc).resolvedOptions().pluralCategories as string[];
  const ord = new Intl.PluralRules(loc, { type: 'ordinal' }).resolvedOptions().pluralCategories as string[];
  const pl = (inner: (c: string) => string) => `{n, plural, ${cats.map((c) => `${c} {${inner(c)}}`).join(' ')}}`;
  return [
    pl((c) => `# ${c}`),
    `{n, plural, =0 {нет} =1 {ровно один} ${cats.map((c) => `${c} {# ${c}}`).join(' ')}}`,
    `{n, plural, offset:1 =0 {никто} =1 {{name}} ${cats.map((c) => `${c} {{name} и ещё # (${c})}`).join(' ')}}`,
    `{n, selectordinal, ${ord.map((c) => `${c} {#-${c}}`).join(' ')}}`,
    `{g, select, female {Она: ${pl((c) => '#' + c)}} male {Он: ${pl((c) => '#' + c)}} other {Они: {n}}}`,
    `It''s '{n}' — ${pl((c) => `'#' # '{'${c}'}' ''`)} I'm`,
    `{n, plural, ${cats.map((c) => `${c} {{m, plural, other {# внутри}} и # снаружи}`).join(' ')}}`,
    `Привет, {name}! {n}`,
    `{ n , plural , ${cats.map((c) => ` ${c} { # } `).join('')} }`,
  ];
}

describe('ICU_CODE против intl-messageformat и @messageformat/core', () => {
  it('34 506 сочетаний сообщений, чисел и локалей — ни одного расхождения', () => {
    let total = 0;
    const bad: string[] = [];
    for (const loc of LOCALES) {
      for (const msg of messagesFor(loc)) {
        const imf = new IntlMessageFormat(msg, loc);
        const mf = new MessageFormat(loc).compile(msg);
        const tree = icu.parse(msg);
        for (const n of NUMS) {
          for (const g of ['female', 'male', 'x']) {
            const vals = { n, m: n + 7, g, name: 'Аня' };
            const ours = icu.format(tree, vals, loc);
            total++;
            const a = imf.format(vals);
            const b = String(mf(vals));
            if (ours !== a || ours !== b) bad.push(`${loc} n=${n} ${msg.slice(0, 50)}: ${ours} | ${String(a)} | ${b}`);
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(total).toBe(34506);
    expect(t.ICU_TEST_NOTE).toContain('на тысячах');
  });

  it('ошибки: нет other, лишняя скобка, неизвестный тип — бросает, как и библиотеки', () => {
    for (const msg of ['{n, plural, one {a}}', '{g, select, male {m}}', '{n, plural, other {a}']) {
      expect(() => icu.parse(msg), msg).toThrow(SyntaxError);
      expect(() => new IntlMessageFormat(msg, 'ru'), msg).toThrow();
      expect(() => new MessageFormat('ru').compile(msg), msg).toThrow();
    }
    expect(() => icu.parse('{n, date}')).toThrow(/не разобран/);
    // снаружи веток } — обычный знак у всех троих
    for (const msg of ['a }', '}', 'a } b {n}']) {
      const want = new IntlMessageFormat(msg, 'ru').format({ n: 1 });
      expect(String(new MessageFormat('ru').compile(msg)({ n: 1 }))).toBe(want);
      expect(icu.format(icu.parse(msg), { n: 1 }, 'ru')).toBe(want);
    }
  });

  it('там, где библиотеки расходятся, функция идёт за intl-messageformat', () => {
    // # в select внутри plural
    const pound = '{n, plural, other {{g, select, x {#} other {#}}}}';
    expect(new IntlMessageFormat(pound, 'ru').format({ n: 5, g: 'x' })).toBe('#');
    expect(String(new MessageFormat('ru').compile(pound)({ n: 5, g: 'x' }))).toBe('5');
    expect(icu.format(icu.parse(pound), { n: 5, g: 'x' }, 'ru')).toBe('#');
    // незакрытая цитата перед аргументом
    const fr = "Supprimer l'{item} ?";
    expect(new IntlMessageFormat(fr, 'fr').format({ item: 'image' })).toBe('Supprimer l{item} ?');
    expect(String(new MessageFormat('fr').compile(fr)({ item: 'image' }))).toBe("Supprimer l'image ?");
    expect(icu.format(icu.parse(fr), { item: 'image' }, 'fr')).toBe('Supprimer l{item} ?');
    expect(new IntlMessageFormat('Supprimer l’{item} ?', 'fr').format({ item: 'image' })).toBe('Supprimer l’image ?');
    expect(t.PITFALLS.find((p) => p.n === '03')?.code).toContain("// → 'Supprimer l{item} ?'");
  });

  it('таблица синтаксиса пересчитывается intl-messageformat и совпадает с учебной функцией', () => {
    for (const r of t.ICU_ROWS) {
      expect(new IntlMessageFormat(r.msg, r.locale).format(r.vals), r.k).toBe(r.out);
      expect(icu.format(icu.parse(r.msg), r.vals, r.locale), r.k).toBe(r.out);
    }
    expect(new Intl.PluralRules('ru').select(1.5)).toBe('other');
    expect(t.PLURAL_LINK).toContain("select(1.5)` — `\\'other\\'`".replaceAll('\\', ''));
  });

  it('пресеты демо разбираются, а дерево и аргументы раскладываются', () => {
    for (const p of t.DEMO_PRESETS) {
      const tree = icu.parse(p.message);
      const out = icu.format(tree, p.values, p.locale);
      expect(out, p.id).toBe(new IntlMessageFormat(p.message, p.locale).format(p.values as Record<string, string | number>));
      const rows = flatten(icu, tree, p.values, p.locale);
      expect(rows.some((r) => r.kind === 'option' && r.live) || !rows.some((r) => r.kind === 'branch'), p.id).toBe(true);
    }
    const gender = t.DEMO_PRESETS.find((p) => p.id === 'gender')!;
    const args = argsOf(icu.parse(gender.message));
    expect(args.numbers).toEqual(['n']);
    expect(args.selects.map((s) => s.name)).toEqual(['g']);
    expect(args.texts).toEqual(['name']);
    // offset: при n = 22 — «Аня и ещё 21 человек»
    const off = t.DEMO_PRESETS.find((p) => p.id === 'offset')!;
    expect(icu.format(icu.parse(off.message), { n: 22, name: 'Аня' }, 'ru')).toBe('Аня и ещё 21 человек');
    expect(off.note).toContain('Аня и ещё 21 человек');
    // арабский: zero и two уходят в other
    const files = icu.parse(t.DEMO_PRESETS[0].message);
    expect(icu.pick(files[0] as never, { n: 2 }, 'ar')).toEqual({ key: 'other', category: 'two', pound: 2 });
    expect(new Intl.PluralRules('ar').resolvedOptions().pluralCategories).toHaveLength(6);
    // кавычки
    const quote = t.DEMO_PRESETS.find((p) => p.id === 'quote')!;
    expect(icu.format(icu.parse(quote.message), { n: 5 }, 'en')).toBe("It's {5} and '#' — #5 items");
    // порядковые в русском — одна категория
    expect(new Intl.PluralRules('ru', { type: 'ordinal' }).resolvedOptions().pluralCategories).toEqual(['other']);
  });
});

describe('примеры темы исполняются', () => {
  it('склейка, род, числа и даты', () => {
    expectArrows(t.CONCAT_CODE, { IntlMessageFormat });
    expectArrows(t.GENDER_CODE, { IntlMessageFormat });
    expectArrows(t.FORMAT_CODE, { IntlMessageFormat });
  });

  it('готовое дерево formatjs: тип 6 — plural', () => {
    expectArrows(t.AST_CODE, { parse: icuParse, IntlMessageFormat });
  });

  it('compileModule пишет модуль функций слово в слово и не зовёт new Function; compile — зовёт один раз', () => {
    const mf = new MessageFormat('ru');
    const src = compileModule(mf, {
      files: '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}',
      hello: 'Привет, {name}!',
    });
    expect(src).toBe(t.MF_MODULE_OUT);
    expect(t.MF_MODULE_CODE).toContain("hello: 'Привет, {name}!'");

    const Orig = globalThis.Function;
    let calls = 0;
    globalThis.Function = new Proxy(Orig, {
      construct(target, a) { calls++; return Reflect.construct(target, a); },
      apply(target, self, a) { calls++; return Reflect.apply(target, self, a); },
    });
    try {
      new MessageFormat('ru').compile('{n, plural, one {# файл} other {# файлов}}');
    } finally {
      globalThis.Function = Orig;
    }
    expect(calls).toBe(1);
  });

  it('Accept-Language → локаль', () => {
    expectArrows(t.NEGOTIATE_CODE);
    expect(() => Intl.getCanonicalLocales('ru_RU')).toThrow(RangeError);
  });

  it('направление письма', () => {
    expectArrows(t.DIRECTION_CODE);
    const direction = loadDirection(t.DIRECTION_CODE);
    expect(direction('ar')).toBe('rtl');
    expect(direction('ja')).toBe('ltr');
  });

  it('hreflang: каждый тег настоящий, страница ссылается и на себя, есть x-default', () => {
    const doc = new win.DOMParser().parseFromString(t.HREFLANG_HTML, 'text/html');
    const links = [...doc.querySelectorAll('link[rel="alternate"]')];
    const langs = links.map((l) => l.getAttribute('hreflang')!);
    expect(langs).toContain('x-default');
    expect(langs).toContain(doc.documentElement.getAttribute('lang'));
    for (const l of langs.filter((x) => x !== 'x-default')) expect(Intl.getCanonicalLocales(l)).toEqual([l]);
  });
});

describe('цена в байтах', () => {
  const define = {
    'process.env.NODE_ENV': '"production"',
    __VUE_I18N_FULL_INSTALL__: 'true',
    __VUE_I18N_LEGACY_API__: 'false',
    __INTLIFY_PROD_DEVTOOLS__: 'false',
    __INTLIFY_JIT_COMPILATION__: 'true',
    __INTLIFY_DROP_MESSAGE_COMPILER__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
  };
  async function bundle(contents: string, extra: Record<string, unknown> = {}) {
    const r = await build({
      stdin: { contents, resolveDir: ROOT, loader: 'js' },
      bundle: true, minify: true, format: 'esm', write: false, platform: 'browser',
      external: ['vue'], define, logLevel: 'silent', ...extra,
    });
    const code = r.outputFiles[0].contents;
    return { min: code.length, gz: gzipSync(code, { level: 9 }).length };
  }

  it('каждая строка SIZE_ROWS пересобирается байт в байт', async () => {
    const row = (i: number) => ({ min: t.SIZE_ROWS[i].min, gz: t.SIZE_ROWS[i].gz });
    expect(await bundle("import { IntlMessageFormat } from 'intl-messageformat'; export const f = (m, l, v) => new IntlMessageFormat(m, l).format(v);")).toEqual(row(0));
    expect(await bundle(
      "import { IntlMessageFormat } from 'intl-messageformat'; export const f = (ast, l, v) => new IntlMessageFormat(ast, l).format(v);",
      { alias: { '@formatjs/icu-messageformat-parser': '@formatjs/icu-messageformat-parser/no-parser.js' } },
    )).toEqual(row(1));
    expect(await bundle("import MessageFormat from '@messageformat/core'; export const f = (m, l, v) => new MessageFormat(l).compile(m)(v);")).toEqual(row(2));
    expect(await bundle(t.MF_MODULE_OUT)).toEqual(row(3));
    const full = await bundle("export { createI18n } from 'vue-i18n';");
    expect(full).toEqual(row(4));
    const drop = await bundle("export { createI18n } from 'vue-i18n';", { define: { ...define, __INTLIFY_DROP_MESSAGE_COMPILER__: 'true' } });
    expect(drop).toEqual(row(5));
    const mini = (await transform(t.ICU_CODE, { minify: true })).code;
    expect({ min: mini.length, gz: gzipSync(mini, { level: 9 }).length }).toEqual(row(6));

    // «парсер — около 26 КБ из 33», «компилятор vue-i18n — около 16 КБ»
    const parser = await bundle("export { parse } from '@formatjs/icu-messageformat-parser';");
    expect(Math.round(parser.min / 1024)).toBe(26);
    expect(Math.round(row(0).min / 1024)).toBe(33);
    expect(Math.round((full.min - drop.min) / 1024)).toBe(16);
    expect(t.SIZE_NOTE).toContain('около 26 КБ из 33');
    expect(t.SIZE_NOTE).toContain('около 16 КБ');
  }, 60_000);
});

describe('MessageFormat 2 и библиотеки первой версии', () => {
  it('Intl.MessageFormat нет; intl-messageformat бросает, @messageformat/core молчит', () => {
    expect(typeof (Intl as unknown as Record<string, unknown>).MessageFormat).toBe('undefined');
    expect(() => new IntlMessageFormat(t.MF2_CODE, 'ru')).toThrow(/MALFORMED_ARGUMENT/);
    expect(() => new MessageFormat('ru').compile(t.MF2_CODE)).toThrow(/invalid syntax/);
    const short = '.input {$n :number} .match $n one {{один}} * {{много}}';
    expect(t.PITFALLS.find((p) => p.n === '10')?.d).toContain(short);
    expect(() => new IntlMessageFormat(short, 'ru')).toThrow(/MALFORMED_ARGUMENT/);
    expect(String(new MessageFormat('ru').compile(short)({ n: 1 }))).toBe('.input {$n :number} .match $n one {undefined} * {undefined}');
  });
});

describe('vue-i18n 11', () => {
  it('версии стенда', () => {
    expect(require('vue-i18n/package.json').version).toBe('11.4.12');
  });

  it('правило множественного числа по умолчанию и через Intl.PluralRules', () => {
    expectArrows(t.VI_PLURAL_CODE, { createI18n });
  });

  it('ICU через messageCompiler; свой компилятор зовётся на каждый t(), встроенный кеширует', () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.join(' ')); };
    try {
      expectArrows(t.VI_ICU_CODE, { createI18n, IntlMessageFormat });
    } finally {
      console.warn = orig;
    }
    expect(warns.join('\n')).toContain('Custom Message Compiler, which is an experimental feature');
    let compiled = 0;
    const i18n = createI18n({
      legacy: false, locale: 'ru', messages: { ru: { hi: 'Привет, {name}!' } },
      messageCompiler: (message: unknown, { locale }: { locale: string }) => {
        compiled++;
        const mf = new IntlMessageFormat(message as string, locale);
        return (ctx: { values: Record<string, string> }) => mf.format(ctx.values);
      },
    });
    expect(i18n.global.t('hi', { name: 'Аня' })).toBe('Привет, Аня!');
    expect(i18n.global.t('hi', { name: 'Боря' })).toBe('Привет, Боря!');
    expect(compiled).toBe(2);
    const ctx = { locale: 'ru', key: 'hi', onError: (e: Error) => { throw e; }, warnHtmlMessage: false };
    const builtin = (coreBase as unknown as { compile: (m: string, c: object) => unknown }).compile;
    expect(builtin('Привет, {name}!', ctx)).toBe(builtin('Привет, {name}!', ctx));
  });

  it('свой синтаксис: ICU-строка и @ в тексте — ошибки компиляции, {\'@\'} — буквальный знак', () => {
    const i18n = createI18n({
      legacy: false, locale: 'ru', missingWarn: false, fallbackWarn: false,
      messages: { ru: { icu: '{n, plural, one {# файл} other {# файлов}}', mail: 'Пишите: help@site.ru', ok: "Пишите: help{'@'}site.ru" } },
    });
    expect(() => i18n.global.t('icu', { n: 1 })).toThrow(/Invalid token in placeholder: 'n,'/);
    expect(() => i18n.global.t('mail')).toThrow(/Invalid linked format/);
    expect(i18n.global.t('ok')).toBe('Пишите: help@site.ru');
    expect(t.VI_SYNTAX_NOTE).toContain("Invalid token in placeholder: \\'n,\\'".replaceAll('\\', ''));
  });

  it('цепочки запасных локалей — те, что в таблице', () => {
    for (const r of t.FALLBACK_ROWS) {
      const fallback = new Function(`return ${r.fallback}`)();
      expect(coreBase.fallbackWithLocaleChain({}, fallback, r.start), r.start).toEqual(r.chain);
    }
    expect(new Intl.Locale('zh').maximize().toString()).toBe('zh-Hans-CN');
    expect(new Intl.Locale('sr').maximize().script).toBe('Cyrl');
  });

  it('пропавший ключ: сам ключ, предупреждения в dev, тишина в production, своя функция missing', () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.join(' ')); };
    try {
      const i18n = createI18n({ legacy: false, locale: 'ru', fallbackLocale: 'en', messages: { ru: {}, en: {} } });
      expect(i18n.global.t('nope.key')).toBe('nope.key');
    } finally {
      console.warn = orig;
    }
    expect(warns).toContain("[intlify] Not found 'nope.key' key in 'ru' locale messages.");
    expect(warns).toContain("[intlify] Fall back to translate 'nope.key' key with 'en' locale.");
    expect(warns).toContain("[intlify] Not found 'nope.key' key in 'en' locale messages.");

    const code = `const { createI18n } = require('vue-i18n');
      const i18n = createI18n({ legacy: false, locale: 'ru', fallbackLocale: 'en', messages: { ru: {}, en: {} } });
      process.stdout.write(i18n.global.t('nope.key'));`;
    const prod = execFileSync(process.execPath, ['-e', code], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(prod).toBe('nope.key');

    const custom = createI18n({
      legacy: false, locale: 'ru', messages: { ru: {} }, missingWarn: false, fallbackWarn: false,
      missing: (_locale: string, key: string) => `⟦${key}⟧`,
    });
    expect(custom.global.t('nope.key')).toBe('⟦nope.key⟧');
  });

  it('смена локали перерисовывает компонент на следующем тике; $t и v-t работают', async () => {
    const en = { hello: 'Hello, {name}!' };
    const ru = { hello: 'Привет, {name}!' };
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } });
    let renders = 0;
    const WithT = { setup() { const { t: tr } = VueI18n.useI18n(); return () => { renders++; return Vue.h('p', tr('hello', { name: 'Ann' })); }; } };
    const WithDollar = { render(this: { $t: (k: string, v: object) => string }) { return Vue.h('i', this.$t('hello', { name: 'Ann' })); } };
    const WithVT = { render() { return Vue.withDirectives(Vue.h('span'), [[Vue.resolveDirective('t')!, { path: 'hello', args: { name: 'Ann' } }]]); } };
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = Vue.createApp({ render: () => [Vue.h(WithT), Vue.h(WithDollar), Vue.h(WithVT)] });
    app.use(i18n as never);
    app.mount(root);
    expect(root.innerHTML).toBe('<p>Hello, Ann!</p><i>Hello, Ann!</i><span>Hello, Ann!</span>');
    expect(renders).toBe(1);

    i18n.global.setLocaleMessage('ru', ru);
    i18n.global.locale.value = 'ru';
    expect(root.innerHTML).toContain('Hello');
    await Vue.nextTick();
    expect(root.innerHTML).toBe('<p>Привет, Ann!</p><i>Привет, Ann!</i><span>Привет, Ann!</span>');
    expect(renders).toBe(2);
    app.unmount();

    // локаль раньше словаря — запасной текст
    const early = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    early.global.locale.value = 'ru';
    expect(early.global.t('hello', { name: 'Аня' })).toBe('Hello, Аня!');
    expect(t.VI_REACT_FACTS[1].d).toContain('«Hello, Аня!»');
  });

  it('v-t помечен устаревшим в сборке для сборщиков', () => {
    const esm = readFileSync(join(ROOT, 'node_modules/vue-i18n/dist/vue-i18n.mjs'), 'utf8');
    expect(esm).toContain("'v-t' has been deprecated in v11");
    expect(esm).toContain('Legacy API mode has been deprecated in v11');
  });

  describe('ленивые словари', () => {
    let dir: string;
    beforeAll(() => {
      dir = realpathSync(mkdtempSync(join(tmpdir(), 'i18n-lazy-')));
      mkdirSync(join(dir, 'locales'));
      writeFileSync(join(dir, 'lazy.mjs'), t.VI_LAZY_CODE);
      writeFileSync(join(dir, 'locales/ru.js'), "export default { hello: 'Привет, {name}!' };\n");
      writeFileSync(join(dir, 'locales/uk.js'), "export default { hello: 'Привіт, {name}!' };\n");
    });

    it('setLocale грузит словарь, потом переключает локаль и lang', async () => {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'lazy.mjs')).href)) as { setLocale: (i: unknown, l: string) => Promise<void> };
      const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en: { hello: 'Hello, {name}!' } } });
      await mod.setLocale(i18n, 'uk');
      expect(i18n.global.locale.value).toBe('uk');
      expect(i18n.global.t('hello', { name: 'Аня' })).toBe('Привіт, Аня!');
      expect(document.documentElement.lang).toBe('uk');
      expect(i18n.global.availableLocales.sort()).toEqual(['en', 'uk']);
    });

    it('esbuild со splitting выносит каждый словарь в свой чанк', async () => {
      const r = await build({ entryPoints: [join(dir, 'lazy.mjs')], bundle: true, splitting: true, format: 'esm', outdir: join(dir, 'out'), write: false, logLevel: 'silent' });
      const files = r.outputFiles.map((f) => f.path.slice(join(dir, 'out').length + 1)).sort();
      expect(files).toHaveLength(3);
      expect(files.filter((f) => /^(ru|uk)-/.test(f))).toHaveLength(2);
      expect(t.VI_LAZY_NOTE).toContain('по чанку на `ru` и `uk`');
    });
  });
});

describe('тонкие места', () => {
  it('{n} без number, даты short в двух библиотеках, de-CH без de', () => {
    expect(new IntlMessageFormat('{n}', 'ru').format({ n: 1234.5 })).toBe('1234.5');
    const d = new Date(Date.UTC(2026, 9, 2, 12));
    expect(new IntlMessageFormat('{d, date, short}', 'ru').format({ d })).toBe('02.10.26');
    expect(String(new MessageFormat('ru').compile('{d, date, short}')({ d }))).toBe('02.10.2026');
    expect(new Intl.DateTimeFormat('ru', { dateStyle: 'short' }).format(d)).toBe('02.10.2026');
    expect(coreBase.fallbackWithLocaleChain({}, { 'de-CH': ['fr'], default: ['en'] }, 'de-CH')).not.toContain('de');
  });
});

describe('Chromium', () => {
  let browser: Browser;
  let server: Server;
  const seen: (string | undefined)[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.headers['accept-language']);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>i18n</title>');
    });
    await new Promise<void>((r) => server.listen(4972, '127.0.0.1', r));
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('Accept-Language и navigator.languages: без локали заголовка нет, с ru-RU — ru-RU', async () => {
    const probe = async (locale?: string) => {
      const ctx = await browser.newContext(locale ? { locale } : {});
      const page = await ctx.newPage();
      await page.goto('http://127.0.0.1:4972/');
      const r = await page.evaluate(() => ({
        langs: [...navigator.languages],
        mf: typeof (Intl as unknown as Record<string, unknown>).MessageFormat,
        ti: typeof (Intl.Locale.prototype as unknown as Record<string, unknown>).getTextInfo,
        pr: new Intl.PluralRules('ru').select(1.5),
      }));
      await ctx.close();
      return { header: seen.at(-1), ...r };
    };
    const bare = await probe();
    expect(bare.header).toBeUndefined();
    const ru = await probe('ru-RU');
    expect(ru).toEqual({ header: 'ru-RU', langs: ['ru-RU'], mf: 'undefined', ti: 'function', pr: 'other' });
    expect(browser.version()).toBe('153.0.8010.12');
  }, 60_000);

  it('логические свойства поворачиваются вместе с dir', async () => {
    const page = await browser.newPage();
    await page.setContent(`<style>${t.LOGICAL_CSS}</style><div dir="ltr"><div class="card" id="l">x</div></div><div dir="rtl"><div class="card" id="r">x</div></div>`);
    const box = (id: string) => page.evaluate((i) => {
      const s = getComputedStyle(document.getElementById(i)!);
      return [s.marginLeft, s.marginRight, s.paddingLeft, s.paddingRight, s.borderLeftWidth, s.borderRightWidth, s.textAlign];
    }, id);
    expect(await box('l')).toEqual(['16px', '0px', '12px', '24px', '4px', '0px', 'start']);
    expect(await box('r')).toEqual(['0px', '16px', '24px', '12px', '0px', '4px', 'start']);
    await page.close();
  }, 30_000);
});

