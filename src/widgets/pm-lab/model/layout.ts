/**
 * Раскладка `node_modules` по двум правилам — подъёмом, как npm, и изолированно, как pnpm.
 *
 * Это не копия менеджеров, а их **правило размещения**, сведённое к десятку строк на каждого.
 * Проверяется оно не само собой: `tests/unit/package-managers.test.ts` гоняет те же сценарии,
 * что сняты настоящими npm 11.19.1 и pnpm 11.0.9 на локальном реестре (`TREE_RUNS` в данных
 * темы), и требует совпадения строка в строку. Расхождение — красный тест, а не находка читателя.
 *
 * Версии выбирает `SemverApi` — та же учебная строка, что стоит в теме над калькулятором.
 * Модуль чистый: ни DOM, ни Vue.
 *
 * Чего правило не умеет, и где это сказано в теме: `overrides`, `--force`, раскладку с уже
 * существующим lock-файлом (история установки меняет дерево — раздел «Разрешение и подъём»)
 * и вложенные peer-конфликты глубже корня.
 */
import type { SemverApi } from './semver';

export interface Manifest {
  deps?: Record<string, string>;
  peers?: Record<string, string>;
}

/** Реестр: имя → версия → манифест. */
export type Registry = Record<string, Record<string, Manifest>>;

/**
 * `declared` — объявлен приложением; `phantom` — лежит наверху, но приложение его не объявляло;
 * `nested` — вложен под чужой пакет; `duplicate` — та же версия лежит на диске не один раз;
 * `hidden` — поднят в скрытый `.pnpm/node_modules`, куда смотрят пакеты, но не приложение.
 */
export type Tag = 'declared' | 'phantom' | 'nested' | 'duplicate' | 'hidden';

export interface Entry {
  path: string;
  /** Настоящая папка пакета. */
  version?: string;
  /** Симлинк: куда ведёт, относительно своей папки. */
  link?: string;
  tags: Tag[];
}

export interface Layout {
  entries: Entry[];
  /** Установка не состоялась: npm отказывает целиком, дерева нет. */
  error?: { code: string; message: string };
  warnings: string[];
  /** Что получит `require(имя)` из кода приложения: версия или `null` — «не найден». */
  visible: Record<string, string | null>;
}

export interface NpmOptions {
  /** `--legacy-peer-deps`: peer-зависимости не ставятся и не проверяются — поведение npm 3–6. */
  legacyPeerDeps?: boolean;
}

/** Строка так, как её печатает съёмка: `путь версия` или `путь -> цель`. */
export function formatEntry(e: Entry): string {
  return e.link !== undefined ? `${e.path} -> ${e.link}` : `${e.path} ${e.version}`;
}

const byName = <T>(o: Record<string, T> | undefined) =>
  Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function pick(registry: Registry, semver: SemverApi, name: string, range: string): string | null {
  return semver.maxSatisfying(Object.keys(registry[name] ?? {}), range);
}

/* ─────────────────────────── npm: подъём ─────────────────────────── */

interface NpmNode {
  name: string;
  version: string;
  parent: NpmNode | null;
  children: Map<string, NpmNode>;
  depth: number;
  path: string;
}

/** Поиск, как у загрузчика Node: своя `node_modules`, потом папкой выше — до корня. */
function lookup(from: NpmNode, name: string): NpmNode | undefined {
  for (let n: NpmNode | null = from; n; n = n.parent) {
    const hit = n.children.get(name);
    if (hit) return hit;
  }
  return undefined;
}

