/**
 * «Уйдёт ли кука»: атрибуты куки и контекст запроса → решение и ключ раздела.
 *
 * Чистая функция, без DOM и без Vue. Её зовёт демо темы «Встроенный контент без сторонних кук»
 * (`ui/TpcCookieVerdict.vue`), и её же прогоняет `tests/unit/third-party-cookies.test.ts`
 * по таблице `VERDICT_MEASURED` из `data.ts` — таблице, **снятой** на стенде в Chromium 153,
 * Firefox 155 и WebKit 26.6. Правило курса: демо и тест спрашивают один и тот же код, а литерал
 * рядом — показания настоящих браузеров. Разойдутся — покраснеет тест, а не читатель.
 *
 * Модель сознательно узкая — ровно тот мир, что был на стенде:
 *   - кука всегда принадлежит `embed.test` (её ставит ответ `embed.test`), схема везде https;
 *   - верхний уровень — `top.test`, `top2.test` (чужие сайты) или `www.embed.test` (тот же сайт);
 *   - цель запроса — `embed.test` или его поддомен `api.embed.test`.
 * Чего здесь нет: `Max-Age`, `Path`, префиксов `__Host-`/`__Secure-`, исключения «Lax + POST»,
 * эвристик временного доступа Chromium. Их на стенде не снимали, и модель о них не говорит.
 */

export type EngineId = 'chromium' | 'chromium-restricted' | 'firefox' | 'webkit';
export type SameSite = 'Strict' | 'Lax' | 'None' | 'unset';
export type TopSite = 'top.test' | 'top2.test' | 'www.embed.test';
export type SetIn = 'first-party' | 'top.test' | 'top2.test';
export type Target = 'embed.test' | 'api.embed.test';
export type Kind = 'iframe' | 'subresource' | 'navigation';

export interface Engine {
  id: EngineId;
  label: string;
  /** Как движок понимает куку без `SameSite`. Снято: Chromium — `Lax`, Firefox и WebKit — `None`. */
  unsetSameSite: 'Lax' | 'None';
  /** Отвергает ли `SameSite=None` без `Secure`. Снято: WebKit 26.6 такую куку принимает. */
  noneNeedsSecure: boolean;
  /**
   * Что делает с неразделённой кукой в чужом контексте:
   * `allow` — отдаёт и принимает как есть; `block` — не отдаёт и не принимает;
   * `partition` — принимает, но кладёт в раздел сайта верхнего уровня (Total Cookie Protection).
   */
  thirdParty: 'allow' | 'block' | 'partition';
}

export const ENGINES: Engine[] = [
  { id: 'chromium', label: 'Chromium 153', unsetSameSite: 'Lax', noneNeedsSecure: true, thirdParty: 'allow' },
  {
    id: 'chromium-restricted',
    label: 'Chromium 153, сторонние ограничены',
    unsetSameSite: 'Lax',
    noneNeedsSecure: true,
    thirdParty: 'block',
  },
  { id: 'firefox', label: 'Firefox 155', unsetSameSite: 'None', noneNeedsSecure: true, thirdParty: 'partition' },
  { id: 'webkit', label: 'WebKit 26.6', unsetSameSite: 'None', noneNeedsSecure: false, thirdParty: 'block' },
];

export interface CookieSpec {
  sameSite: SameSite;
  secure: boolean;
  partitioned: boolean;
  /** `host` — без `Domain` (только `embed.test`); `site` — `Domain=embed.test` (и поддомены). */
  domain: 'host' | 'site';
  /** Где кука поставлена: на самом `embed.test` или во фрейме `embed.test` под чужим сайтом. */
  setIn: SetIn;
}

export interface RequestSpec {
  top: TopSite;
  target: Target;
  kind: Kind;
  /** Фрейм вызвал `requestStorageAccess()` и получил доступ; действует на запросы самого фрейма. */
  storageAccess: boolean;
}

export type Outcome = 'rejected' | 'sent' | 'blocked';

export interface Verdict {
  outcome: Outcome;
  /** Ключ раздела сохранённой куки: `null` — неразделённая, иначе сайт верхнего уровня. */
  partitionKey: string | null;
  /** Шаги рассуждения — по одному на проверку, в порядке проверки. */
  steps: string[];
}

/** Регистрируемый домен стенда: `www.embed.test` и `api.embed.test` — сайт `embed.test`. */
export function siteOf(host: string): string {
  const parts = host.split('.');
  return parts.slice(-2).join('.');
}

const EMBED = 'embed.test';

export function engineById(id: EngineId): Engine {
  const engine = ENGINES.find((e) => e.id === id);
  if (!engine) throw new Error(`Неизвестный движок: ${id}`);
  return engine;
}

