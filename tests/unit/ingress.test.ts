import { describe, expect, it } from 'vitest';
// `yaml` приходит в проект транзитивно — тем же путём, что в `delivery-configs.test.ts`.
// Пропадёт из `node_modules` — файл упадёт на импорте громко, а не пройдёт молча.
import { parse, parseAllDocuments } from 'yaml';
import * as t from '@/content/delivery/ingress/data';
import { flatPathIndex, loadRouter, ruleLines } from '@/widgets/ing-router/model/run';
import type { HTTPRouteSpec, IngressSpec } from '@/widgets/ing-router/model/types';

/**
 * Тема «Вход в кластер: Ingress и Gateway API».
 *
 * Кластера здесь нет и не будет — поэтому проверяется то, что проверить можно без него:
 *
 *  1. **Правила выбора бэкенда.** `ROUTER_CODE` — строка из темы, та же, что напечатана
 *     на странице и исполняется демо. Через неё прогоняются таблицы примеров из самих
 *     спецификаций (pathType и звёздочки — документация Ingress; `ReplacePrefixMatch` —
 *     справочник Gateway API), и ответ сверяется с литералом из `data.ts`. Расхождение
 *     функции со спецификацией или таблицы на странице с функцией — красный тест.
 *  2. **Листинги.** Каждый YAML разбирается (без дублей ключей), называет верные
 *     `apiVersion`/`kind`, а имена между листингами согласованы: класс, секрет, выпускающий
 *     сертификаты, вход и маршрут, пространство имён и метка, которую ждёт слушатель.
 *  3. **Таблицы «куда уйдёт запрос»** на странице пересчитываются той же функцией на тех же
 *     листингах: текст не может обещать `api:8080` там, где функция выбирает `web:80`.
 *  4. **Сценарии демо**: `spec` каждого совпадает с разбором его YAML (иначе читатель видит
 *     одно, а считается другое), а ответы на готовые запросы закреплены — на них опираются
 *     пояснения сценариев.
 */