export function layoutNpm(
  registry: Registry,
  rootDeps: Record<string, string>,
  semver: SemverApi,
  options: NpmOptions = {},
): Layout {
  const root: NpmNode = { name: '', version: '', parent: null, children: new Map(), depth: 0, path: '' };
  const queue: NpmNode[] = [root];
  const all: NpmNode[] = [];

  const place = (target: NpmNode, name: string, version: string) => {
    const node: NpmNode = {
      name,
      version,
      parent: target,
      children: new Map(),
      depth: target.depth + 1,
      path: `${target.path ? `${target.path}/` : ''}node_modules/${name}`,
    };
    target.children.set(name, node);
    queue.push(node);
    all.push(node);
  };

  // Пакеты обходятся по уровням, внутри уровня — по имени. Отсюда «кто первый встал наверх»:
  // первым приходит зависимость пакета, чьё имя раньше по алфавиту.
  while (queue.length) {
    queue.sort((x, y) => x.depth - y.depth || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    const node = queue.shift()!;
    const manifest: Manifest = node === root ? { deps: rootDeps } : registry[node.name][node.version];
    const edges = [
      ...byName(manifest.deps).map(([name, range]) => ({ name, range, peer: false })),
      ...(options.legacyPeerDeps ? [] : byName(manifest.peers).map(([name, range]) => ({ name, range, peer: true }))),
    ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const edge of edges) {
      const found = lookup(node, edge.name);
      if (found && semver.satisfies(found.version, edge.range)) continue; // дедупликация

      if (edge.peer) {
        // peer обязан лежать рядом с тем, кто его просит, — в той же node_modules.
        const home = node.parent!;
        const there = home.children.get(edge.name);
        if (there) {
          return {
            entries: [],
            error: {
              code: 'ERESOLVE',
              message: `peer ${edge.name}@"${edge.range}" from ${node.name}@${node.version} — а рядом уже лежит ${edge.name}@${there.version}`,
            },
            warnings: [],
            visible: {},
          };
        }
        const version = pick(registry, semver, edge.name, edge.range);
        if (!version) return notarget(edge.name, edge.range);
        place(home, edge.name, version);
        continue;
      }

      const version = pick(registry, semver, edge.name, edge.range);
      if (!version) return notarget(edge.name, edge.range);
      // Подъём: как можно выше, но не выше первого тёзки с неподходящей версией.
      let target = node;
      for (let t: NpmNode | null = node; t; t = t.parent) {
        if (t.children.has(edge.name)) break;
        target = t;
      }
      place(target, edge.name, version);
    }
  }

  const copies = new Map<string, number>();
  for (const n of all) copies.set(`${n.name}@${n.version}`, (copies.get(`${n.name}@${n.version}`) ?? 0) + 1);

  const entries: Entry[] = all
    .map((n) => {
      const tags: Tag[] = [];
      if (n.depth === 1) tags.push(n.name in rootDeps ? 'declared' : 'phantom');
      else tags.push('nested');
      if ((copies.get(`${n.name}@${n.version}`) ?? 0) > 1) tags.push('duplicate');
      return { path: n.path, version: n.version, tags };
    })
    .sort((a, b) => (formatEntry(a) < formatEntry(b) ? -1 : 1));

  const visible: Record<string, string | null> = {};
  for (const name of Object.keys(registry).sort()) visible[name] = root.children.get(name)?.version ?? null;

  return { entries, warnings: [], visible };
}

function notarget(name: string, range: string): Layout {
  return {
    entries: [],
    error: { code: 'ETARGET', message: `No matching version found for ${name}@${range}` },
    warnings: [],
    visible: {},
  };
}

/* ─────────────────────────── pnpm: изоляция ─────────────────────────── */

interface PnpmPkg {
  id: string;
  name: string;
  version: string;
  /** Имя зависимости → id пакета, на который ведёт ссылка. */
  links: Map<string, string>;
}

export function layoutPnpm(registry: Registry, rootDeps: Record<string, string>, semver: SemverApi): Layout {
  const pkgs = new Map<string, PnpmPkg>();
  const warnings: string[] = [];
  /** Первый пакет каждого имени в порядке обхода — его pnpm и поднимет в скрытую папку. */
  const firstByName = new Map<string, string>();
  const publicLinks = new Map<string, string>();

  // Обход по уровням, как у npm: сначала зависимости приложения, потом их зависимости.
  // Каждый пакет получает **свою** версию каждой зависимости — старшую подходящую.
  // peer берётся у того, кто зависит от пакета; нет там — ставится сам (autoInstallPeers).
  type Job = { name: string; version: string; parentDeps: Map<string, string> };

  const rootResolved = new Map<string, string>(); // имя → версия у приложения
  for (const [name, range] of byName(rootDeps)) {
    const v = pick(registry, semver, name, range);
    if (!v) return notarget(name, range);
    rootResolved.set(name, v);
  }

  let level: { job: Job; attach: (id: string) => void }[] = [...rootResolved].map(([name, version]) => ({
    job: { name, version, parentDeps: rootResolved },
    attach: (id: string) => publicLinks.set(name, id),
  }));

  while (level.length) {
    const next: typeof level = [];
    for (const { job, attach } of level) {
      const manifest = registry[job.name][job.version];
      const ownDeps = new Map<string, string>();
      for (const [dep, range] of byName(manifest.deps)) {
        const v = pick(registry, semver, dep, range);
        if (!v) return notarget(dep, range);
        ownDeps.set(dep, v);
      }
      const peerIds: string[] = [];
      const peerVersions = new Map<string, string>();
      for (const [peer, range] of byName(manifest.peers)) {
        let v = job.parentDeps.get(peer);
        if (v && !semver.satisfies(v, range)) {
          warnings.push(`${job.name}@${job.version}: peer ${peer}@"${range}", а у зависящего от него — ${peer}@${v}`);
        }
        if (!v) {
          v = pick(registry, semver, peer, range) ?? undefined;
          if (!v) return notarget(peer, range);
        }
        peerVersions.set(peer, v);
        peerIds.push(`${peer}@${v}`);
      }
      // Пакет с peer — это пакет **вместе с** версией peer: у двух хозяев две разные папки.
      const id = [`${job.name}@${job.version}`, ...peerIds].join('_');
      attach(id);
      if (!firstByName.has(job.name)) firstByName.set(job.name, id);
      if (pkgs.has(id)) continue;

      const pkg: PnpmPkg = { id, name: job.name, version: job.version, links: new Map() };
      pkgs.set(id, pkg);
      const children = [
        ...[...ownDeps].map(([name, version]) => ({ name, version })),
        ...[...peerVersions].map(([name, version]) => ({ name, version })),
      ].sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const child of children) {
        next.push({
          job: { name: child.name, version: child.version, parentDeps: ownDeps },
          attach: (childId: string) => pkg.links.set(child.name, childId),
        });
      }
    }
    level = next;
  }

  const entries: Entry[] = [];
  for (const [name, id] of publicLinks) {
    entries.push({ path: `node_modules/${name}`, link: `.pnpm/${id}/node_modules/${name}`, tags: ['declared'] });
  }
  const dirsPerVersion = new Map<string, number>();
  for (const pkg of pkgs.values()) {
    const key = `${pkg.name}@${pkg.version}`;
    dirsPerVersion.set(key, (dirsPerVersion.get(key) ?? 0) + 1);
  }
  for (const pkg of pkgs.values()) {
    const dup = (dirsPerVersion.get(`${pkg.name}@${pkg.version}`) ?? 0) > 1;
    entries.push({
      path: `node_modules/.pnpm/${pkg.id}/node_modules/${pkg.name}`,
      version: pkg.version,
      tags: dup ? ['duplicate'] : [],
    });
    for (const [dep, target] of pkg.links) {
      entries.push({
        path: `node_modules/.pnpm/${pkg.id}/node_modules/${dep}`,
        link: `../../${target}/node_modules/${dep}`,
        tags: [],
      });
    }
  }
  // Скрытый подъём (hoistPattern '*'): всё, чего нет наверху, — в .pnpm/node_modules.
  // Туда заглядывают пакеты, когда ищут необъявленное; приложение туда не смотрит.
  for (const [name, id] of firstByName) {
    if (publicLinks.has(name)) continue;
    entries.push({ path: `node_modules/.pnpm/node_modules/${name}`, link: `../${id}/node_modules/${name}`, tags: ['hidden'] });
  }
  entries.sort((a, b) => (formatEntry(a) < formatEntry(b) ? -1 : 1));

  const visible: Record<string, string | null> = {};
  for (const name of Object.keys(registry).sort()) {
    const id = publicLinks.get(name);
    visible[name] = id ? pkgs.get(id)!.version : null;
  }

  return { entries, warnings, visible };
}