export function decide(engineId: EngineId, cookie: CookieSpec, request: RequestSpec): Verdict {
  const engine = engineById(engineId);
  const steps: string[] = [];
  const reject = (why: string): Verdict => ({ outcome: 'rejected', partitionKey: null, steps: [...steps, why] });

  // ── 1. Примет ли браузер куку вообще ──────────────────────────────────────────────────
  if (cookie.partitioned && !cookie.secure) return reject('`Partitioned` без `Secure` — кука отвергнута при установке.');
  if (cookie.sameSite === 'None' && !cookie.secure && engine.noneNeedsSecure)
    return reject('`SameSite=None` без `Secure` — кука отвергнута при установке.');

  const effective = cookie.sameSite === 'unset' ? engine.unsetSameSite : cookie.sameSite;
  if (cookie.sameSite === 'unset') steps.push(`\`SameSite\` не указан — движок считает его \`${effective}\`.`);

  let partitionKey: string | null;
  if (cookie.setIn === 'first-party') {
    partitionKey = cookie.partitioned ? `https://${EMBED}` : null;
    steps.push(
      cookie.partitioned
        ? 'Поставлена на самом `embed.test` с `Partitioned` — раздел `https://embed.test`.'
        : 'Поставлена на самом `embed.test` — неразделённая.',
    );
  } else {
    // Фрейм embed.test под чужим сайтом: контекст установки — межсайтовый.
    if (effective !== 'None')
      return reject(`Кука \`SameSite=${effective}\` из межсайтового контекста не принимается.`);
    if (cookie.partitioned) {
      partitionKey = `https://${cookie.setIn}`;
      steps.push(`Поставлена во фрейме под \`${cookie.setIn}\` с \`Partitioned\` — раздел \`${partitionKey}\`.`);
    } else if (engine.thirdParty === 'allow') {
      partitionKey = null;
      steps.push('Поставлена во фрейме без `Partitioned` — сторонние куки разрешены, кука общая.');
    } else if (engine.thirdParty === 'partition') {
      partitionKey = `https://${cookie.setIn}`;
      steps.push(`Без \`Partitioned\`, но движок сам кладёт её в раздел \`${partitionKey}\`.`);
    } else {
      return reject('Неразделённая кука из стороннего контекста — сторонние куки заблокированы.');
    }
  }

  // ── 2. Подходит ли домен ─────────────────────────────────────────────────────────────
  const verdict = (outcome: Outcome, why: string): Verdict => ({ outcome, partitionKey, steps: [...steps, why] });
  if (cookie.domain === 'host' && request.target !== EMBED)
    return verdict('blocked', 'Кука без `Domain` принадлежит только `embed.test`, а запрос идёт на `api.embed.test`.');

  // ── 3. Раздел: чей сайт сейчас наверху ───────────────────────────────────────────────
  const initiatorSite = siteOf(request.top);
  const topSite = request.kind === 'navigation' ? EMBED : initiatorSite;
  const crossSite = initiatorSite !== EMBED;
  if (partitionKey !== null && partitionKey !== `https://${topSite}`)
    return verdict('blocked', `Наверху \`${topSite}\`, а кука лежит в разделе \`${partitionKey}\`.`);

  // ── 4. SameSite ──────────────────────────────────────────────────────────────────────
  if (crossSite) {
    if (request.kind === 'navigation') {
      if (effective === 'Strict') return verdict('blocked', 'Переход пришёл с чужого сайта — `Strict` не уходит даже на переходе.');
    } else if (effective !== 'None') {
      return verdict('blocked', `Запрос во встроенном контексте чужого сайта — \`${effective}\` не уходит.`);
    }
  }

  // ── 5. Сторонняя неразделённая кука ─────────────────────────────────────────────────
  if (partitionKey === null && crossSite && request.kind !== 'navigation') {
    if (request.storageAccess && request.kind === 'iframe')
      return verdict('sent', 'Фрейм получил доступ через Storage Access API — неразделённая кука уходит.');
    if (engine.thirdParty !== 'allow')
      return verdict('blocked', 'Неразделённая кука в стороннем контексте — движок её не отдаёт.');
  }

  if (!crossSite) return verdict('sent', 'Верхний уровень — тот же сайт, контекст не сторонний.');
  return verdict('sent', partitionKey ? 'Раздел совпал с сайтом наверху.' : 'Ограничений нет — кука уходит.');
}

/** Строка таблицы, снятой на стенде: комбинация и то, что ответил каждый движок. */
export interface MeasuredRow {
  id: string;
  /** В каком разделе темы стоит строка. */
  group: 'state' | 'chips' | 'attrs' | 'saa';
  cookieLabel: string;
  requestLabel: string;
  cookie: CookieSpec;
  request: RequestSpec;
  /** Что показал стенд: `rejected` — кука не сохранилась, `blocked` — сохранилась, но не ушла. */
  got: Record<EngineId, Outcome>;
  /** Какой скрипт стенда снял строку. */
  source: string;
}

/** Та же ли комбинация: сравнение по всем полям куки и запроса. */
export function sameCase(a: { cookie: CookieSpec; request: RequestSpec }, b: { cookie: CookieSpec; request: RequestSpec }): boolean {
  const keys = <T extends object>(o: T) => Object.keys(o) as (keyof T)[];
  return (
    keys(a.cookie).every((k) => a.cookie[k] === b.cookie[k]) && keys(a.request).every((k) => a.request[k] === b.request[k])
  );
}

/** Строка `Set-Cookie`, какой её отправил бы сервер `embed.test`. */
export function setCookieLine(cookie: CookieSpec, name = 'widget'): string {
  const parts = [`${name}=1`];
  if (cookie.domain === 'site') parts.push('Domain=embed.test');
  if (cookie.sameSite !== 'unset') parts.push(`SameSite=${cookie.sameSite}`);
  if (cookie.secure) parts.push('Secure');
  if (cookie.partitioned) parts.push('Partitioned');
  parts.push('Path=/');
  return `Set-Cookie: ${parts.join('; ')}`;
}
