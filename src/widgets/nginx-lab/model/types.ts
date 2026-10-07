/** location после разбора конфига: модификатор, путь, `proxy_pass` и запись как в конфиге. */
export interface Location {
  /** `''` — обычный префикс; `=`, `^~`, `~`, `~*`. */
  mod: '' | '=' | '^~' | '~' | '~*';
  path: string;
  pass: string | null;
  /** Как location записана в конфиге: `^~ /static/`, `~ \.json$`. */
  text: string;
}

/** Ответ `findLocation`: все промежуточные шаги выбора, чтобы демо могло их показать. */
export interface FoundLocation {
  /** Нормализованный путь — с ним сравниваются location. */
  path: string;
  /** Строка после `?` или `null`, если `?` не было. */
  args: string | null;
  exact: Location | null;
  prefixes: Location[];
  longest: Location | null;
  /** Куда nginx отправит `301`, если путь — это префикс location без последнего слеша. */
  redirect: string | null;
  /** Проверенные регулярки по порядку; проверка обрывается на первой совпавшей. */
  regexes: { location: Location; hit: boolean }[];
  location: Location | null;
  by: 'exact' | 'redirect' | '^~' | 'regex' | 'prefix' | 'none';
}

export interface LocationApi {
  parseLocations(conf: string): Location[];
  normalize(uri: string): { path: string; args: string | null };
  findLocation(locs: Location[], uri: string): FoundLocation;
  proxyPath(found: FoundLocation, uri: string): string | null;
}

/** Строка журнала стенда: что ответил настоящий nginx на адрес. */
export interface LocationProbe {
  uri: string;
  status: number;
  /** Location как она записана в конфиге (`text`). */
  location: string | null;
  /** Путь, который увидел бэкенд; `null` — запрос до бэкенда не дошёл. */
  backend: string | null;
  /** `Location` из ответа `301`. */
  redirect: string | null;
}

export interface ProbeGroup {
  id: string;
  label: string;
  uris: string[];
}

/** server после разбора конфига. */
export interface Server {
  index: number;
  port: number;
  isDefault: boolean;
  names: string[];
}

export interface ServerApi {
  parseServers(conf: string): Server[];
  findServer(
    servers: Server[],
    port: number,
    host: string | null,
  ): { server: Server; name: string | null; by: 'exact' | '*.' | '.*' | 'regex' | 'default_server' | 'first' };
}