const router = loadRouter(t.ROUTER_CODE);
const req = (url: string, headers?: string) => router.parseRequest(url, headers);
const svc = (name: string, port = 80) => ({ service: { name, port: { number: port } } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- разобранный YAML произвольной формы
type Doc = Record<string, any>;

function docs(code: string): Doc[] {
  return parseAllDocuments(code).map((d) => {
    expect(d.errors, `ошибка YAML:\n${code}`).toEqual([]);
    return d.toJS() as Doc;
  });
}

function one(code: string): Doc {
  const all = docs(code);
  expect(all).toHaveLength(1);
  return all[0];
}

describe('ROUTER_CODE: таблица pathType из документации Ingress', () => {
  it('таблица на странице собрана из тех же случаев', () => {
    expect(t.PATH_TABLE.rows).toHaveLength(t.PATH_EXAMPLES.length);
    // Строк в таблице документации 18; две из них («`/foo`, `/foo/`») раскрыты в два запроса.
    expect(t.PATH_EXAMPLES.length).toBe(20);
  });

  for (const e of t.PATH_EXAMPLES) {
    const label = `${e.paths.map((p) => `${p.type} ${p.path}`).join(' + ')} ← ${e.request}`;
    it(label, () => {
      const spec: IngressSpec = {
        defaultBackend: svc('default'),
        rules: [{ http: { paths: e.paths.map((p, i) => ({ path: p.path, pathType: p.type, backend: svc(`p${i}`) })) } }],
      };
      const r = router.routeIngress(spec, req(`https://any.example${e.request}`));
      expect(r.backend).toBe(`${e.want}:80`);
      // Вердикт на странице согласован с ответом: «нет» — ровно тогда, когда ушло в бэкенд по умолчанию.
      expect(e.verdict.startsWith('нет')).toBe(e.want === 'default');
    });
  }
});

describe('ROUTER_CODE: хосты', () => {
  for (const e of t.HOST_EXAMPLES) {
    it(`Ingress: ${e.rule} ← ${e.host}: ${e.match ? 'да' : 'нет'}`, () => {
      expect(router.ingressHost(e.rule, e.host) !== null).toBe(e.match);
      expect(e.verdict.startsWith('да')).toBe(e.match);
    });
  }

  it('Gateway API: звёздочка закрывает одну метку и больше, но не пустую', () => {
    expect(router.gatewayHost('*.foo.com', 'bar.foo.com')).toBe(true);
    expect(router.gatewayHost('*.foo.com', 'baz.bar.foo.com')).toBe(true);
    expect(router.gatewayHost('*.foo.com', 'foo.com')).toBe(false);
    expect(router.gatewayHost('shop.example.com', 'shop.example.com')).toBe(true);
  });

  it('разница двух звёздочек — та, что обещает тонкое место 07', () => {
    expect(router.ingressHost('*.example.com', 'eu.a.example.com')).toBeNull();
    expect(router.gatewayHost('*.example.com', 'eu.a.example.com')).toBe(true);
    expect(t.PITFALLS.find((p) => p.n === '07')?.d).toContain('eu.a.example.com');
  });
});

describe('ROUTER_CODE: ReplacePrefixMatch из справочника Gateway API', () => {
  it('таблица на странице собрана из тех же случаев', () => {
    expect(t.REWRITE_TABLE.rows).toHaveLength(t.REWRITE_EXAMPLES.length);
  });

  for (const e of t.REWRITE_EXAMPLES) {
    it(`${e.request} · ${e.prefix} → «${e.replace}» = ${e.result}`, () => {
      // Сначала префикс обязан совпасть — иначе переписывать нечего.
      expect(router.prefixMatches(e.prefix, e.request)).toBe(true);
      const out = router.rewritePath({ type: 'ReplacePrefixMatch', replacePrefixMatch: e.replace }, { value: e.prefix }, e.request);
      expect(out).toBe(e.result);
    });
  }
});

describe('ROUTER_CODE: порядок совпадений', () => {
  it('Ingress: длиннее путь — сильнее, порядок записи не важен', () => {
    const spec: IngressSpec = {
      rules: [{ http: { paths: [
        { path: '/', pathType: 'Prefix', backend: svc('root') },
        { path: '/a/b', pathType: 'Prefix', backend: svc('deep') },
        { path: '/a', pathType: 'Prefix', backend: svc('mid') },
      ] } }],
    };
    expect(router.routeIngress(spec, req('https://x.example/a/b/c')).backend).toBe('deep:80');
    expect(router.routeIngress(spec, req('https://x.example/a/bc')).backend).toBe('mid:80');
  });

  it('край: Prefix /foo/ против Exact /foo на /foo — Ingress выбирает префикс, HTTPRoute — Exact', () => {
    const ing: IngressSpec = {
      rules: [{ http: { paths: [
        { path: '/foo', pathType: 'Exact', backend: svc('exact') },
        { path: '/foo/', pathType: 'Prefix', backend: svc('prefix') },
      ] } }],
    };
    expect(router.routeIngress(ing, req('https://x.example/foo')).backend).toBe('prefix:80');

    const route: HTTPRouteSpec = {
      rules: [
        { matches: [{ path: { type: 'PathPrefix', value: '/foo/' } }], backendRefs: [{ name: 'prefix', port: 80 }] },
        { matches: [{ path: { type: 'Exact', value: '/foo' } }], backendRefs: [{ name: 'exact', port: 80 }] },
      ],
    };
    expect(router.routeHTTP(route, req('https://x.example/foo')).backends?.[0].name).toBe('exact:80');
    expect(t.ROUTE_ORDER_NOTE).toContain('`Prefix /foo/` против `Exact /foo`');
  });

  it('HTTPRoute: заголовки, потом параметры, потом порядок правил', () => {
    const route: HTTPRouteSpec = {
      rules: [
        { matches: [{ path: { type: 'PathPrefix', value: '/api' } }], backendRefs: [{ name: 'first', port: 80 }] },
        { matches: [{ path: { type: 'PathPrefix', value: '/api' } }], backendRefs: [{ name: 'second', port: 80 }] },
        { matches: [{ path: { type: 'PathPrefix', value: '/api' }, queryParams: [{ name: 'q', value: '1' }] }], backendRefs: [{ name: 'query', port: 80 }] },
        { matches: [{ path: { type: 'PathPrefix', value: '/api' }, headers: [{ name: 'X-A', value: 'b' }] }], backendRefs: [{ name: 'header', port: 80 }] },
      ],
    };
    const pick = (url: string, h?: string) => router.routeHTTP(route, req(url, h)).backends?.[0].name;
    expect(pick('https://x.example/api')).toBe('first:80');
    expect(pick('https://x.example/api?q=1')).toBe('query:80');
    expect(pick('https://x.example/api?q=1', 'x-a: b')).toBe('header:80');
    // Имя заголовка — без учёта регистра, значение — точно.
    expect(pick('https://x.example/api', 'X-A: B')).toBe('first:80');
  });

  it('HTTPRoute: ничего не совпало — 404, а не бэкенд по умолчанию', () => {
    const route: HTTPRouteSpec = { rules: [{ matches: [{ path: { type: 'Exact', value: '/a' } }], backendRefs: [{ name: 'a', port: 80 }] }] };
    expect(router.routeHTTP(route, req('https://x.example/b')).kind).toBe('none');
  });

  it('Ingress: ImplementationSpecific модель не угадывает, а говорит об этом', () => {
    const spec: IngressSpec = { rules: [{ http: { paths: [{ path: '/x(.*)', pathType: 'ImplementationSpecific', backend: svc('x') }] } }] };
    const r = router.routeIngress(spec, req('https://x.example/xyz'));
    expect(r.kind).toBe('none');
    expect(r.checked[0].ok).toBeNull();
    expect(r.why.join(' ')).toContain('ImplementationSpecific');
  });
});

describe('ROUTER_CODE: веса', () => {
  const canary = [
    { name: 'web-v1:80', weight: 90 },
    { name: 'web-v2:80', weight: 10 },
  ];

  it('на каждом полном круге доли точные, и раздача детерминирована', () => {
    for (const n of [10, 100, 1000]) {
      const s = router.spread(canary, n);
      expect(s.counts.map((c) => c.count)).toEqual([(n * 9) / 10, n / 10]);
      expect(router.spread(canary, n)).toEqual(s);
    }
  });

  it('вес 0 — ни одного запроса; 3:1 — три к одному', () => {
    expect(router.spread([{ name: 'a', weight: 1 }, { name: 'b', weight: 0 }], 7).counts.map((c) => c.count)).toEqual([7, 0]);
    expect(router.spread([{ name: 'a', weight: 3 }, { name: 'b', weight: 1 }], 20).counts.map((c) => c.count)).toEqual([15, 5]);
  });

  it('новая версия не получает запросы пачкой: между двумя её запросами — девять старых', () => {
    const order = router.spread(canary, 100).order;
    const at = order.flatMap((name, i) => (name === 'web-v2:80' ? [i] : []));
    expect(at.slice(1).map((i, k) => i - at[k])).toEqual(Array(9).fill(10));
  });

  it('в коде нет Math.random', () => {
    expect(t.ROUTER_CODE).not.toContain('Math.random');
  });
});

describe('листинги: разбираются и согласованы между собой', () => {
  const ingress = one(t.INGRESS_CODE);
  const ingressClass = one(t.INGRESS_CLASS_CODE);

  it('INGRESS_CODE и INGRESS_CLASS_CODE: API и класс', () => {
    expect([ingress.apiVersion, ingress.kind]).toEqual(['networking.k8s.io/v1', 'Ingress']);
    expect([ingressClass.apiVersion, ingressClass.kind]).toEqual(['networking.k8s.io/v1', 'IngressClass']);
    expect(ingress.spec.ingressClassName).toBe(ingressClass.metadata.name);
    expect(ingressClass.spec.controller).toBe('k8s.io/ingress-nginx');
    // Значение аннотации — строка: `true` без кавычек YAML сделал бы булевым.
    expect(ingressClass.metadata.annotations['ingressclass.kubernetes.io/is-default-class']).toBe('true');
  });

  it('INGRESS_CODE: хосты TLS покрыты правилами', () => {
    const hosts = ingress.spec.rules.map((r: Doc) => r.host);
    for (const tls of ingress.spec.tls) for (const h of tls.hosts) expect(hosts).toContain(h);
  });

  it('INGRESS_ROUTES: столбец «куда» пересчитан функцией по листингу', () => {
    for (const [request, where] of t.INGRESS_ROUTES.rows) {
      const url = request.replaceAll('`', '');
      expect(`\`${router.routeIngress(ingress.spec, req(url)).backend}\``, url).toBe(where);
    }
  });

  it('ANNOTATIONS_CODE: значения — строки, ключи — ingress-nginx, и каждый назван в таблице', () => {
    const m = one(t.ANNOTATIONS_CODE);
    const annotations = Object.entries(m.metadata.annotations as Record<string, unknown>);
    const table = t.ANNOTATIONS.rows.map((r) => r[0]).join(' ');
    for (const [key, value] of annotations) {
      expect(typeof value, key).toBe('string');
      expect(key.startsWith('nginx.ingress.kubernetes.io/')).toBe(true);
      expect(table).toContain(`\`${key.split('/')[1]}\``);
    }
    const path = m.spec.rules[0].http.paths[0];
    expect(path.pathType).toBe('ImplementationSpecific');
    expect(m.spec.ingressClassName).toBe(ingressClass.metadata.name);
  });

  it('CERT_CODE: выпускающий, аннотация и класс сходятся', () => {
    const [issuer, annotated] = docs(t.CERT_CODE);
    expect([issuer.apiVersion, issuer.kind]).toEqual(['cert-manager.io/v1', 'ClusterIssuer']);
    expect(annotated.metadata.annotations['cert-manager.io/cluster-issuer']).toBe(issuer.metadata.name);
    expect(annotated.metadata.name).toBe(ingress.metadata.name);
    expect(issuer.spec.acme.solvers[0].http01.ingress.ingressClassName).toBe(ingressClass.metadata.name);
  });

  const [gatewayClass, gateway] = docs(t.GATEWAY_CODE);
  const [namespace, route] = docs(t.HTTPROUTE_CODE);
  const redirect = one(t.REDIRECT_CODE);

  it('GATEWAY_CODE: класс и вход', () => {
    expect([gatewayClass.apiVersion, gatewayClass.kind]).toEqual(['gateway.networking.k8s.io/v1', 'GatewayClass']);
    expect([gateway.apiVersion, gateway.kind]).toEqual(['gateway.networking.k8s.io/v1', 'Gateway']);
    expect(gateway.spec.gatewayClassName).toBe(gatewayClass.metadata.name);
    const https = gateway.spec.listeners.find((l: Doc) => l.name === 'https');
    expect(https.tls.mode).toBe('Terminate');
    expect(https.tls.certificateRefs[0].name).toBeTruthy();
  });

  it('HTTPROUTE_CODE: маршрут цепляется к существующему слушателю и будет им принят', () => {
    expect([namespace.apiVersion, namespace.kind]).toEqual(['v1', 'Namespace']);
    expect([route.apiVersion, route.kind]).toEqual(['gateway.networking.k8s.io/v1', 'HTTPRoute']);
    expect(route.metadata.namespace).toBe(namespace.metadata.name);

    const parent = route.spec.parentRefs[0];
    expect(parent.name).toBe(gateway.metadata.name);
    expect(parent.namespace).toBe(gateway.metadata.namespace);
    const listener = gateway.spec.listeners.find((l: Doc) => l.name === parent.sectionName);
    expect(listener, `слушателя ${parent.sectionName} нет`).toBeTruthy();

    // Слушатель пускает маршруты по метке пространства имён — метка на месте.
    const want = listener.allowedRoutes.namespaces.selector.matchLabels;
    for (const [k, v] of Object.entries(want)) expect(namespace.metadata.labels[k]).toBe(v);
    // Хост маршрута укладывается в хост слушателя.
    for (const h of route.spec.hostnames) expect(router.gatewayHost(listener.hostname, h), h).toBe(true);
  });

  it('REDIRECT_CODE: маршрут из пространства входа на слушатель без allowedRoutes (по умолчанию Same)', () => {
    expect([redirect.apiVersion, redirect.kind]).toEqual(['gateway.networking.k8s.io/v1', 'HTTPRoute']);
    const listener = gateway.spec.listeners.find((l: Doc) => l.name === redirect.spec.parentRefs[0].sectionName);
    expect(listener.protocol).toBe('HTTP');
    expect(listener.allowedRoutes).toBeUndefined();
    expect(redirect.metadata.namespace).toBe(gateway.metadata.namespace);
  });

  it('GATEWAY_ROUTES: обещания таблицы пересчитаны функцией', () => {
    const r1 = router.routeHTTP(redirect.spec, req('http://shop.example.com/cart'));
    expect([r1.kind, r1.status, r1.location]).toEqual(['redirect', 301, 'https://shop.example.com/cart']);
    expect(t.GATEWAY_ROUTES.rows[0][1]).toContain('**301**');

    const r2 = router.routeHTTP(route.spec, req('https://shop.example.com/api/orders'));
    expect(r2.backends?.map((b) => b.name)).toEqual(['api:8080']);
    expect(r2.upstream?.path).toBe('/orders');
    expect(t.GATEWAY_ROUTES.rows[1][1]).toContain('`/orders`');

    const r3 = router.routeHTTP(route.spec, req('https://shop.example.com/catalog'));
    const s = router.spread(r3.backends ?? [], 100);
    expect(s.counts.map((c) => [c.name, c.count])).toEqual([['web-v1:80', 90], ['web-v2:80', 10]]);
    expect(t.GATEWAY_ROUTES.rows[2][1]).toContain('90 запросов из 100');
    expect(t.CANARY_NOTE).toContain('10 запросов из 100');
  });
});

describe('сценарии демо', () => {
  it('сценариев шесть, и их id уникальны', () => {
    expect(new Set(t.SCENARIOS.map((s) => s.id)).size).toBe(t.SCENARIOS.length);
    expect(t.SCENARIOS).toHaveLength(6);
  });

  for (const s of t.SCENARIOS) {
    it(`${s.id}: spec совпадает с разбором YAML, подсветка находит каждое правило`, () => {
      const m = one(s.yaml);
      expect(m.kind).toBe(s.kind === 'ingress' ? 'Ingress' : 'HTTPRoute');
      expect(m.apiVersion).toBe(s.kind === 'ingress' ? 'networking.k8s.io/v1' : 'gateway.networking.k8s.io/v1');
      expect(m.spec).toEqual(s.spec);

      const lines = ruleLines(s.yaml, s.kind);
      if (s.kind === 'ingress') {
        const rules = s.spec.rules ?? [];
        const total = rules.reduce((n, r) => n + (r.http?.paths.length ?? 0), 0);
        expect(lines).toHaveLength(total);
        const last = rules.length - 1;
        expect(flatPathIndex(s.spec, last, (rules[last].http?.paths.length ?? 1) - 1)).toBe(total - 1);
      } else {
        expect(lines).toHaveLength(s.spec.rules?.length ?? 0);
      }
    });
  }

  /**
   * Ответы на готовые запросы. На них опираются пояснения сценариев (`note`): поменяется
   * ответ — пояснение соврёт. Строка — имя бэкенда, `404`, или `301 → адрес`.
   */
  const EXPECT: Record<string, string[]> = {
    longest: ['api-v2:8080', 'api:8080', 'api:8080', 'web:80', '404'],
    exact: ['landing:80', 'spa:80', 'spa:80', 'web:80'],
    segments: ['docs:80', 'docs:80', 'web:80', 'web:80'],
    hosts: ['shop:80', 'tenant:80', 'web:80', 'web:80'],
    canary: ['web-v1:80 / web-v2:80', 'web-v2:80', 'web-v2:80', 'web-v1:80 / web-v2:80'],
    filters: ['301 → https://shop.example.com/shop/cart', 'api:8080', 'api-debug:8080', 'web:80', '404'],
  };

  for (const s of t.SCENARIOS) {
    it(`${s.id}: ответы на готовые запросы`, () => {
      const got = s.probes.map((p) => {
        const r0 = req(p.url, p.headers);
        if (s.kind === 'ingress') {
          const r = router.routeIngress(s.spec, r0);
          return r.backend ?? '404';
        }
        const r = router.routeHTTP(s.spec, r0);
        if (r.kind === 'redirect') return `${r.status} → ${r.location}`;
        if (r.kind === 'none') return '404';
        return (r.backends ?? []).map((b) => b.name).join(' / ');
      });
      expect(got).toEqual(EXPECT[s.id]);
    });
  }

  it('filters: бэкенд api видит путь без префикса /api', () => {
    const s = t.SCENARIOS.find((x) => x.id === 'filters')!;
    if (s.kind !== 'httproute') throw new Error('сценарий filters должен быть HTTPRoute');
    expect(router.routeHTTP(s.spec, req('https://shop.example.com/api/orders')).upstream?.path).toBe('/orders');
  });
});

describe('текст темы', () => {
  it('ROUTER_CODE называет обе спецификации и не содержит обратной косой (она теряется в шаблонной строке)', () => {
    expect(t.ROUTER_CODE).toContain('kubernetes.io/docs/concepts/services-networking/ingress/');
    expect(t.ROUTER_CODE).toContain('gateway-api.sigs.k8s.io/reference/spec/');
    expect(t.ROUTER_CODE.includes('\\')).toBe(false);
  });

  it('источники — внешние https-ссылки; внутренние ссылки темы ведут на существующие разделы', () => {
    for (const s of t.SOURCES) expect(s.href.startsWith('https://')).toBe(true);
    const text = JSON.stringify(t);
    for (const [, path] of text.matchAll(/\]\((\/[^)]+)\)/g)) {
      expect(path, 'адрес раздела вида /направление/тема/#sN или /направление/тема/').toMatch(/^\/[a-z]+\/[a-z0-9-]+\/(#s\d+)?$/);
    }
  });

  it('YAML-строки внутри листингов разбираются и отдельным parse (без дублей ключей)', () => {
    for (const code of [t.INGRESS_CODE, t.INGRESS_CLASS_CODE, t.ANNOTATIONS_CODE, t.REDIRECT_CODE]) {
      expect(() => parse(code, { uniqueKeys: true })).not.toThrow();
    }
  });
});
