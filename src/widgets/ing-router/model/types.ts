/**
 * Формы данных демо «куда уйдёт запрос».
 *
 * Поля манифестов названы так же, как в Kubernetes и Gateway API, — `spec` сценария
 * обязан совпадать с тем, что даёт разбор его YAML (это сверяет `tests/unit/ingress.test.ts`).
 * Поэтому здесь описана только та часть схем, которую читает модель.
 */

export interface ServiceBackend {
  service: { name: string; port: { number?: number; name?: string } };
}

export interface IngressPath {
  path: string;
  pathType: 'Exact' | 'Prefix' | 'ImplementationSpecific';
  backend: ServiceBackend;
}

export interface IngressRule {
  host?: string;
  http?: { paths: IngressPath[] };
}

export interface IngressSpec {
  ingressClassName?: string;
  defaultBackend?: ServiceBackend;
  tls?: { hosts: string[]; secretName: string }[];
  rules?: IngressRule[];
}

export interface PathModifier {
  type: 'ReplaceFullPath' | 'ReplacePrefixMatch';
  replaceFullPath?: string;
  replacePrefixMatch?: string;
}

export interface RouteMatch {
  path?: { type: 'Exact' | 'PathPrefix' | 'RegularExpression'; value: string };
  headers?: { name: string; value: string }[];
  queryParams?: { name: string; value: string }[];
}

export interface RouteFilter {
  type: 'RequestRedirect' | 'URLRewrite';
  requestRedirect?: {
    scheme?: string;
    hostname?: string;
    port?: number;
    statusCode?: number;
    path?: PathModifier;
  };
  urlRewrite?: { hostname?: string; path?: PathModifier };
}

export interface RouteRule {
  matches?: RouteMatch[];
  filters?: RouteFilter[];
  backendRefs?: { name: string; port: number; weight?: number }[];
}

export interface HTTPRouteSpec {
  parentRefs?: { name: string; namespace?: string; sectionName?: string }[];
  hostnames?: string[];
  rules?: RouteRule[];
}

/** Разобранный запрос: то, что модель знает о нём. */
export interface Request {
  scheme: string;
  host: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

/** Проверенный путь Ingress: совпал, не совпал или «решает контроллер» (`null`). */
export interface IngressCheck {
  rule: number;
  path: number;
  type: string;
  value: string;
  ok: boolean | null;
  backend: string;
}

export interface IngressResult {
  kind: 'backend' | 'default' | 'none';
  backend: string | null;
  via: IngressCheck | null;
  checked: IngressCheck[];
  why: string[];
}

/** Проверенное условие HTTPRoute: пустой `miss` — условие выполнено. */
export interface RouteCheck {
  rule: number;
  match: number;
  path: { type: string; value: string };
  headers: number;
  query: number;
  miss: string[];
}

export interface WeightedBackend {
  name: string;
  weight: number;
}

export interface RouteResult {
  kind: 'backend' | 'redirect' | 'none';
  status?: number;
  location?: string;
  backends?: WeightedBackend[];
  upstream?: { host: string; path: string };
  via?: RouteCheck;
  checked: RouteCheck[];
  why: string[];
}

export interface Spread {
  order: string[];
  counts: { name: string; weight: number; count: number }[];
}

/** То, что возвращает строка `ROUTER_CODE` из темы. */
export interface Router {
  parseRequest(url: string, headerLine?: string): Request;
  routeIngress(spec: IngressSpec, req: Request): IngressResult;
  routeHTTP(spec: HTTPRouteSpec, req: Request): RouteResult;
  spread(backends: WeightedBackend[], n: number): Spread;
  prefixMatches(prefix: string, path: string): boolean;
  rewritePath(mod: PathModifier | undefined, matched: { value: string }, path: string): string;
  ingressHost(ruleHost: string | undefined, host: string): { rank: number; why: string } | null;
  gatewayHost(pattern: string, host: string): boolean;
}

/** Готовый запрос сценария — чип под полем ввода. */
export interface Probe {
  url: string;
  /** Заголовки строкой `имя: значение; имя: значение`. */
  headers?: string;
}

interface ScenarioBase {
  id: string;
  label: string;
  /** Манифест, который видит читатель. Разбирается тестом и сверяется со `spec`. */
  yaml: string;
  probes: Probe[];
  /** Что разглядывать в сценарии. Строчная разметка. */
  note: string;
}

export type RouteScenario =
  | (ScenarioBase & { kind: 'ingress'; spec: IngressSpec })
  | (ScenarioBase & { kind: 'httproute'; spec: HTTPRouteSpec });
