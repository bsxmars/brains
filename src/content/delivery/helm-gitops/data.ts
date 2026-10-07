import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Один манифест на много окружений: Helm, Kustomize и GitOps».
 *
 * ── Что чем проверено ────────────────────────────────────────────────────────────────
 *
 * Ни `kubectl`, ни `kustomize`, ни `helm`, ни кластера в этом заходе не было, и сети тоже.
 * Поэтому тема держится на двух опорах, и у каждого утверждения написано, на какой.
 *
 * 1. **Правила слияния — кодом.** Учебная модель лежит строками ниже (`MODEL_PARTS`)
 *    и собирается `new Function` — в демо (`widgets/kz-envs/model/run.ts`) и в тесте
 *    `tests/unit/helm-gitops.test.ts`. Копии нет. Через модель тест прогоняет таблицы
 *    случаев **из документации**, каждая со ссылкой:
 *      — `SMP_CASES` — strategic merge patch: примеры страницы «Update API Objects in Place
 *        Using kubectl patch» (kubernetes.io) и директивы из описания strategic merge patch
 *        (kubernetes/community); ключи слияния — теги `patchMergeKey` справочника API;
 *      — `JSON_MERGE_CASES` — все примеры приложения A из RFC 7386;
 *      — `JSON_PATCH_CASES` — примеры приложения A из RFC 6902;
 *      — `IMAGE_CASES` — пример трансформера `images` из справочника kustomize;
 *      — `VALUES_CASES` и `SET_CASES` — порядок values и синтаксис `--set` из документации Helm;
 *      — `TEMPLATE_CASES` — поведение `default`, `quote`, `toYaml | nindent`, `with`, обрезки
 *        пробелов по документации Helm, Sprig и `text/template`.
 *    ⚠️ Таблицы перенесены без доступа к сети в этом заходе: сверить их с живыми страницами
 *    заново было нечем. Разойдётся строка с документацией — править литерал и смотреть,
 *    краснеет ли модель.
 * 2. **Всё остальное — по документации, не прогоном**: поведение Argo CD и Flux (интервалы,
 *    `prune`, `selfHeal`, рендер Helm через `helm template`), хранение релизов Helm в Secret,
 *    хуки, Sealed Secrets и SOPS, устаревание `commonLabels` и `patchesStrategicMerge`.
 *    Листинги разбираются тестом как YAML и сверяются между собой по именам, но в кластер
 *    не применялись. Вывод `helm history` — форма, а не снятый вывод; так и помечено.
 *
 * ── Чего модель не умеет, и это сказано в теме ───────────────────────────────────────
 *
 *   — хеш в имени ConfigMap: kustomize берёт SHA-256, модель — FNV-1a. Буквы суффикса
 *     будут другими, свойство то же: другое содержимое — другое имя;
 *   — порядок элементов после strategic merge: модель дописывает новые в конец;
 *   — `--set` с индексами списков (`a[0].b=1`), `--set-file`, `--set-json`, сабчарты;
 *   — go-template целиком: только конструкции, которыми пользуется чарт темы;
 *   — kustomize целиком: только поля, которыми пользуются слои темы.
 */

// ─────────────────────────────────────────────────────────────────────────────────────
// Учебная модель. Демо и тест исполняют именно эти строки.
// ─────────────────────────────────────────────────────────────────────────────────────

/** Служебная часть: разбор и печать YAML. В теме не печатается; тест сверяет её с пакетом `yaml`. */
export const YAML_CODE = String.raw`
// Служебная часть модели: разбор и печать YAML. Только то подмножество, которым
// написаны листинги темы: блочные словари и списки, строки в кавычках и без,
// числа, true/false/null, короткие [..] и {..}, комментарии, несколько документов.
// Что с пакетом yaml она разбирает одинаково — проверяет тест, на каждом листинге.

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s:\[{,-]/.test(line[i - 1])) quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?(0|[1-9]\d*)$/.test(s)) return Number(s);
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(s)) return Number(s);
  if (s[0] === '"') return JSON.parse(s);
  if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
  if (s[0] === '[' || s[0] === '{') return flow(s);
  return s;
}

// Короткая запись: [a, b] и { name: web, port: { number: 80 } }.
function flow(src) {
  let i = 0;
  const skip = () => { while (/\s/.test(src[i] || '')) i++; };
  function value() {
    skip();
    if (src[i] === '[') {
      i++;
      const out = [];
      skip();
      if (src[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value());
        skip();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ']') { i++; return out; }
        throw new Error('YAML: ожидалась ] в ' + src);
      }
    }
    if (src[i] === '{') {
      i++;
      const out = {};
      skip();
      if (src[i] === '}') { i++; return out; }
      for (;;) {
        skip();
        const at = src.indexOf(':', i);
        const raw = src.slice(i, at).trim();
        const key = raw[0] === '"' || raw[0] === "'" ? scalar(raw) : raw;
        i = at + 1;
        if (key in out) throw new Error('YAML: ключ ' + key + ' повторяется');
        out[key] = value();
        skip();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === '}') { i++; return out; }
        throw new Error('YAML: ожидалась } в ' + src);
      }
    }
    const start = i;
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i++];
      while (i < src.length && src[i] !== q) i++;
      i++;
    } else {
      while (i < src.length && !/[,\]}]/.test(src[i])) i++;
    }
    return scalar(src.slice(start, i));
  }
  const out = value();
  skip();
  if (i !== src.length) throw new Error('YAML: лишнее после ' + src.slice(0, i));
  return out;
}

// Ключ отделяется двоеточием, за которым пробел или конец строки, — вне кавычек.
function splitKey(text) {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { if (i === 0) quote = ch; continue; }
    if (ch === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
      const key = text.slice(0, i).trim();
      return [key[0] === '"' || key[0] === "'" ? scalar(key) : key, text.slice(i + 1).trim()];
    }
  }
  return null;
}

function parseDoc(lines) {
  let pos = 0;
  const indentOf = (l) => l.search(/\S/);

  function block(indent) {
    const text = lines[pos].slice(indent);
    // Документ целиком в короткой записи: {a: 1} или [a, b] — одной строкой.
    if (text[0] === '{' || text[0] === '[') {
      pos++;
      return flow(text);
    }
    return text === '-' || text.startsWith('- ') ? seq(indent) : map(indent);
  }

  function seq(indent) {
    const out = [];
    while (pos < lines.length && indentOf(lines[pos]) === indent && /^-( |$)/.test(lines[pos].slice(indent))) {
      const rest = lines[pos].slice(indent + 1);
      const inner = rest.search(/\S/);
      if (inner < 0) {
        pos++;
        out.push(pos < lines.length && indentOf(lines[pos]) > indent ? block(indentOf(lines[pos])) : null);
      } else if (splitKey(rest.trim()) || /^-( |$)/.test(rest.trim())) {
        // «- name: app» — словарь, первый ключ которого стоит на той же строке, что и дефис.
        const at = indent + 1 + inner;
        lines[pos] = ' '.repeat(at) + rest.trim();
        out.push(block(at));
      } else {
        out.push(scalar(rest));
        pos++;
      }
    }
    return out;
  }

  function map(indent) {
    const out = {};
    while (pos < lines.length && indentOf(lines[pos]) === indent) {
      const text = lines[pos].slice(indent);
      if (/^-( |$)/.test(text)) break;
      const kv = splitKey(text);
      if (!kv) throw new Error('YAML: не пара «ключ: значение»: ' + text);
      const [key, rest] = kv;
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new Error('YAML: ключ ' + key + ' повторяется');
      pos++;
      if (rest === '|' || rest === '|-') {
        const body = [];
        const deeper = pos < lines.length ? indentOf(lines[pos]) : indent;
        while (pos < lines.length && indentOf(lines[pos]) > indent) body.push(lines[pos++].slice(deeper));
        out[key] = body.join('\n') + (rest === '|' ? '\n' : '');
      } else if (rest !== '') {
        out[key] = scalar(rest);
      } else if (pos < lines.length && indentOf(lines[pos]) > indent) {
        out[key] = block(indentOf(lines[pos]));
      } else if (pos < lines.length && indentOf(lines[pos]) === indent && /^-( |$)/.test(lines[pos].slice(indent))) {
        out[key] = seq(indent);
      } else {
        out[key] = null;
      }
    }
    return out;
  }

  if (lines.length === 0) return null;
  const out = block(indentOf(lines[0]));
  if (pos !== lines.length) throw new Error('YAML: не разобрана строка «' + lines[pos] + '»');
  return out;
}

function parseYaml(text) {
  const docs = [[]];
  for (const raw of text.split('\n')) {
    if (/^---\s*$/.test(raw)) { docs.push([]); continue; }
    const line = stripComment(raw);
    if (line.trim() !== '') docs[docs.length - 1].push(line);
  }
  return docs.filter((d) => d.length > 0).map(parseDoc);
}

// Печать. Строку, которую YAML прочёл бы как число, логическое или пусто, берём в кавычки.
function printScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'string') return String(v);
  const risky =
    v === '' ||
    /^(true|false|null|~|yes|no|on|off|y|n)$/i.test(v) ||
    /^[-+]?(\d[\d_]*)?(\.\d*)?([eE][-+]?\d+)?$/.test(v) ||
    /^[\s\-?:,\[\]{}#&*!|>'"%@\x60]/.test(v) ||
    /: |\s#|\s$/.test(v);
  return risky ? JSON.stringify(v) : v;
}

// Списки под ключом — без отступа, как печатают kubectl, kustomize и helm.
function dumpYaml(value, opts) {
  const sortKeys = Boolean(opts && opts.sortKeys);
  const out = [];
  const keys = (o) => (sortKeys ? Object.keys(o).sort() : Object.keys(o));
  const flat = (v) => !(isMap(v) && Object.keys(v).length) && !(Array.isArray(v) && v.length);
  const inline = (v) => (isMap(v) ? '{}' : Array.isArray(v) ? '[]' : printScalar(v));

  function node(v, pad) {
    if (isMap(v)) {
      for (const k of keys(v)) {
        const x = v[k];
        if (flat(x)) out.push(pad + printScalar(k) + ': ' + inline(x));
        else if (Array.isArray(x)) { out.push(pad + printScalar(k) + ':'); node(x, pad); }
        else { out.push(pad + printScalar(k) + ':'); node(x, pad + '  '); }
      }
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (flat(item)) { out.push(pad + '- ' + inline(item)); continue; }
        const start = out.length;
        node(item, pad + '  ');
        out[start] = pad + '- ' + out[start].slice(pad.length + 2);
      }
    } else {
      out.push(pad + printScalar(v));
    }
  }
  if (flat(value)) return inline(value);
  node(value, '');
  return out.join('\n');
}

function dumpAll(docs) {
  return docs.map((d) => dumpYaml(d)).join('\n---\n');
}
`;

/** Три вида патча. Печатается в разделе «Патчи». */
export const MERGE_CODE = String.raw`
// Учебная модель: как патч ложится на манифест. Три способа из документации:
//   strategic merge — kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/
//                     и описание директив: github.com/kubernetes/community → strategic-merge-patch.md
//   JSON merge patch — RFC 7386
//   JSON patch       — RFC 6902
// Демо и тест темы исполняют именно этот текст.

// Какие списки сливаются по ключу, знает не патч, а схема типа — это теги
// patchStrategy:"merge" и patchMergeKey в справочнике API Kubernetes.
// Список без тега заменяется целиком (так устроены, например, tolerations и args).
const MERGE_KEYS = {
  containers: 'name',
  initContainers: 'name',
  env: 'name',
  volumes: 'name',
  volumeMounts: 'mountPath',
  imagePullSecrets: 'name',
};

function mergeKey(path, kind) {
  const field = path[path.length - 1];
  if (field === 'ports') {
    const parent = path[path.length - 2];
    if (parent === 'containers' || parent === 'initContainers') return 'containerPort';
    if (kind === 'Service') return 'port';
    return null;
  }
  return MERGE_KEYS[field] || null;
}

const directive = (v, name) => isMap(v) && v.$patch === name;

function withoutDirectives(v) {
  if (Array.isArray(v)) return v.filter((x) => !directive(x, 'delete') && !directive(x, 'replace')).map(withoutDirectives);
  if (!isMap(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (k !== '$patch' && k !== '$retainKeys' && x !== null) out[k] = withoutDirectives(x);
  return out;
}

// Strategic merge patch. Словари сливаются вглубь, скаляр заменяется, null удаляет ключ.
// Список сливается по ключу, если он у поля есть, иначе заменяется целиком.
function strategicMerge(base, patch, kind, path) {
  path = path || [];
  if (!isMap(patch)) return clone(patch);
  if (directive(patch, 'delete')) return undefined;
  if (directive(patch, 'replace')) return withoutDirectives(patch);
  const out = isMap(base) ? clone(base) : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '$patch' || k === '$retainKeys') continue;
    if (v === null) delete out[k];
    else if (Array.isArray(v)) out[k] = mergeList(out[k], v, kind, path.concat(k));
    else if (isMap(v)) {
      const merged = strategicMerge(out[k], v, kind, path.concat(k));
      if (merged === undefined) delete out[k];
      else out[k] = merged;
    } else out[k] = v;
  }
  // $retainKeys: после слияния остаются только перечисленные ключи.
  if (Array.isArray(patch.$retainKeys)) {
    for (const k of Object.keys(out)) if (!patch.$retainKeys.includes(k)) delete out[k];
  }
  return out;
}

function mergeList(base, patch, kind, path) {
  const key = mergeKey(path, kind);
  // Элемент { $patch: replace } — «этот список заменить целиком».
  if (!key || !Array.isArray(base) || patch.some((x) => directive(x, 'replace'))) {
    return withoutDirectives(patch);
  }
  const out = base.map(clone);
  for (const item of patch) {
    const at = out.findIndex((x) => isMap(x) && isMap(item) && x[key] === item[key]);
    if (directive(item, 'delete')) {
      if (at >= 0) out.splice(at, 1);
    } else if (at >= 0) {
      out[at] = strategicMerge(out[at], item, kind, path);
    } else {
      // Нового элемента в базе не было — дописываем. Порядок элементов в настоящем
      // strategic merge может быть другим; для контейнеров и переменных он не важен.
      out.push(withoutDirectives(item));
    }
  }
  return out;
}

// JSON merge patch (RFC 7386): то же слияние словарей, но о списках он не знает ничего —
// любой список в патче заменяет список в базе целиком. Директив $patch у него нет.
function jsonMergePatch(target, patch) {
  if (!isMap(patch)) return clone(patch);
  const out = isMap(target) ? clone(target) : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = jsonMergePatch(out[k], v);
  }
  return out;
}

// JSON patch (RFC 6902): список операций по адресам вида /spec/rules/0/host.
function jsonPatch(doc, ops) {
  let out = clone(doc);
  for (const op of ops) {
    const parts = op.path === '' ? [] : op.path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (parts.length === 0) {
      if (op.op === 'test') { if (!same(out, op.value)) throw new Error('test: не совпало'); continue; }
      out = clone(op.value);
      continue;
    }
    const last = parts[parts.length - 1];
    let parent = out;
    for (const p of parts.slice(0, -1)) {
      const next = Array.isArray(parent) ? parent[Number(p)] : isMap(parent) ? parent[p] : undefined;
      if (next === undefined) throw new Error(op.op + ': нет пути ' + op.path);
      parent = next;
    }
    const isList = Array.isArray(parent);
    const index = last === '-' ? (isList ? parent.length : NaN) : Number(last);
    const exists = isList ? index >= 0 && index < parent.length : isMap(parent) && Object.prototype.hasOwnProperty.call(parent, last);
    if (op.op === 'add') {
      if (isList) {
        if (!(index >= 0 && index <= parent.length)) throw new Error('add: индекс вне списка ' + op.path);
        parent.splice(index, 0, clone(op.value));
      } else if (isMap(parent)) parent[last] = clone(op.value);
      else throw new Error('add: нет пути ' + op.path);
    } else if (op.op === 'remove' || op.op === 'replace') {
      if (!exists) throw new Error(op.op + ': нет пути ' + op.path);
      if (op.op === 'remove') { if (isList) parent.splice(index, 1); else delete parent[last]; }
      else parent[isList ? index : last] = clone(op.value);
    } else if (op.op === 'test') {
      if (!exists || !same(parent[isList ? index : last], op.value)) throw new Error('test: не совпало ' + op.path);
    } else {
      throw new Error('операция ' + op.op + ' в модели не поддержана');
    }
  }
  return out;
}
`;

/** kustomize build — поля слоёв темы. В теме не печатается. */
export const KUSTOMIZE_CODE = String.raw`
// Учебная модель kustomize build: только поля, которыми пользуются листинги темы, —
// resources, namespace, namePrefix, commonLabels, images, configMapGenerator, patches.
// Порядок шагов — патчи, затем имена, метки и образы, затем хеш генераторов — выбран так,
// чтобы патчи находили объекты по исходным именам. Справочник полей:
// kubectl.docs.kubernetes.io/references/kustomize/kustomization/

const dirOf = (p) => p.split('/').slice(0, -1).join('/');

function joinPath(dir, rel) {
  const out = dir ? dir.split('/') : [];
  for (const part of rel.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

function readFile(files, path) {
  if (!(path in files)) throw new Error('нет файла ' + path);
  return files[path];
}

// Суффикс из содержимого. В kustomize это SHA-256 от JSON-представления объекта,
// перекодированный в 10 символов; здесь — FNV-1a, поэтому буквы будут другие.
// Свойство то же: другое содержимое — другое имя.
function contentHash(obj) {
  const text = JSON.stringify({ kind: obj.kind, name: obj.metadata.name, data: sortKeys(obj.data || {}) });
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 2246822519) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).padEnd(10, 'k').slice(0, 10);
}

function sortKeys(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

function literalsToData(literals) {
  const data = {};
  for (const line of literals || []) {
    const at = line.indexOf('=');
    data[line.slice(0, at)] = line.slice(at + 1);
  }
  return data;
}

// Образ «имя[:тег][@digest]». Двоеточие после последнего «/» — тег, до — порт реестра.
function splitImage(image) {
  const at = image.indexOf('@');
  const digest = at >= 0 ? image.slice(at + 1) : '';
  const rest = at >= 0 ? image.slice(0, at) : image;
  const colon = rest.lastIndexOf(':');
  const tagged = colon > rest.lastIndexOf('/');
  return { name: tagged ? rest.slice(0, colon) : rest, tag: tagged ? rest.slice(colon + 1) : '', digest };
}

function setImage(image, rules) {
  const img = splitImage(image);
  const rule = (rules || []).find((r) => r.name === img.name);
  if (!rule) return image;
  const name = rule.newName || img.name;
  if (rule.digest) return name + '@' + rule.digest;
  if (rule.newTag) return name + ':' + rule.newTag;
  return name + (img.tag ? ':' + img.tag : '') + (img.digest ? '@' + img.digest : '');
}

function podSpecOf(obj) {
  return obj.spec && obj.spec.template && obj.spec.template.spec;
}

function eachContainer(obj, fn) {
  const pod = podSpecOf(obj);
  if (!pod) return;
  for (const list of [pod.initContainers, pod.containers]) for (const c of list || []) fn(c);
}

// Ссылки на ConfigMap и Service, которые kustomize переписывает вслед за именем.
function renameRefs(obj, kind, from, to) {
  if (kind === 'ConfigMap') {
    eachContainer(obj, (c) => {
      for (const src of c.envFrom || []) if (src.configMapRef && src.configMapRef.name === from) src.configMapRef.name = to;
      for (const e of c.env || []) {
        const ref = e.valueFrom && e.valueFrom.configMapKeyRef;
        if (ref && ref.name === from) ref.name = to;
      }
    });
    const pod = podSpecOf(obj);
    for (const v of (pod && pod.volumes) || []) if (v.configMap && v.configMap.name === from) v.configMap.name = to;
  }
  if (kind === 'Service' && obj.kind === 'Ingress') {
    for (const rule of (obj.spec && obj.spec.rules) || []) {
      for (const p of (rule.http && rule.http.paths) || []) {
        if (p.backend.service && p.backend.service.name === from) p.backend.service.name = to;
      }
    }
  }
}

function addLabels(obj, labels) {
  obj.metadata.labels = Object.assign({}, obj.metadata.labels, labels);
  // commonLabels доходят и до селекторов — отсюда их главная ловушка.
  if (obj.kind === 'Service') obj.spec.selector = Object.assign({}, obj.spec.selector, labels);
  if (podSpecOf(obj)) {
    obj.spec.selector.matchLabels = Object.assign({}, obj.spec.selector.matchLabels, labels);
    obj.spec.template.metadata.labels = Object.assign({}, obj.spec.template.metadata.labels, labels);
  }
}

function findTarget(objs, kind, name) {
  const i = objs.findIndex((o) => o.kind === kind && o.metadata.name === name);
  if (i < 0) throw new Error('патч не нашёл ' + kind + '/' + name);
  return i;
}

// mode: 'strategic' — как kustomize; 'replace' — списки заменяются целиком (JSON merge patch).
function kustomizeBuild(files, dir, mode) {
  const k = parseYaml(readFile(files, joinPath(dir, 'kustomization.yaml')))[0];
  let objs = [];
  let maps = [];

  for (const res of k.resources || []) {
    const path = joinPath(dir, res);
    if (joinPath(path, 'kustomization.yaml') in files) {
      const sub = kustomizeBuild(files, path, mode);
      objs = objs.concat(sub.objs);
      maps = maps.concat(sub.maps);
    } else {
      objs = objs.concat(parseYaml(readFile(files, path)));
    }
  }

  for (const gen of k.configMapGenerator || []) {
    const data = literalsToData(gen.literals);
    const at = maps.findIndex((m) => m.origin === gen.name);
    if (gen.behavior === 'merge' || gen.behavior === 'replace') {
      if (at < 0) throw new Error('configMapGenerator: нечего сливать с ' + gen.name);
      maps[at].obj.data = gen.behavior === 'merge' ? Object.assign({}, maps[at].obj.data, data) : data;
    } else {
      maps.push({ origin: gen.name, obj: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: gen.name }, data } });
    }
  }

  for (const p of k.patches || []) {
    for (const patch of parseYaml(readFile(files, joinPath(dir, p.path)))) {
      if (Array.isArray(patch)) {
        const i = findTarget(objs, p.target.kind, p.target.name);
        objs[i] = jsonPatch(objs[i], patch);
      } else {
        const i = findTarget(objs, patch.kind, patch.metadata.name);
        objs[i] = mode === 'replace' ? jsonMergePatch(objs[i], patch) : strategicMerge(objs[i], patch, patch.kind);
      }
    }
  }

  const all = () => objs.concat(maps.map((m) => m.obj));
  if (k.namePrefix) {
    for (const o of all()) {
      const from = o.metadata.name;
      o.metadata.name = k.namePrefix + from;
      for (const other of objs) renameRefs(other, o.kind, from, o.metadata.name);
    }
  }
  if (k.namespace) for (const o of all()) o.metadata.namespace = k.namespace;
  if (k.commonLabels) for (const o of all()) addLabels(o, k.commonLabels);
  if (k.images) for (const o of objs) eachContainer(o, (c) => { if (typeof c.image === 'string') c.image = setImage(c.image, k.images); });

  return { objs, maps };
}

// Итог сборки: хеш-суффикс генераторам — последним, когда содержимое уже известно,
// и ссылки в Deployment переписываются на новое имя.
function kustomize(files, dir, mode) {
  const built = kustomizeBuild(files, dir, mode || 'strategic');
  const objs = built.objs.map(clone);
  const maps = built.maps.map((m) => clone(m.obj));
  for (const m of maps) {
    const from = m.metadata.name;
    m.metadata.name = from + '-' + contentHash(m);
    for (const o of objs) renameRefs(o, 'ConfigMap', from, m.metadata.name);
  }
  return maps.concat(objs);
}
`;

/** Откуда берутся `.Values`. Печатается в разделе «Values». */
export const VALUES_CODE = String.raw`
// Учебная модель: откуда берутся .Values в Helm. По документации:
//   helm.sh/docs/chart_template_guide/values_files/  — порядок и удаление ключа через null
//   helm.sh/docs/intro/using_helm/                   — -f, --set и его синтаксис
// Порядок, от слабого к сильному: values.yaml чарта < -f (правый сильнее левого) < --set.
// Демо и тест темы исполняют именно этот текст.

// Файлы -f сливаются друг с другом: словари — вглубь, всё остальное заменяется.
// Список — это «всё остальное»: он заменяется целиком, поэлементного слияния нет.
function mergeValues(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = isMap(v) && isMap(out[k]) ? mergeValues(out[k], v) : clone(v);
  }
  return out;
}

// Разрезать по разделителю, пропуская экранированный «\,» и то, что внутри {…}.
function splitOn(text, sep) {
  const parts = [''];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) { parts[parts.length - 1] += ch + text[++i]; continue; }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === sep && depth === 0) parts.push('');
    else parts[parts.length - 1] += ch;
  }
  return parts;
}

const unescape = (s) => s.replace(/\\(.)/g, '$1');

// --set угадывает тип: true/false, null, целое число; всё прочее — строка.
// --set-string (asString) угадывание выключает.
function typed(raw, asString) {
  const s = unescape(raw);
  if (asString) return s;
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  if (/^null$/i.test(s)) return null;
  if (s === '0' || /^-?[1-9]\d*$/.test(s)) return Number(s);
  return s;
}

// «a.b=1,list={x,y},name=v1\,v2» → пары [путь, значение].
function parseSet(expr, asString) {
  return splitOn(expr, ',').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error('--set: нет «=» в ' + pair);
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    if (/\[\d+\]/.test(key)) throw new Error('--set: индексы списков в модели не поддержаны');
    const path = splitOn(key, '.').map(unescape);
    let value;
    if (raw === '[]') value = [];
    else if (raw.startsWith('{') && raw.endsWith('}')) value = splitOn(raw.slice(1, -1), ',').map((x) => typed(x, asString));
    else value = typed(raw, asString);
    return [path, value];
  });
}

function applySet(values, expr, asString) {
  const out = clone(values);
  for (const [path, value] of parseSet(expr, asString)) {
    let node = out;
    for (const k of path.slice(0, -1)) {
      if (!isMap(node[k])) node[k] = {};
      node = node[k];
    }
    node[path[path.length - 1]] = value;
  }
  return out;
}

// Значения пользователя поверх values.yaml чарта. Чего у пользователя нет — берётся
// из чарта; null у пользователя удаляет ключ, заданный в чарте.
function coalesce(user, chart) {
  const out = clone(user);
  for (const [k, v] of Object.entries(chart)) {
    if (!(k in out)) out[k] = clone(v);
    else if (out[k] === null) delete out[k];
    else if (isMap(out[k]) && isMap(v)) out[k] = coalesce(out[k], v);
  }
  return out;
}

// files — разобранные -f по порядку командной строки; sets — строки --set по порядку
// или { expr, asString: true } для --set-string.
function helmValues(chartValues, files, sets) {
  let user = {};
  for (const f of files || []) user = mergeValues(user, f || {});
  for (const s of sets || []) user = typeof s === 'string' ? applySet(user, s) : applySet(user, s.expr, s.asString);
  return coalesce(user, chartValues || {});
}
`;

/** Шаблоны Helm — ровно те конструкции, что в чарте темы. В теме не печатается. */
export const TEMPLATE_CODE = String.raw`
// Учебная модель шаблонов Helm: go-template с функциями Sprig — только то, чем пользуется
// чарт темы: {{ .Values.x }}, {{- … -}}, if/with/else/end и функции default, quote,
// required, toYaml, indent, nindent. По документации:
//   helm.sh/docs/chart_template_guide/ — разделы про функции, пайплайны и управление потоком
//   pkg.go.dev/text/template            — пустые значения и обрезка пробелов

// «Пустое» для if, with и default: false, 0, "", пустой список и словарь, отсутствие значения.
function empty(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isMap(v)) return Object.keys(v).length === 0;
  return false;
}

// Как Go печатает значение в шаблон. Словарь без toYaml — это map[ключ:значение].
function show(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return '[' + v.map(show).join(' ') + ']';
  if (isMap(v)) return 'map[' + Object.keys(v).sort().map((k) => k + ':' + show(v[k])).join(' ') + ']';
  return String(v);
}

const indentText = (n, s) => ' '.repeat(n) + String(s).split('\n').join('\n' + ' '.repeat(n));

const FUNCS = {
  default: (d, v) => (empty(v) ? d : v),
  quote: (v) => (v === null || v === undefined ? '' : JSON.stringify(show(v))),
  required: (msg, v) => {
    if (v === null || v === undefined || v === '') throw new Error(msg);
    return v;
  },
  toYaml: (v) => (v === null || v === undefined ? 'null' : dumpYaml(v, { sortKeys: true })),
  indent: (n, s) => indentText(n, s),
  nindent: (n, s) => '\n' + indentText(n, s),
};

function tokens(src) {
  const out = [];
  const re = /\s*("(?:[^"\\]|\\.)*"|[^\s"]+)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function lookup(token, dot, root) {
  if (token === '.') return dot;
  if (token === '$') return root;
  if (token[0] === '"') return JSON.parse(token);
  if (/^-?\d+$/.test(token)) return Number(token);
  if (token === 'true' || token === 'false') return token === 'true';
  if (token[0] !== '.' && token[0] !== '$') throw new Error('непонятно: ' + token);
  let v = token[0] === '$' ? root : dot;
  const names = token.replace(/^\$/, '').split('.').filter(Boolean);
  for (let i = 0; i < names.length; i++) {
    if (v === null || v === undefined) throw new Error('nil pointer evaluating interface {}.' + names[i]);
    v = isMap(v) ? v[names[i]] : undefined;
  }
  return v;
}

function pipeline(src, dot, root) {
  let value;
  let first = true;
  for (const cmd of src.split('|')) {
    const t = tokens(cmd);
    if (FUNCS[t[0]]) {
      const args = t.slice(1).map((x) => lookup(x, dot, root));
      if (!first) args.push(value);
      value = FUNCS[t[0]].apply(null, args);
    } else {
      if (t.length !== 1 || !first) throw new Error('не функция: ' + t[0]);
      value = lookup(t[0], dot, root);
    }
    first = false;
  }
  return value;
}

// Разбор: текст и действия. «{{-» съедает пробелы и переводы строк слева, «-}}» — справа.
function parseTemplate(src) {
  const parts = [];
  const re = /\{\{(-\s)?([\s\S]*?)(\s-)?\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    parts.push({ text: src.slice(last, m.index) });
    parts.push({ action: m[2].trim(), left: Boolean(m[1]), right: Boolean(m[3]) });
    last = re.lastIndex;
  }
  parts.push({ text: src.slice(last) });
  parts.forEach((p, i) => {
    if (!p.action) return;
    if (p.left) parts[i - 1].text = parts[i - 1].text.replace(/\s+$/, '');
    if (p.right) parts[i + 1].text = parts[i + 1].text.replace(/^\s+/, '');
  });

  let pos = 0;
  function list(stop) {
    const nodes = [];
    while (pos < parts.length) {
      const p = parts[pos++];
      if (!p.action) { nodes.push(p); continue; }
      const a = p.action;
      if (a.startsWith('/*')) continue;
      if (a === 'end' || a === 'else') {
        if (!stop) throw new Error('лишний {{ ' + a + ' }}');
        return { nodes, end: a };
      }
      const block = /^(if|with)\s+(.*)$/.exec(a);
      if (block) {
        const then = list(true);
        const other = then.end === 'else' ? list(true) : { nodes: [] };
        nodes.push({ kind: block[1], expr: block[2], then: then.nodes, other: other.nodes });
      } else {
        nodes.push({ expr: a });
      }
    }
    if (stop) throw new Error('нет {{ end }}');
    return { nodes };
  }
  return list(false).nodes;
}

function renderNodes(nodes, dot, root) {
  let out = '';
  for (const n of nodes) {
    if ('text' in n) out += n.text;
    else if (n.kind === 'if' || n.kind === 'with') {
      const v = pipeline(n.expr, dot, root);
      if (!empty(v)) out += renderNodes(n.then, n.kind === 'with' ? v : dot, root);
      else out += renderNodes(n.other, dot, root);
    } else out += show(pipeline(n.expr, dot, root));
  }
  return out;
}

function renderTemplate(src, root) {
  return renderNodes(parseTemplate(src), root, root);
}

// helm template: каждый файл templates/ по очереди, пустые пропускаются.
function helmTemplate(chart, values, release) {
  const root = {
    Values: values,
    Release: { Name: release.name, Namespace: release.namespace || 'default' },
    Chart: { Name: chart.meta.name, Version: chart.meta.version, AppVersion: chart.meta.appVersion },
  };
  const docs = [];
  for (const [name, src] of chart.templates) {
    const text = renderTemplate(src, root).replace(/^\s*\n/, '').replace(/\s+$/, '');
    if (text.trim() !== '') docs.push('---\n# Source: ' + chart.meta.name + '/templates/' + name + '\n' + text);
  }
  return docs.join('\n');
}
`;

/** Сборка демо: команды, разница с базой, главное об итоге. В теме не печатается. */
export const VIEW_CODE = String.raw`
// Что изменилось против базы: наибольшая общая подпоследовательность строк.
// Строка итога, не вошедшая в неё, — добавлена или изменена; строка базы — ушла.
function lineDiff(before, after) {
  const n = before.length;
  const m = after.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = before[i] === after[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const changed = new Array(m).fill(true);
  const gone = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { changed[j] = false; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) gone.push(before[i++]);
    else j++;
  }
  while (i < n) gone.push(before[i++]);
  return { changed, gone };
}

// Файлы темы → итоговые манифесты окружения обоими способами.
// files — словарь «путь → текст» с базой, слоями, чартом и values.
function chartOf(files) {
  const meta = parseYaml(files['chart/Chart.yaml'])[0];
  const templates = Object.keys(files)
    .filter((p) => p.startsWith('chart/templates/'))
    .map((p) => [p.slice('chart/templates/'.length), files[p]]);
  return { meta, templates };
}

// Команда: helm template|install|upgrade [--install] <релиз> <чарт> -n <ns> -f <файл>… --set <выражение>…
function parseHelmCommand(cmd) {
  const t = cmd.trim().split(/\s+/);
  const out = { release: '', chart: '', namespace: 'default', files: [], sets: [] };
  const positional = [];
  for (let i = 2; i < t.length; i++) {
    if (t[i] === '--install') continue;
    if (t[i] === '-n' || t[i] === '--namespace') out.namespace = t[++i];
    else if (t[i] === '-f' || t[i] === '--values') out.files.push(t[++i]);
    else if (t[i] === '--set') out.sets.push(t[++i]);
    else if (t[i] === '--set-string') out.sets.push({ expr: t[++i], asString: true });
    else if (t[i][0] === '-') throw new Error('в модели нет флага ' + t[i]);
    else positional.push(t[i]);
  }
  out.release = positional[0];
  out.chart = positional[1];
  return out;
}

function helmRelease(files, cmd) {
  const c = parseHelmCommand(cmd);
  const chart = chartOf(files);
  const chartValues = parseYaml(files['chart/values.yaml'])[0];
  const values = helmValues(chartValues, c.files.map((f) => parseYaml(files[f])[0]), c.sets);
  return { values, text: helmTemplate(chart, values, { name: c.release, namespace: c.namespace }) };
}

// Главное об итоге: что получит кластер. Читается из того же текста, что показан.
function factsOf(docs) {
  const deploy = docs.find((d) => d && d.kind === 'Deployment');
  const ingress = docs.find((d) => d && d.kind === 'Ingress');
  const config = docs.find((d) => d && d.kind === 'ConfigMap');
  const pod = deploy && podSpecOf(deploy);
  return {
    replicas: deploy ? deploy.spec.replicas : null,
    containers: ((pod && pod.containers) || []).map((c) => ({ name: c.name, image: c.image || null, env: (c.env || []).map((e) => e.name) })),
    host: ingress ? ingress.spec.rules[0].host : null,
    config: config ? { name: config.metadata.name, data: config.data } : null,
  };
}

// commands — { base, dev, stage, prod }: команда helm для базы и для каждого окружения.
function buildView(files, commands, env, tool, mode) {
  let before;
  let after;
  if (tool === 'kustomize') {
    before = dumpAll(kustomize(files, 'base', mode)).split('\n');
    after = dumpAll(kustomize(files, 'overlays/' + env, mode)).split('\n');
  } else {
    before = helmRelease(files, commands.base).text.split('\n');
    after = helmRelease(files, commands[env]).text.split('\n');
  }
  const d = lineDiff(before, after);
  return {
    lines: after.map((text, i) => ({ text, changed: d.changed[i] })),
    gone: d.gone.filter((l) => l.trim() !== '' && l !== '---'),
    facts: factsOf(parseYaml(after.join('\n'))),
  };
}

// Модуль собирается через new Function — отсюда return.
return {
  parseYaml, dumpYaml, dumpAll,
  strategicMerge, jsonMergePatch, jsonPatch,
  kustomize, setImage, contentHash,
  helmValues, parseSet, applySet,
  renderTemplate, helmTemplate, parseHelmCommand, helmRelease,
  lineDiff, factsOf, buildView,
};
`;

/** Порядок важен: каждая часть пользуется функциями предыдущих. */
export const MODEL_PARTS = [YAML_CODE, MERGE_CODE, KUSTOMIZE_CODE, VALUES_CODE, TEMPLATE_CODE, VIEW_CODE];

// ─────────────────────────────────────────────────────────────────────────────────────
// Сквозной пример: одно приложение, три окружения, два способа
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Файлы учебного репозитория доставки: база и слои kustomize, чарт Helm и values окружений.
 * Каждый напечатан в теме и разобран тестом; модель читает **эти же** строки.
 * Порядок шаблонов чарта — порядок документов в выводе `helm template` модели.
 */
export const FILES: Record<string, string> = {
  'base/kustomization.yaml': `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
  - ingress.yaml
configMapGenerator:
  - name: web-config               # в кластере имя получит суффикс из содержимого
    literals:
      - API_URL=https://api.example.com
      - FEATURE_NEW_CHECKOUT=off`,

  'base/deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: app                # name — ключ, по которому сливаются контейнеры
          image: registry.example.com/shop/web:1.4.0
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: web-config   # kustomize допишет сюда суффикс
          env:
            - name: LOG_LEVEL
              value: info
            - name: TZ
              value: UTC
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
        - name: log-agent          # второй контейнер: собирает логи
          image: registry.example.com/infra/log-agent:2.1.0`,

  'base/service.yaml': `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080`,

  'base/ingress.yaml': `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  ingressClassName: nginx
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80`,

  'overlays/dev/kustomization.yaml': `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: shop-dev
resources:
  - ../../base
commonLabels:
  env: dev
images:
  - name: registry.example.com/shop/web
    newTag: 1.5.0-rc.1
configMapGenerator:
  - name: web-config
    behavior: merge                # дописать к базовому, а не создать новый
    literals:
      - API_URL=https://api.dev.example.com
      - FEATURE_NEW_CHECKOUT=on
patches:
  - path: app.yaml                 # strategic merge: цель — по kind и name внутри
  - path: host.yaml                # JSON 6902: цель — в target
    target:
      kind: Ingress
      name: web`,

  'overlays/dev/app.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          env:
            - name: LOG_LEVEL
              value: debug
        - name: log-agent
          $patch: delete           # в dev сборщик логов не нужен`,

  'overlays/dev/host.yaml': `- op: replace
  path: /spec/rules/0/host
  value: dev.shop.example.com`,

  'overlays/stage/kustomization.yaml': `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: shop-stage
resources:
  - ../../base
commonLabels:
  env: stage
images:
  - name: registry.example.com/shop/web
    newTag: 1.5.0-rc.1
configMapGenerator:
  - name: web-config
    behavior: merge
    literals:
      - API_URL=https://api.stage.example.com
patches:
  - path: host.yaml
    target:
      kind: Ingress
      name: web`,

  'overlays/stage/host.yaml': `- op: replace
  path: /spec/rules/0/host
  value: stage.shop.example.com`,

  'overlays/prod/kustomization.yaml': `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: shop-prod
resources:
  - ../../base
commonLabels:
  env: prod
images:
  - name: registry.example.com/shop/web
    newTag: 1.4.2
patches:
  - path: app.yaml`,

  'overlays/prod/app.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: app                # только то, что меняется: остальное — из базы
          resources:
            requests:
              cpu: 250m
            limits:
              memory: 512Mi`,

  'chart/Chart.yaml': `apiVersion: v2
name: web
version: 0.3.0
appVersion: 1.4.0`,

  'chart/values.yaml': `environment: prod
replicaCount: 2
image:
  repository: registry.example.com/shop/web
  tag: ""                          # пусто — возьмётся appVersion из Chart.yaml
apiUrl: https://api.example.com
featureNewCheckout: "off"          # без кавычек YAML 1.1 прочтёт off как false
extraEnv:
  - name: LOG_LEVEL
    value: info
  - name: TZ
    value: UTC
resources:
  requests:
    cpu: 100m
    memory: 128Mi
logAgent:
  enabled: true
ingress:
  enabled: true
  host: shop.example.com`,

  'chart/templates/configmap.yaml': `apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-config
data:
  API_URL: {{ .Values.apiUrl | quote }}
  FEATURE_NEW_CHECKOUT: {{ .Values.featureNewCheckout | quote }}`,

  'chart/templates/service.yaml': `apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080`,

  'chart/templates/deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
  labels:
    app: web
    env: {{ .Values.environment }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
        env: {{ .Values.environment }}
    spec:
      containers:
        - name: app
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: {{ .Release.Name }}-config
          env:
            {{- toYaml .Values.extraEnv | nindent 12 }}
          {{- with .Values.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
        {{- if .Values.logAgent.enabled }}
        - name: log-agent
          image: registry.example.com/infra/log-agent:2.1.0
        {{- end }}`,

  'chart/templates/ingress.yaml': `{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Release.Name }}
spec:
  ingressClassName: nginx
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ .Release.Name }}
                port:
                  number: 80
{{- end }}`,

  'values-dev.yaml': `environment: dev
replicaCount: 1
image:
  tag: 1.5.0-rc.1
apiUrl: https://api.dev.example.com
featureNewCheckout: "on"
extraEnv:                          # список заменит базовый целиком: TZ пропадёт
  - name: LOG_LEVEL
    value: debug
logAgent:
  enabled: false
ingress:
  host: dev.shop.example.com`,

  'values-stage.yaml': `environment: stage
image:
  tag: 1.5.0-rc.1
apiUrl: https://api.stage.example.com
ingress:
  host: stage.shop.example.com`,

  'values-prod.yaml': `environment: prod
replicaCount: 4
resources:                         # словарь сольётся с базовым вглубь
  requests:
    cpu: 250m
  limits:
    memory: 512Mi`,
};

/** Команды Helm: `base` — рендер без файла окружения, с чем сравнивает демо. */
export const COMMANDS: Record<'base' | 'dev' | 'stage' | 'prod', string> = {
  base: 'helm template web ./chart',
  dev: 'helm upgrade --install web ./chart -n shop-dev -f values-dev.yaml',
  stage: 'helm upgrade --install web ./chart -n shop-stage -f values-stage.yaml',
  prod: 'helm upgrade --install web ./chart -n shop-prod -f values-prod.yaml --set image.tag=1.4.2',
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Вводный раздел
// ─────────────────────────────────────────────────────────────────────────────────────

export const INTRO_NOTE =
  'Приложение одно, а окружений три: dev для разработки, stage для проверки перед выпуском, prod для пользователей. Манифесты у них почти одинаковые — отличаются число реплик, тег образа, домен, адрес API да лимиты памяти. Три папки копий через месяц превращаются в три разных приложения: исправление доехало до prod, но не до stage, и stage перестал что-либо проверять. Эту задачу решают двумя противоположными способами. **Kustomize** хранит обычные манифесты и накладывает на них патчи: «вот база, а в prod поменяй это». **Helm** превращает манифест в шаблон с пропусками и заполняет их значениями окружения. **GitOps** отвечает на следующий вопрос: кто доставляет результат в кластер, если источник правды — Git.';

/** Два способа — во вводном разделе, сразу под тезисом темы. */
export const PLAIN_TWO_WAYS =
  'Kustomize — калька поверх чертежа. Сам чертёж не трогают, а на кальке для каждого окружения рисуют только отличия: под калькой всегда виден чертёж. Helm — бланк с пропусками: «реплик: ___, домен: ___». Бланк один, заполненных экземпляров три, и предусмотреть в бланке можно что угодно, но читать тогда приходится бланк, а не чертёж.';

export const GLOSSARY = [
  {
    k: 'манифест',
    d: 'YAML-описание объекта Kubernetes: Deployment, Service, Ingress, ConfigMap. `kubectl apply -f` отправляет его в кластер, а тот приводит себя в соответствие.',
  },
  {
    k: 'окружение',
    d: 'Отдельная копия приложения со своими данными, адресом и настройками. Обычно это своё пространство имён (`namespace`) или свой кластер.',
  },
  {
    k: 'ConfigMap',
    d: 'Объект Kubernetes с настройками «ключ — значение». Под получает их переменными окружения или файлами. Переменные читаются **при старте контейнера**: смена ConfigMap сама под не перезапускает.',
  },
  {
    k: 'патч',
    d: 'Описание изменения, а не объекта целиком: «в Deployment `web` поставить `replicas: 4`». Накладывается на готовый манифест.',
  },
  {
    k: 'ключ слияния',
    d: 'Поле, по которому патч узнаёт «тот же» элемент списка. У контейнеров это `name`: патч с `name: app` меняет контейнер `app`, а не добавляет второй.',
  },
  {
    k: 'чарт',
    d: 'Пакет Helm: папка с `Chart.yaml`, шаблонами манифестов в `templates/` и значениями по умолчанию в `values.yaml`. Чарты публикуют в репозитории и ставят как зависимости.',
  },
  {
    k: 'values',
    d: 'Значения, которые Helm подставляет в шаблоны: из `values.yaml` чарта, из файлов `-f` и из флагов `--set`.',
  },
  {
    k: 'релиз',
    d: 'Установленный экземпляр чарта: имя, пространство имён и история ревизий. `helm rollback` возвращает одну из них.',
  },
  {
    k: 'GitOps',
    d: 'Способ доставки: желаемое состояние лежит в Git, а программа внутри кластера постоянно сверяет с ним кластер и применяет разницу. Выкат — это коммит, откат — тоже коммит.',
  },
  {
    k: 'дрейф',
    d: 'Расхождение между описанным в Git и работающим в кластере — например, после ручного `kubectl edit` или `kubectl scale`.',
  },
  {
    k: 'Secret',
    d: 'Объект Kubernetes для паролей и ключей. Значения в нём записаны в base64, а это кодировка, не шифр: `base64 -d` читает их любой, у кого есть файл.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Перед началом
// ─────────────────────────────────────────────────────────────────────────────────────

export const PREREQ_NOTE =
  'Тема собирает манифесты и доставляет их. Что происходит с манифестом в кластере, разобрано отдельно.';

export const PREREQ = [
  {
    t: 'Смена шаблона пода запускает выкат',
    d: 'Deployment пересоздаёт поды, только когда меняется `spec.template`. На этом держится хеш в имени ConfigMap: он превращает смену настроек в смену шаблона пода.',
    href: '/delivery/kubernetes/#s4',
    hrefLabel: 'Kubernetes: развёртывание — «Выкат и откат»',
    tone: 'info' as const,
  },
  {
    t: 'Кластер сводит желаемое с действительным',
    d: 'Контроллер сравнивает описание с тем, что работает, и делает шаг к описанию — снова и снова. GitOps растягивает тот же цикл до Git; как он устроен в самом Kubernetes, здесь не повторяется.',
    href: '/delivery/kubernetes/#s1',
    hrefLabel: 'Kubernetes: развёртывание — «Под и контроллеры»',
    tone: 'info' as const,
  },
  {
    t: 'Домен окружения живёт в Ingress',
    d: 'Хост в правиле Ingress решает, какой домен откроет приложение. В слоях окружений он меняется патчем или значением.',
    href: '/delivery/ingress/#s2',
    hrefLabel: 'Вход в кластер — «Ingress: хост и путь»',
    tone: 'info' as const,
  },
  {
    t: 'Окружения и одобрения в CI',
    d: 'При доставке «из CI» выкат запускает конвейер — со своими окружениями, секретами и ручным одобрением. То же в GitLab — раздел [«Правила запуска»](/delivery/gitlab-ci/#s5), подраздел «Ручной выкат и окружения».',
    href: '/delivery/github-actions/#s7',
    hrefLabel: 'GitHub Actions — «Права и секреты», подраздел «Окружения и одобрения»',
    tone: 'warn' as const,
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 1 — три окружения
// ─────────────────────────────────────────────────────────────────────────────────────

/** Чем отличаются окружения сквозного примера. Каждую ячейку пересчитывает тест — обоими способами. */
export const ENV_TABLE = {
  head: ['', 'dev', 'stage', 'prod'],
  rows: [
    ['реплик', '1', '2', '4'],
    ['тег образа', '`1.5.0-rc.1`', '`1.5.0-rc.1`', '`1.4.2`'],
    ['домен', '`dev.shop.example.com`', '`stage.shop.example.com`', '`shop.example.com`'],
    ['`API_URL`', '`https://api.dev.example.com`', '`https://api.stage.example.com`', '`https://api.example.com`'],
    ['сборщик логов', 'нет', 'есть', 'есть'],
    ['лимит памяти', 'нет', 'нет', '`512Mi`'],
  ],
  cols: 'minmax(120px,.7fr) minmax(150px,1fr) minmax(150px,1fr) minmax(150px,1fr)',
  kinds: ['prose', 'mono', 'mono', 'mono'] as ('prose' | 'mono')[],
  minWidth: 680,
};

export const ENV_NOTE =
  'Всё в таблице — данные: числа, строки, один выключенный контейнер. Код приложения, порты, пробы и метки обязаны совпадать, иначе stage проверяет не то, что поедет в prod. Отсюда цель обоих инструментов: **общее описано один раз, а у окружения записаны только отличия**.';

export const ONE_IMAGE_NOTE =
  '**Один образ на все окружения.** Образ собирают один раз, а отличия приходят снаружи — переменными окружения из ConfigMap. Иначе prod получает не тот образ, что проверили на stage. Для фронтенда здесь ловушка: сборщик вписывает `import.meta.env.VITE_API_URL` в бандл **при сборке**, и ConfigMap до него уже не дотянется. Выходов два. Серверный рендер читает `process.env` при старте. Статике отдают файл настроек — `/config.json` или `config.js`, — который контейнер пишет из переменных при запуске, а приложение загружает первым.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 2 — Kustomize
// ─────────────────────────────────────────────────────────────────────────────────────

export const KUSTOMIZE_WHY =
  'Kustomize встроен в `kubectl`: `kubectl apply -k overlays/prod` собирает слой и применяет, `kubectl kustomize overlays/prod` — только печатает итог. Отдельная программа `kustomize build` делает то же, и её версия обычно новее встроенной — по документации. Языка шаблонов нет: каждый файл — обычный YAML, который читается и применяется и без Kustomize. База собирается сама по себе, а слой окружения ссылается на неё и перечисляет только отличия.';

export const KUSTOMIZE_TREE = `deploy/
├── base/
│   ├── kustomization.yaml     что входит в базу и генератор ConfigMap
│   ├── deployment.yaml
│   ├── service.yaml
│   └── ingress.yaml
└── overlays/
    ├── dev/     kustomization.yaml · app.yaml · host.yaml
    ├── stage/   kustomization.yaml · host.yaml
    └── prod/    kustomization.yaml · app.yaml`;

/** Поля kustomization.yaml, которыми пользуется тема. По справочнику kustomize. */
export const KUSTOMIZE_FIELDS = {
  head: ['Поле', 'Что делает', 'Что стоит знать'],
  rows: [
    ['`resources`', 'файлы манифестов или папка другой сборки — так слой берёт базу', 'путь к папке, а не к её `kustomization.yaml`'],
    ['`namespace`', 'ставит пространство имён всем объектам', 'перезаписывает то, что было в манифестах'],
    ['`namePrefix`', 'приставка к именам всех объектов', 'ссылки на эти объекты переписываются вслед за именем'],
    ['`commonLabels`', 'метки всем объектам **и в селекторы**', 'заменено полем `labels`, где селекторы трогать не обязательно'],
    ['`images`', 'меняет имя, тег или digest образа в контейнерах', 'без патча: слой не знает, в каком контейнере образ'],
    ['`configMapGenerator`', 'ConfigMap из строк или файлов, с хешем содержимого в имени', 'в слое — `behavior: merge` или `replace`'],
    ['`patches`', 'патчи: strategic merge или JSON 6902', 'сменил поля `patchesStrategicMerge` и `patchesJson6902`'],
  ],
  cols: 'minmax(170px,.8fr) minmax(230px,1.3fr) minmax(230px,1.3fr)',
  kinds: ['mono', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 720,
};

export const FIELDS_NOTE =
  'Замена `commonLabels` на `labels` и старых полей патчей на `patches` — по документации kustomize 5; старые поля пока работают, а `kustomize edit fix` переписывает файл на новые.';

/**
 * Пример трансформера `images` из справочника kustomize, плюс свой случай с портом реестра.
 * Столбец «стало» пересчитывает тест функцией `setImage`.
 */
export const IMAGE_RULES = [
  { name: 'postgres', newName: 'my-registry/my-postgres', newTag: 'v1' },
  { name: 'nginx', newTag: '1.8.0' },
  { name: 'my-demo-app', newName: 'my-app' },
  { name: 'alpine', digest: 'sha256:24a0c4b4a4c0eb97a1aabb8e29f18e917d05abfe1b7a7c07857230879ce7d3d3' },
  { name: 'registry.local:5000/shop/web', newTag: '1.4.2' },
];

export const IMAGE_CASES: { from: string; to: string; src: 'kustomize-images' | 'model' }[] = [
  { from: 'postgres:1.8.0', to: 'my-registry/my-postgres:v1', src: 'kustomize-images' },
  { from: 'nginx:latest', to: 'nginx:1.8.0', src: 'kustomize-images' },
  { from: 'my-demo-app:latest', to: 'my-app:latest', src: 'kustomize-images' },
  { from: 'alpine:1.8.0', to: 'alpine@sha256:24a0c4b4a4c0eb97a1aabb8e29f18e917d05abfe1b7a7c07857230879ce7d3d3', src: 'kustomize-images' },
  { from: 'registry.local:5000/shop/web:1.4.0', to: 'registry.local:5000/shop/web:1.4.2', src: 'model' },
];

export const IMAGES_CODE = `images:
  - name: postgres
    newName: my-registry/my-postgres
    newTag: v1
  - name: nginx
    newTag: 1.8.0
  - name: my-demo-app
    newName: my-app
  - name: alpine
    digest: sha256:24a0c4b4a4c0eb97a1aabb8e29f18e917d05abfe1b7a7c07857230879ce7d3d3
  - name: registry.local:5000/shop/web     # порт реестра — не тег
    newTag: 1.4.2`;

export const IMAGES_TABLE = {
  head: ['В манифесте', 'После `images`'],
  rows: IMAGE_CASES.map((c) => [`\`${c.from}\``, `\`${c.to}\``]),
  cols: 'minmax(230px,1fr) minmax(300px,1.4fr)',
  kinds: ['mono', 'mono'] as ('mono' | 'mono')[],
  minWidth: 560,
};

export const IMAGES_NOTE =
  'Первые четыре строки — пример из справочника kustomize, последняя — своя: двоеточие до последней косой черты — это порт реестра, а не тег. Правило совпадения — имя образа без тега целиком: `name: web` не заденет `registry.example.com/shop/web`.';

export const PLAIN_HASH =
  'Deployment замечает только то, что написано в нём самом. Поменять содержимое ConfigMap — всё равно что поменять меню в столовой, не сменив вывеску: кто пообедал утром, об этом не узнает. Хеш в имени меняет вывеску — и Deployment видит, что ссылка стала другой.';

export const HASH_WHY =
  'ConfigMap — отдельный объект, а поды читают его переменные один раз, при старте контейнера. Поменяли `API_URL`, `kubectl apply` прошёл без ошибок, а поды работают со старым адресом, пока их кто-нибудь не перезапустит. Генератор решает это так: имя ConfigMap — это имя плюс хеш содержимого. Другое содержимое — другое имя. Kustomize переписывает ссылку в Deployment, шаблон пода изменился, и начинается обычный выкат. Старый ConfigMap при этом остаётся в кластере, и это полезно: откат Deployment вернёт ссылку на объект, который ещё существует.';

/** Имя ConfigMap после сборки. Суффиксы — хеш модели (FNV-1a), их пересчитывает тест. */
export const HASH_TABLE = {
  head: ['Сборка', 'Содержимое', 'Имя ConfigMap'],
  rows: [
    ['`base`', '`API_URL` prod, флаг `off`', '`web-config-e26rc1wnu5`'],
    ['`overlays/dev`', '`API_URL` dev, флаг `on`', '`web-config-8lr94d19to`'],
    ['`overlays/stage`', '`API_URL` stage, флаг `off`', '`web-config-1ovje3c17i`'],
    ['`overlays/prod`', 'как в базе', '`web-config-e26rc1wnu5`'],
  ],
  cols: 'minmax(150px,.8fr) minmax(200px,1.1fr) minmax(220px,1.1fr)',
  kinds: ['mono', 'prose', 'mono'] as ('mono' | 'prose' | 'mono')[],
  minWidth: 600,
};

export const HASH_NOTE =
  'У prod имя совпало с базой: слой не менял данные, значит, и выката из-за настроек не будет. Суффиксы в таблице посчитаны моделью темы; kustomize берёт другой хеш (SHA-256), поэтому буквы у него выйдут другие, а свойство то же. Выключается суффикс `generatorOptions.disableNameSuffixHash: true`, и вместе с ним пропадает перезапуск при смене настроек.';

/** Слой для превью ветки: в одном пространстве имён несколько копий — нужна приставка. */
export const PREFIX_CODE = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: shop-preview
namePrefix: pr-128-                # превью ветки: копий много, пространство одно
resources:
  - ../../base`;

export const PREFIX_NOTE =
  'После сборки Deployment и Service называются `pr-128-web`, ConfigMap — `pr-128-web-config-` с хешем. Главное — ссылки. Ingress отправляет запросы в `pr-128-web`, а Deployment читает переменные из `pr-128-web-config-…`: kustomize переписывает ссылки вслед за именами. Сделай то же руками `sed` по файлам — и одна забытая ссылка укажет на объект соседнего окружения.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 3 — патчи
// ─────────────────────────────────────────────────────────────────────────────────────

export const PLAIN_MERGE_KEY =
  'Список контейнеров — как список сотрудников отдела. Приказ «Иванову выдать новый пропуск» находит Иванова по фамилии и меняет только пропуск. Если бы приказ заменял список целиком, в отделе остался бы один Иванов — без должности, без стола, с одним пропуском.';

export const SMP_WHY =
  'Strategic merge patch — кусок манифеста той же формы, что и сам манифест. Словари сливаются вглубь, скаляр заменяется, `null` удаляет ключ. Со списками сложнее, и отсюда «strategic» в названии. Как сливать список, знает **не патч, а схема типа**: у поля `containers` в справочнике API стоит `patchStrategy: merge` и `patchMergeKey: name`, и элементы сливаются по имени. У `tolerations` или `args` такой пометки нет — они заменяются целиком. Отдельные директивы позволяют удалить элемент (`$patch: delete`), заменить список (`$patch: replace`) или оставить в словаре только перечисленные ключи (`$retainKeys`).';

export const DEV_PATCH_NOTE =
  'Слой dev из сквозного примера. Первый патч — strategic merge: меняет число реплик, уровень логов контейнера `app` и убирает `log-agent`. Второй — JSON 6902: у правил Ingress ключа слияния нет, поэтому хост меняется по адресу `/spec/rules/0/host`.';

export const JSON6902_WHY =
  'JSON patch по RFC 6902 — список операций `add`, `remove`, `replace`, `test` (и ещё `move` и `copy`, которых модель не знает) по адресу внутри объекта. Он нужен там, где strategic merge бессилен: элемент списка без ключа слияния — правило Ingress или аргумент в `args` — выбирается только номером. Номер и есть его слабость. Поменяли порядок правил в базе — патч молча правит другое правило. Защищаются операцией `test`: она сверяет значение и валит сборку, если на месте что-то другое.';

/** Где взят случай. Адреса — в `CASE_SOURCES`. */
export type CaseSource =
  | 'kubectl-patch'
  | 'smp-doc'
  | 'api-ref'
  | 'rfc7386'
  | 'rfc6902'
  | 'kustomize-images'
  | 'values-files'
  | 'using-helm'
  | 'helm-source'
  | 'template-guide'
  | 'go-template'
  | 'model';

export const CASE_SOURCES: Record<CaseSource, { label: string; href: string }> = {
  'kubectl-patch': { label: 'kubectl patch', href: 'https://kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/' },
  'smp-doc': { label: 'strategic merge patch', href: 'https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/strategic-merge-patch.md' },
  'api-ref': { label: 'справочник API', href: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/' },
  rfc7386: { label: 'RFC 7386', href: 'https://www.rfc-editor.org/rfc/rfc7386#appendix-A' },
  rfc6902: { label: 'RFC 6902', href: 'https://www.rfc-editor.org/rfc/rfc6902#appendix-A' },
  'kustomize-images': { label: 'kustomize: images', href: 'https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/images/' },
  'values-files': { label: 'Helm: Values Files', href: 'https://helm.sh/docs/chart_template_guide/values_files/' },
  'using-helm': { label: 'Helm: Using Helm', href: 'https://helm.sh/docs/intro/using_helm/' },
  'helm-source': { label: 'исходники Helm', href: 'https://github.com/helm/helm' },
  'template-guide': { label: 'Helm: Chart Template Guide', href: 'https://helm.sh/docs/chart_template_guide/' },
  'go-template': { label: 'Go: text/template', href: 'https://pkg.go.dev/text/template' },
  model: { label: 'свой случай', href: '' },
};

/**
 * Случаи strategic merge. `at` — где в объекте лежит `base`: от пути зависит ключ слияния.
 * `strategic` и `jsonMerge` — итог двух видов слияния; оба пересчитывает тест.
 * Всё — короткой записью YAML, её разбирает и модель, и пакет `yaml`.
 */
export const SMP_CASES: {
  what: string;
  kind: string;
  at: string;
  base: string;
  patch: string;
  strategic: string;
  jsonMerge: string;
  src: CaseSource;
}[] = [
  {
    what: 'новый контейнер',
    kind: 'Deployment',
    at: 'spec.template.spec',
    base: '{containers: [{name: patch-demo-ctr, image: nginx}]}',
    patch: '{containers: [{name: patch-demo-ctr-2, image: redis}]}',
    strategic: '{containers: [{name: patch-demo-ctr, image: nginx}, {name: patch-demo-ctr-2, image: redis}]}',
    jsonMerge: '{containers: [{name: patch-demo-ctr-2, image: redis}]}',
    src: 'kubectl-patch',
  },
  {
    what: 'список без ключа слияния',
    kind: 'Deployment',
    at: 'spec.template.spec',
    base: '{tolerations: [{key: dedicated, value: test-team, effect: NoSchedule}]}',
    patch: '{tolerations: [{key: disktype, value: ssd, effect: NoSchedule}]}',
    strategic: '{tolerations: [{key: disktype, value: ssd, effect: NoSchedule}]}',
    jsonMerge: '{tolerations: [{key: disktype, value: ssd, effect: NoSchedule}]}',
    src: 'kubectl-patch',
  },
  {
    what: 'поле контейнера',
    kind: 'Deployment',
    at: 'spec.template.spec',
    base: '{containers: [{name: app, image: "web:1.4.0", ports: [{containerPort: 8080}]}]}',
    patch: '{containers: [{name: app, image: "web:1.4.2"}]}',
    strategic: '{containers: [{name: app, image: "web:1.4.2", ports: [{containerPort: 8080}]}]}',
    jsonMerge: '{containers: [{name: app, image: "web:1.4.2"}]}',
    src: 'api-ref',
  },
  {
    what: 'переменные по `name`',
    kind: 'Deployment',
    at: 'spec.template.spec.containers',
    base: '{name: app, env: [{name: LOG_LEVEL, value: info}, {name: TZ, value: UTC}]}',
    patch: '{env: [{name: LOG_LEVEL, value: debug}]}',
    strategic: '{name: app, env: [{name: LOG_LEVEL, value: debug}, {name: TZ, value: UTC}]}',
    jsonMerge: '{name: app, env: [{name: LOG_LEVEL, value: debug}]}',
    src: 'api-ref',
  },
  {
    what: 'порты сервиса по `port`',
    kind: 'Service',
    at: 'spec',
    base: '{ports: [{port: 80, targetPort: 8080}, {port: 443, targetPort: 8443}]}',
    patch: '{ports: [{port: 80, targetPort: 3000}]}',
    strategic: '{ports: [{port: 80, targetPort: 3000}, {port: 443, targetPort: 8443}]}',
    jsonMerge: '{ports: [{port: 80, targetPort: 3000}]}',
    src: 'api-ref',
  },
  {
    what: '`$patch: delete`',
    kind: 'Deployment',
    at: 'spec.template.spec',
    base: '{containers: [{name: app, image: web}, {name: log-agent, image: agent}]}',
    patch: '{containers: [{name: log-agent, $patch: delete}]}',
    strategic: '{containers: [{name: app, image: web}]}',
    jsonMerge: '{containers: [{name: log-agent, $patch: delete}]}',
    src: 'smp-doc',
  },
  {
    what: '`$patch: replace`',
    kind: 'Deployment',
    at: 'spec.template.spec',
    base: '{containers: [{name: app, image: web}, {name: log-agent, image: agent}]}',
    patch: '{containers: [{$patch: replace}, {name: app, image: "web:2"}]}',
    strategic: '{containers: [{name: app, image: "web:2"}]}',
    jsonMerge: '{containers: [{$patch: replace}, {name: app, image: "web:2"}]}',
    src: 'smp-doc',
  },
  {
    what: '`null` удаляет ключ',
    kind: 'Deployment',
    at: 'metadata',
    base: '{labels: {app: web, tier: front}}',
    patch: '{labels: {tier: null}}',
    strategic: '{labels: {app: web}}',
    jsonMerge: '{labels: {app: web}}',
    src: 'smp-doc',
  },
  {
    what: 'без `$retainKeys`',
    kind: 'Deployment',
    at: 'spec',
    base: '{strategy: {type: RollingUpdate, rollingUpdate: {maxSurge: 1}}}',
    patch: '{strategy: {type: Recreate}}',
    strategic: '{strategy: {type: Recreate, rollingUpdate: {maxSurge: 1}}}',
    jsonMerge: '{strategy: {type: Recreate, rollingUpdate: {maxSurge: 1}}}',
    src: 'kubectl-patch',
  },
  {
    what: '`$retainKeys`',
    kind: 'Deployment',
    at: 'spec',
    base: '{strategy: {type: RollingUpdate, rollingUpdate: {maxSurge: 1}}}',
    patch: '{strategy: {$retainKeys: [type], type: Recreate}}',
    strategic: '{strategy: {type: Recreate}}',
    jsonMerge: '{strategy: {type: Recreate, rollingUpdate: {maxSurge: 1}, $retainKeys: [type]}}',
    src: 'kubectl-patch',
  },
];

export const SMP_TABLE = {
  head: ['Случай', 'База', 'Патч', 'Strategic merge', 'JSON merge patch'],
  rows: SMP_CASES.map((c) => [c.what, `\`${c.base}\``, `\`${c.patch}\``, `\`${c.strategic}\``, `\`${c.jsonMerge}\``]),
  cols: 'minmax(140px,.6fr) minmax(210px,1fr) minmax(200px,1fr) minmax(220px,1.1fr) minmax(200px,1fr)',
  kinds: ['prose', 'mono', 'mono', 'mono', 'mono'] as ('prose' | 'mono')[],
  minWidth: 1100,
};

export const SMP_TABLE_NOTE =
  'Случаи взяты со страницы `kubectl patch` документации Kubernetes и из описания strategic merge patch; ключи слияния — из справочника API. Правая колонка — то, что делает `kubectl patch --type merge`: RFC 7386 о ключах слияния не знает, и директивы `$patch` становятся в нём обычными полями. Порядок элементов модель не воспроизводит: новый элемент она дописывает в конец.';

export const LIST_TRAP_NOTE =
  '**Классическая ловушка — список, заменённый целиком.** Патч «поставить `app` лимит памяти» содержит список `containers` из одного элемента. Strategic merge найдёт `app` по имени и добавит лимит. Слияние без ключа — JSON merge patch, `values` Helm, самописный скрипт на `Object.assign` — заменит список: пропадёт второй контейнер, а у `app` — образ, порты и переменные. Такой манифест может даже пройти проверку схемы и сломаться только при выкате. В демо ниже это переключатель «замена списка».';

/** RFC 7386, приложение A: [цель, патч, итог] — все пятнадцать примеров. */
export const JSON_MERGE_CASES: [string, string, string][] = [
  ['{"a":"b"}', '{"a":"c"}', '{"a":"c"}'],
  ['{"a":"b"}', '{"b":"c"}', '{"a":"b","b":"c"}'],
  ['{"a":"b"}', '{"a":null}', '{}'],
  ['{"a":"b","b":"c"}', '{"a":null}', '{"b":"c"}'],
  ['{"a":["b"]}', '{"a":"c"}', '{"a":"c"}'],
  ['{"a":"c"}', '{"a":["b"]}', '{"a":["b"]}'],
  ['{"a":{"b":"c"}}', '{"a":{"b":"d","c":null}}', '{"a":{"b":"d"}}'],
  ['{"a":[{"b":"c"}]}', '{"a":[1]}', '{"a":[1]}'],
  ['["a","b"]', '["c","d"]', '["c","d"]'],
  ['{"a":"b"}', '["c"]', '["c"]'],
  ['{"a":"foo"}', 'null', 'null'],
  ['{"a":"foo"}', '"bar"', '"bar"'],
  ['{"e":null}', '{"a":1}', '{"e":null,"a":1}'],
  ['[1,2]', '{"a":"b","c":null}', '{"a":"b"}'],
  ['{}', '{"a":{"bb":{"ccc":null}}}', '{"a":{"bb":{}}}'],
];

/** RFC 6902, приложение A: номер примера, документ, операции, итог или `null` — ошибка. */
export const JSON_PATCH_CASES: { n: string; doc: string; ops: string; want: string | null }[] = [
  { n: 'A.1', doc: '{"foo":"bar"}', ops: '[{"op":"add","path":"/baz","value":"qux"}]', want: '{"baz":"qux","foo":"bar"}' },
  { n: 'A.2', doc: '{"foo":["bar","baz"]}', ops: '[{"op":"add","path":"/foo/1","value":"qux"}]', want: '{"foo":["bar","qux","baz"]}' },
  { n: 'A.3', doc: '{"baz":"qux","foo":"bar"}', ops: '[{"op":"remove","path":"/baz"}]', want: '{"foo":"bar"}' },
  { n: 'A.4', doc: '{"foo":["bar","qux","baz"]}', ops: '[{"op":"remove","path":"/foo/1"}]', want: '{"foo":["bar","baz"]}' },
  { n: 'A.5', doc: '{"baz":"qux","foo":"bar"}', ops: '[{"op":"replace","path":"/baz","value":"boo"}]', want: '{"baz":"boo","foo":"bar"}' },
  { n: 'A.8', doc: '{"baz":"qux","foo":["a",2,"c"]}', ops: '[{"op":"test","path":"/baz","value":"qux"},{"op":"test","path":"/foo/1","value":2}]', want: '{"baz":"qux","foo":["a",2,"c"]}' },
  { n: 'A.9', doc: '{"baz":"qux"}', ops: '[{"op":"test","path":"/baz","value":"bar"}]', want: null },
  { n: 'A.10', doc: '{"foo":"bar"}', ops: '[{"op":"add","path":"/child","value":{"grandchild":{}}}]', want: '{"foo":"bar","child":{"grandchild":{}}}' },
  { n: 'A.12', doc: '{"foo":"bar"}', ops: '[{"op":"add","path":"/baz/bat","value":"qux"}]', want: null },
  { n: 'A.16', doc: '{"foo":["bar"]}', ops: '[{"op":"add","path":"/foo/-","value":["abc","def"]}]', want: '{"foo":["bar",["abc","def"]]}' },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 4 — Helm: чарт и шаблоны
// ─────────────────────────────────────────────────────────────────────────────────────

export const HELM_WHY =
  'Чарт — папка: `Chart.yaml` с именем и версией, `values.yaml` со значениями по умолчанию и `templates/` с шаблонами манифестов. Шаблон — **текст, а не YAML**. Helm прогоняет его через go-template с функциями библиотеки Sprig, подставляет значения и только потом отдаёт результат Kubernetes как YAML. Ошибка отступа в шаблоне превращается либо в невалидный YAML, либо, что хуже, в валидный, но другой. Поэтому итог смотрят глазами до выката: `helm template` печатает манифесты, ничего не устанавливая.';

export const PLAIN_TEMPLATE =
  'Шаблон Helm — бланк с пропусками: «реплик: ___». Бланк заполняет не человек, а подстановка текста, и она не знает, что пишет YAML. Впишите в строку `resources: ___` целый словарь — и подстановка честно напечатает его так, как печатает Go, а не так, как ждёт Kubernetes. Поэтому словари и списки вставляют через `toYaml` с отступом ровно по месту пропуска.';

export const CHART_TREE = `chart/
├── Chart.yaml            имя, версия чарта и appVersion
├── values.yaml           значения по умолчанию
└── templates/
    ├── configmap.yaml
    ├── service.yaml
    ├── deployment.yaml
    └── ingress.yaml
values-dev.yaml           значения окружений — рядом с чартом, не внутри
values-stage.yaml
values-prod.yaml`;

export const TEMPLATE_FACTS = [
  {
    t: '`{{ .Values.x }}` и точка',
    d: 'Точка — текущий контекст. На верхнем уровне в ней лежат `.Values`, `.Release` (имя и пространство релиза) и `.Chart` (поля `Chart.yaml`). Отсутствующее значение печатается пустой строкой, а обращение **внутрь** отсутствующего — `.Values.ingress.host` без `ingress` — валит рендер ошибкой `nil pointer`.',
  },
  {
    t: '`default` и пустое',
    d: '`{{ .Values.image.tag | default .Chart.AppVersion }}` — «если пусто, взять версию приложения». Пустым для `default` считается не только отсутствие, но и `0`, `false`, `""`, пустой список. Отсюда ловушка: `replicas: 0` превращается в значение по умолчанию.',
    tone: 'warn' as const,
  },
  {
    t: '`toYaml` и `nindent`',
    d: '`{{- toYaml .Values.resources | nindent 12 }}` печатает словарь как YAML, начинает с новой строки и сдвигает каждую строку на 12 пробелов. Число обязано совпасть с глубиной места в шаблоне, а `{{-` съедает пробелы и перевод строки перед собой, чтобы не осталось пустой строки.',
  },
  {
    t: '`with` меняет точку',
    d: 'Внутри `{{- with .Values.resources }}` точка — это уже сами `resources`, а блок пропускается, если значение пустое. Обращение к `.Values` внутри такого блока падает; до корня достают через `$`: `$.Values.x`.',
    tone: 'warn' as const,
  },
  {
    t: '`quote` и `required`',
    d: '`quote` берёт значение в кавычки: `on`, `yes` и `1234` останутся строками для любого читателя YAML. `required "нужен тег" .Values.image.tag` валит рендер с понятным текстом, если значения нет, — лучше, чем манифест с пустым образом.',
  },
];

/** Как ведут себя конструкции шаблона. Столбец «итог» пересчитывает тест моделью. */
export const TEMPLATE_CASES: { tpl: string; values: string; out: string; error?: boolean; src: CaseSource }[] = [
  { tpl: 'replicas: {{ .Values.replicas | default 2 }}', values: '{replicas: 3}', out: 'replicas: 3', src: 'template-guide' },
  { tpl: 'replicas: {{ .Values.replicas | default 2 }}', values: '{replicas: 0}', out: 'replicas: 2', src: 'template-guide' },
  { tpl: 'replicas: {{ .Values.replicas | default 2 }}', values: '{}', out: 'replicas: 2', src: 'template-guide' },
  { tpl: 'value: {{ .Values.flag | quote }}', values: '{flag: "on"}', out: 'value: "on"', src: 'template-guide' },
  { tpl: 'resources: {{ .Values.resources }}', values: '{resources: {limits: {memory: 512Mi}}}', out: 'resources: map[limits:map[memory:512Mi]]', src: 'go-template' },
  { tpl: 'resources:{{ toYaml .Values.resources | nindent 2 }}', values: '{resources: {limits: {memory: 512Mi}}}', out: 'resources:\n  limits:\n    memory: 512Mi', src: 'template-guide' },
  { tpl: '{{ with .Values.resources }}{{ .Values.x }}{{ end }}', values: '{x: 1, resources: {a: 1}}', out: 'nil pointer evaluating interface {}.x', error: true, src: 'template-guide' },
  { tpl: '{{ with .Values.resources }}{{ $.Values.x }}{{ end }}', values: '{x: 1, resources: {a: 1}}', out: '1', src: 'template-guide' },
  { tpl: 'host: {{ .Values.ingress.host }}', values: '{}', out: 'nil pointer evaluating interface {}.host', error: true, src: 'go-template' },
  { tpl: 'tag: {{ required "нужен image.tag" .Values.image.tag }}', values: '{image: {tag: ""}}', out: 'нужен image.tag', error: true, src: 'template-guide' },
];

export const TEMPLATE_TABLE = {
  head: ['Шаблон', 'Values', 'Итог'],
  rows: TEMPLATE_CASES.map((c) => [
    `\`${c.tpl}\``,
    `\`${c.values}\``,
    c.error ? `ошибка: \`${c.out}\`` : `\`${c.out.replace(/\n/g, '⏎')}\``,
  ]),
  cols: 'minmax(260px,1.4fr) minmax(200px,1fr) minmax(220px,1.1fr)',
  kinds: ['mono', 'mono', 'mono'] as ('mono' | 'mono')[],
  minWidth: 760,
};

export const TEMPLATE_TABLE_NOTE =
  'Итог каждой строки посчитан учебной моделью шаблонов; `⏎` — перевод строки. Модель понимает только конструкции из чарта темы. Настоящий go-template богаче: `range`, `include`, `tpl`, переменные, сотня функций Sprig.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 5 — values
// ─────────────────────────────────────────────────────────────────────────────────────

export const PRECEDENCE = [
  '`values.yaml` чарта — самое слабое. У сабчарта сверху ещё ложится раздел values родительского чарта.',
  'Файлы `-f` / `--values` в порядке командной строки: **правый сильнее левого**.',
  '`--set` и `--set-string` — сильнее любого файла, где бы ни стояли в команде.',
];

export const VALUES_WHY =
  'Файлы сливаются друг с другом и с `values.yaml` чарта. Словарь сливается вглубь: в `values-prod.yaml` можно написать только `resources.limits`, и `requests` из чарта останутся. Со списками по-другому. Ключа слияния у Helm нет, поэтому список из файла окружения **заменяет** базовый целиком. `null` удаляет ключ, заданный в чарте, — так выключают значение по умолчанию.';

export const VALUES_CASES: {
  what: string;
  chart: string;
  files: string[];
  sets: (string | { expr: string; asString: true })[];
  want: string;
  src: CaseSource;
}[] = [
  { what: '`--set` сильнее `values.yaml`', chart: '{favoriteDrink: coffee}', files: [], sets: ['favoriteDrink=slurm'], want: '{favoriteDrink: slurm}', src: 'values-files' },
  { what: 'словарь сливается вглубь', chart: '{favorite: {drink: coffee, food: pizza}}', files: ['{favorite: {drink: tea}}'], sets: [], want: '{favorite: {drink: tea, food: pizza}}', src: 'values-files' },
  { what: 'правый `-f` сильнее левого', chart: '{replicaCount: 1}', files: ['{replicaCount: 2}', '{replicaCount: 5}'], sets: [], want: '{replicaCount: 5}', src: 'using-helm' },
  { what: '`--set` сильнее `-f`', chart: '{image: {repository: web, tag: ""}}', files: ['{image: {tag: "1.4.0"}}'], sets: ['image.tag=1.4.2'], want: '{image: {repository: web, tag: "1.4.2"}}', src: 'using-helm' },
  { what: 'список заменяется целиком', chart: '{extraEnv: [{name: LOG_LEVEL, value: info}, {name: TZ, value: UTC}]}', files: ['{extraEnv: [{name: LOG_LEVEL, value: debug}]}'], sets: [], want: '{extraEnv: [{name: LOG_LEVEL, value: debug}]}', src: 'helm-source' },
  {
    what: '`null` удаляет ключ по умолчанию',
    chart: '{livenessProbe: {httpGet: {path: /user/login, port: http}, initialDelaySeconds: 120}}',
    files: [],
    sets: ['livenessProbe.exec.command={cat,docroot/CHANGELOG.txt}', 'livenessProbe.httpGet=null'],
    want: '{livenessProbe: {initialDelaySeconds: 120, exec: {command: [cat, docroot/CHANGELOG.txt]}}}',
    src: 'values-files',
  },
  { what: '`--set` угадывает число', chart: '{replicaCount: 2}', files: [], sets: ['replicaCount=0'], want: '{replicaCount: 0}', src: 'using-helm' },
  { what: '`--set-string` оставляет строку', chart: '{}', files: [], sets: [{ expr: 'buildNumber=1234', asString: true }], want: '{buildNumber: "1234"}', src: 'using-helm' },
];

const setLabel = (s: string | { expr: string }) => (typeof s === 'string' ? `--set ${s}` : `--set-string ${s.expr}`);

export const VALUES_TABLE = {
  head: ['Случай', '`values.yaml`', '`-f` и `--set`', 'Итог'],
  rows: VALUES_CASES.map((c) => [
    c.what,
    `\`${c.chart}\``,
    [...c.files.map((f) => `\`-f ${f}\``), ...c.sets.map((s) => `\`${setLabel(s)}\``)].join(' '),
    `\`${c.want}\``,
  ]),
  cols: 'minmax(160px,.7fr) minmax(220px,1.1fr) minmax(240px,1.2fr) minmax(220px,1.1fr)',
  kinds: ['prose', 'mono', 'mono', 'mono'] as ('prose' | 'mono')[],
  minWidth: 940,
};

/** Синтаксис `--set` из документации Helm. Итог пересчитывает тест функцией `applySet`. */
export const SET_CASES: { expr: string; want: string }[] = [
  { expr: 'name=value', want: '{name: value}' },
  { expr: 'a=b,c=d', want: '{a: b, c: d}' },
  { expr: 'outer.inner=value', want: '{outer: {inner: value}}' },
  { expr: 'name={a,b,c}', want: '{name: [a, b, c]}' },
  { expr: 'name=[],a=null', want: '{name: [], a: null}' },
  { expr: 'name=value1\\,value2', want: '{name: "value1,value2"}' },
  { expr: 'nodeSelector.kubernetes\\.io/role=master', want: '{nodeSelector: {"kubernetes.io/role": master}}' },
  { expr: 'image.tag=1.4.2', want: '{image: {tag: "1.4.2"}}' },
  { expr: 'enabled=false,replicaCount=3', want: '{enabled: false, replicaCount: 3}' },
];

export const SET_TABLE = {
  head: ['`--set`', 'Что получит шаблон'],
  rows: SET_CASES.map((c) => [`\`${c.expr}\``, `\`${c.want}\``]),
  cols: 'minmax(260px,1fr) minmax(260px,1fr)',
  kinds: ['mono', 'mono'] as ('mono' | 'mono')[],
  minWidth: 540,
};

export const VALUES_NOTE =
  'Случаи — из разделов «Values Files» и «Using Helm» документации Helm, кроме замены списка: её документация не формулирует отдельно, это поведение функций слияния в исходниках Helm. `--set` угадывает тип значения: `true` и `false` становятся логическими, целое — числом, `null` — пустотой, остальное остаётся строкой. `--set-string` угадывание выключает. Индексы списков (`servers[0].port=80`) модель не разбирает.';

export const TYPO_NOTE =
  '**Helm не проверяет, что такой ключ вообще есть.** `replicas: 4` в файле окружения вместо `replicaCount: 4` ляжет в `.Values` рядом с настоящим ключом, шаблон его не прочтёт, и prod молча останется с двумя репликами. Защита — файл `values.schema.json` в чарте: по документации Helm сверяет с этой JSON-схемой values при `install`, `upgrade`, `lint` и `template`, а `additionalProperties: false` запрещает незнакомые ключи.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 6 — релиз, история, откат, хуки
// ─────────────────────────────────────────────────────────────────────────────────────

/** Форма вывода по документации, **не снята с кластера**. Команды совпадают с `COMMANDS`. */
export const RELEASE_CODE = `$ helm upgrade --install web ./chart -n shop-prod -f values-prod.yaml --set image.tag=1.4.2
$ helm history web -n shop-prod
REVISION  STATUS      CHART      APP VERSION  DESCRIPTION
1         superseded  web-0.3.0  1.4.0        Install complete
2         superseded  web-0.3.0  1.4.0        Upgrade complete
3         deployed    web-0.3.0  1.4.0        Upgrade complete
$ helm rollback web 2 -n shop-prod
Rollback was a success! Happy Helming!
$ helm history web -n shop-prod --max 1
REVISION  STATUS      CHART      APP VERSION  DESCRIPTION
4         deployed    web-0.3.0  1.4.0        Rollback to 2`;

export const RELEASE_WHY =
  '`helm upgrade --install` ставит релиз, если его нет, и обновляет, если есть, — поэтому конвейеры пишут именно так. Каждый вызов создаёт ревизию: Helm запоминает, какие манифесты и какие values ушли в кластер. `helm rollback web 2` берёт ревизию 2 и применяет её **как новую**, четвёртую: история только растёт. Вывод ниже — форма по документации, а не снятый с кластера.';

export const RELEASE_FACTS = [
  {
    t: 'История живёт в кластере',
    d: 'Каждая ревизия — Secret `sh.helm.release.v1.web.v4` в пространстве имён релиза: сжатые манифесты и values. Удалили пространство — пропала и история. Хранится по умолчанию десять последних ревизий (`--history-max`) — по документации Helm 3.',
  },
  {
    t: '`APP VERSION` — из `Chart.yaml`',
    d: 'Колонка показывает `appVersion` чарта, а не образ, который реально работает. Тег пришёл через `--set image.tag=1.4.2`, а в истории стоит `1.4.0`. Что было в ревизии на самом деле, показывает `helm get values web --revision 2`.',
    tone: 'warn' as const,
  },
  {
    t: 'Трёхстороннее слияние',
    d: 'Helm 3 при обновлении сравнивает три вещи: прошлые манифесты, живой объект и новые манифесты. Ручная правка поля, которого чарт не касается, переживает `upgrade`. Правка поля из чарта откатывается к чарту.',
  },
  {
    t: 'Дождаться и откатить',
    d: '`--wait` не завершает команду, пока поды не станут готовы. `--atomic` сверх того сам откатывает релиз, если обновление не удалось. Без них `upgrade` возвращает успех, как только API принял манифесты, — ровно как `kubectl apply`.',
  },
];

export const HOOK_CODE = `apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-migrate
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          command: ["npm", "run", "db:migrate"]`;

export const HOOK_NOTE =
  'Хук — обычный объект из `templates/` с аннотацией `helm.sh/hook`. Helm создаёт его не вместе со всеми, а в свой момент: `pre-upgrade` — до обновления, и ждёт, пока Job завершится. Упала миграция — обновление не начинается. По документации есть ещё `post-install`, `pre-delete`, `pre-rollback`, `test` и другие, вес задаёт порядок, а `hook-delete-policy` — когда убрать объект. Две вещи стоит помнить. Хук не часть релиза: `helm uninstall` его не удаляет. И `helm rollback` возвращает манифесты, но не схему базы: откатывать миграцию нужно отдельной миграцией.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 7 — сравнение и демо
// ─────────────────────────────────────────────────────────────────────────────────────

export const COMPARE = {
  head: ['', 'Kustomize', 'Helm'],
  rows: [
    ['что пишут', 'обычные манифесты и патчи к ним', 'шаблоны с пропусками и значения для них'],
    ['где логика', 'нет её: только наложение', 'условия, циклы, функции в шаблонах'],
    ['списки', 'сливаются по ключу — схема типа знает какой', 'заменяются целиком'],
    ['смена ConfigMap', 'хеш в имени — поды перезапустятся сами', 'нужна аннотация с контрольной суммой в шаблоне пода'],
    ['что хранит кластер', 'только объекты', 'объекты плюс историю релиза'],
    ['откат', 'применить прошлую версию из Git', '`helm rollback` или прошлая версия из Git'],
    ['раздать другим', 'папкой или ссылкой на Git', 'пакетом с версией: репозиторий или OCI-реестр'],
    ['где удобнее', 'свои приложения, где окружения отличаются немного', 'чужие программы и чарты для многих команд с десятками настроек'],
  ],
  cols: 'minmax(140px,.6fr) minmax(240px,1.2fr) minmax(240px,1.2fr)',
  kinds: ['prose', 'prose', 'prose'] as ('prose')[],
  minWidth: 660,
};

export const COMPARE_NOTE =
  'Инструменты не исключают друг друга. Kustomize умеет развернуть чарт (`helmCharts` в `kustomization.yaml`) и наложить патч на результат. Так правят чужой чарт, у которого нужной настройки нет в `values`. Про аннотацию с контрольной суммой: в документации Helm это приём `checksum/config` — в шаблон пода кладут `sha256sum` от отрисованного ConfigMap. Меняется содержимое — меняется аннотация — начинается выкат.';

export const DEMO_WHY =
  'Демо собирает все три окружения сквозного примера обоими способами. Слияние патчей и values считают функции, напечатанные выше, а сборку слоёв и рендер шаблонов — служебные части той же учебной модели.';

export const DEMO_NOTE =
  'Выберите окружение и способ. Слева — то, что написано для окружения: слой kustomize или файл values с командой. Справа — итоговые манифесты, подсвечены строки, которых нет в базе. Для Kustomize база — `base/`, для Helm — рендер без файла окружения. Переключатель «замена списка» показывает, что будет, если патч слить без ключей слияния. Сравните prod и dev.';

export const DEMO_CAPTION =
  'Итог считает учебная модель темы, а не кластер. Модель знает только поля и конструкции сквозного примера, а хеш в имени ConfigMap у неё свой, не как у kustomize.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 8 — GitOps
// ─────────────────────────────────────────────────────────────────────────────────────

export const GITOPS_WHY =
  'До сих пор манифесты собирали и применяли снаружи: разработчик или конвейер CI запускает `kubectl apply` или `helm upgrade`. GitOps переворачивает направление. Желаемое состояние лежит в Git, а **внутри кластера** работает контроллер — Argo CD или Flux. Он следит за репозиторием, собирает манифесты тем же Kustomize или Helm и сверяет их с кластером: нашёл разницу — применил. Это тот же цикл сведения, что у контроллеров Kubernetes, только желаемое читается не из API, а из Git. Как устроен сам цикл, разобрано в [«Kubernetes: развёртывании»](/delivery/kubernetes/#s1).';

export const PLAIN_GITOPS =
  'Git — журнал приказов, а контроллер — дежурный, который раз в несколько минут сверяет склад с журналом. Приказ «выдать четыре ящика» он выполнит, даже если никто ему ничего не сказал: достаточно, что приказ записан. Если кто-то унёс ящик без приказа, дежурный вернёт его на место. А чтобы отменить приказ, пишут новый: «вернуть как было».';

export const PUSH_PULL = {
  head: ['', 'Push: применяет CI', 'Pull: тянет контроллер'],
  rows: [
    ['кто ходит в кластер', 'конвейер, с доступом к кластеру в своих секретах', 'только контроллер, изнутри кластера'],
    ['что делает CI', 'собирает образ и применяет манифесты', 'собирает образ и делает коммит с новым тегом'],
    ['ручная правка в кластере', 'живёт до следующего выката', 'видна как дрейф; с `selfHeal` откатывается сама'],
    ['что сейчас в кластере', 'последний успешный запуск конвейера', 'коммит, который контроллер показывает как синхронизированный'],
    ['откат', 'перезапустить старый конвейер', '`git revert`'],
    ['много кластеров', 'конвейеру нужен доступ к каждому', 'в каждом свой контроллер смотрит в один репозиторий'],
  ],
  cols: 'minmax(160px,.7fr) minmax(240px,1.2fr) minmax(240px,1.2fr)',
  kinds: ['prose', 'prose', 'prose'] as ('prose')[],
  minWidth: 680,
};

export const PUSH_NOTE =
  'Push-доставка никуда не делась: как устроены окружения, одобрения и ручной выкат в конвейере, разобрано в [«GitHub Actions»](/delivery/github-actions/#s7) (подраздел «Окружения и одобрения») и в [«GitLab CI»](/delivery/gitlab-ci/#s5) (подраздел «Ручной выкат и окружения»). В pull-схеме от этого остаётся первая половина: сборка и публикация образа. Вторая половина — коммит в репозиторий доставки.';

export const FLOW_STEPS = [
  '**CI собирает образ** `registry.example.com/shop/web:1.4.3` и публикует его.',
  '**CI меняет тег в репозитории доставки**: `kustomize edit set image registry.example.com/shop/web:1.4.3` в `overlays/stage` — и коммит. Для prod тот же шаг часто идёт через merge request: одобрение выката — это одобрение изменения в Git.',
  '**Контроллер замечает коммит** — по опросу или по вебхуку — и собирает `overlays/stage`.',
  '**Контроллер применяет разницу** и показывает статус: синхронизировано ли и здоровы ли объекты.',
  '**Откат** — `git revert` этого коммита. Контроллер проходит тот же путь в обратную сторону: тег возвращается, и ConfigMap с хешем в имени тоже возвращается к старому.',
];

export const ARGO_CODE = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: web-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://git.example.com/shop/deploy.git
    targetRevision: main
    path: overlays/prod            # тот же слой, что собирает kustomize build
  destination:
    server: https://kubernetes.default.svc
    namespace: shop-prod
  syncPolicy:
    automated:
      prune: true                  # удалять то, что исчезло из Git
      selfHeal: true               # возвращать то, что поправили руками`;

export const ARGO_FACTS = [
  {
    t: 'Как часто сверяет',
    d: 'По документации Argo CD опрашивает репозиторий раз в три минуты; вебхук от Git-сервера сокращает задержку до секунд. «Закоммитил — ничего не произошло» в первые минуты — норма.',
  },
  {
    t: '`prune` по умолчанию выключен',
    d: 'Без `prune: true` объект, удалённый из Git, продолжает жить в кластере. Argo CD лишь пометит его как лишний. Выключено это нарочно: удаление по ошибке в Git стоило бы данных.',
    tone: 'warn' as const,
  },
  {
    t: '`selfHeal` — против ручных правок',
    d: 'С `selfHeal: true` ручная правка живого объекта откатывается к Git при следующей сверке. `kubectl scale` в prod перестаёт работать: реплики живут в Git. Поле, которым управляет кто-то ещё, — число реплик при автомасштабировании — исключают из сверки через `ignoreDifferences` или просто не пишут в манифест.',
    tone: 'warn' as const,
  },
  {
    t: 'Helm без релиза',
    d: 'Чарт Argo CD разворачивает сам: рендерит его как `helm template` и применяет манифесты. Релиза Helm при этом нет — `helm list` пуст, `helm history` и `helm rollback` не работают, хуки Helm переведены в хуки Argo CD. Откат здесь — только через Git.',
    tone: 'err' as const,
  },
];

export const FLUX_CODE = `apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: deploy
  namespace: flux-system
spec:
  interval: 1m                     # как часто проверять репозиторий
  url: https://git.example.com/shop/deploy.git
  ref:
    branch: main
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization                # объект Flux, не файл kustomize: совпало только имя
metadata:
  name: web-prod
  namespace: flux-system
spec:
  interval: 10m                    # как часто сверять кластер с Git
  sourceRef:
    kind: GitRepository
    name: deploy
  path: ./overlays/prod
  prune: true
  targetNamespace: shop-prod`;

export const FLUX_FACTS = [
  {
    t: 'Два `Kustomization`',
    d: 'У Flux есть объект `Kustomization` из группы `kustomize.toolkit.fluxcd.io` — «что собрать и откуда». А в папке слоя лежит `kustomization.yaml` из группы `kustomize.config.k8s.io` — «как собрать». Имя совпадает, смысл разный, и в поиске они путаются постоянно.',
    tone: 'warn' as const,
  },
  {
    t: 'Helm — настоящий',
    d: 'Для чартов у Flux есть `HelmRelease`, и в отличие от Argo CD он ставит настоящий релиз Helm: история, хуки и `helm list` на месте. Откат по-прежнему правильнее делать через Git: иначе следующая сверка вернёт то, что написано в репозитории.',
  },
  {
    t: 'Два интервала',
    d: '`interval` у источника — как часто смотреть в Git, у `Kustomization` — как часто сверять кластер, даже если Git не менялся. Второй и есть защита от дрейфа. Названия полей и групп — по документации Flux 2.',
  },
];

export const REVERT_NOTE =
  '**Откат — это `git revert`, и у него та же граница, что у любого отката манифестов.** Вернутся тег образа, число реплик, настройки. Не вернутся данные: миграция базы, записанные файлы, отправленные письма. Поэтому миграции пишут так, чтобы старая версия приложения работала с новой схемой, — тогда откат кода безопасен. И ещё одно: в Argo CD при включённой автоматической синхронизации кнопка отката в интерфейсе недоступна — по документации. Контроллер вернул бы всё к Git на следующей сверке, так что откат там только через Git.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 9 — секреты в Git
// ─────────────────────────────────────────────────────────────────────────────────────

export const SECRET_WHY =
  'GitOps требует, чтобы в Git лежало всё. Но Secret в Git — это пароль в открытом виде: base64 — кодировка, а история Git хранит каждую версию навсегда. Решение одно по сути: в Git кладут **шифр**, а ключ от него есть только у кластера или у контроллера. Инструменты различаются тем, где живёт ключ и что именно шифруется.';

export const SEALED_CODE = `apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: web-secrets
  namespace: shop-prod
spec:
  encryptedData:
    SENTRY_DSN: AgBy3i4OJSWK+PiTySYZZA9rO43cGDEq...   # шифр, а не base64 от значения
  template:
    metadata:
      name: web-secrets`;

export const SOPS_CODE = `SENTRY_DSN: ENC[AES256_GCM,data:Tr7o1...,iv:1=...,tag:k2f...,type:str]
LOG_LEVEL: ENC[AES256_GCM,data:lJ7...,iv:0a...,tag:Qp...,type:str]
sops:
  age:
    - recipient: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
  lastmodified: "2026-09-01T10:00:00Z"
  mac: ENC[AES256_GCM,data:9sd...,type:str]
  version: 3.9.0`;

export const SECRET_TOOLS = [
  {
    t: 'Sealed Secrets',
    d: 'В кластере работает контроллер с парой ключей. Утилита `kubeseal` шифрует Secret **открытым** ключом кластера, и получается `SealedSecret`, который можно коммитить. Расшифровать его может только контроллер, и он создаёт обычный Secret. По умолчанию шифр привязан к имени и пространству имён: переименовали объект — придётся зашифровать заново. Закрытый ключ стоит сохранить отдельно: без него после потери кластера придётся перешифровать всё.',
  },
  {
    t: 'SOPS',
    d: 'Шифрует **значения**, а ключи оставляет открытыми: в `git diff` видно, какой параметр поменялся, но не на что. Ключи — age, PGP или облачный KMS. Flux расшифровывает SOPS сам (`decryption.provider: sops` в `Kustomization`). Argo CD — через плагин, например KSOPS или helm-secrets, — по документации обоих.',
  },
  {
    t: 'External Secrets',
    d: 'Третий путь — не класть шифр в Git вовсе. В Git лежит ссылка («возьми `sentry-dsn` из хранилища»), а оператор External Secrets достаёт значение из Vault или облачного менеджера секретов и создаёт Secret. Ротация пароля тогда не требует коммита.',
  },
];

export const SECRET_NOTE =
  'Общее у всех трёх: в кластере в итоге появляется **обычный Secret**, и всё, что сказано о его доступности, остаётся в силе. Любой, кто может читать Secret в пространстве имён или запустить там под, видит значение открытым. Шифрование в Git защищает репозиторий, а не кластер.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Тонкие места
// ─────────────────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Список заменился целиком — пропал контейнер или переменная',
    d: 'Values Helm сливают словари, но не списки: `extraEnv` из `values-dev.yaml` заменяет базовый, и `TZ` исчезает. JSON merge patch и любое слияние «на `Object.assign`» делают то же с `containers`. Strategic merge сливает по ключу, но только списки, у которых ключ есть в схеме. Лечится формой данных: переменные — словарём в values и циклом в шаблоне. Проверка в демо — dev в Helm и переключатель «замена списка» в Kustomize.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`replicas: 0` превращается в значение по умолчанию',
    d: '`{{ .Values.replicas | default 2 }}` считает ноль пустым, как `false` и `""`. Остановить окружение нулём реплик не выйдет — будет две. Для чисел и флагов, где ноль и `false` — законные значения, `default` не годится: проверяют наличие ключа (`hasKey`) или задают значение в `values.yaml`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Поменяли настройки — поды работают со старыми',
    d: 'Переменные из ConfigMap читаются при старте контейнера. Helm по умолчанию обновит ConfigMap и не тронет Deployment. Нужна аннотация с контрольной суммой в шаблоне пода. В kustomize то же ломается от `disableNameSuffixHash: true`: имя перестаёт меняться, и выката нет.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`commonLabels` на живом Deployment — и `apply` падает',
    d: '`commonLabels` дописывает метку в `spec.selector.matchLabels`, а селектор Deployment после создания менять нельзя. Добавили `env: prod` в слой, который уже выкачен, — `kubectl apply` отвечает ошибкой о неизменяемом поле. Выход — поле `labels` без `includeSelectors` или пересоздание объекта. Метки в селектор стоит закладывать при первом выкате и больше не трогать.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Опечатка в ключе values молча игнорируется',
    d: '`replicas: 4` вместо `replicaCount: 4` — ошибки нет, реплик две. Шаблон читает только те ключи, которые знает. Защита — `values.schema.json` с `additionalProperties: false`, либо `helm template` и сравнение итога до выката.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'JSON-патч по номеру правит не тот элемент',
    d: '`/spec/rules/0/host` — «первое правило», а не «правило магазина». Добавили в базу правило выше — патч молча переписывает хост у чужого. Перед `replace` ставят `test` на значение, которое ожидают увидеть: не совпало — сборка падает, а не выкатывает не то.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`--set` угадал тип, и API отверг манифест',
    d: '`--set buildNumber=1234` даёт число. В шаблоне `value: {{ .Values.buildNumber }}` оно печатается как `value: 1234`, а значение переменной окружения в Kubernetes обязано быть строкой — манифест отвергнут. Лечится `| quote` в шаблоне или `--set-string` в команде.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`helm history` показывает не ту версию приложения',
    d: 'Колонка `APP VERSION` берётся из `Chart.yaml`, а тег образа обычно приходит через `--set` из конвейера. Во всех ревизиях будет `1.4.0`, хотя работали три разных образа. Тег смотрят в `helm get values` нужной ревизии — или поднимают `appVersion` при каждом выпуске.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Под Argo CD у Helm нет ни истории, ни отката',
    d: 'Argo CD разворачивает чарт как `helm template` плюс применение манифестов. `helm list` пуст, `helm rollback` не к чему применить, а функция `lookup` в шаблоне возвращает пустоту: обращения к кластеру при рендере нет. Всё, что держалось на релизе, — через Git.',
    tone: 'err',
  },
  {
    n: '10',
    t: '`selfHeal` сражается с ручным скейлом и автомасштабированием',
    d: 'В пятницу вечером `kubectl scale --replicas=10` — а через минуту снова четыре: контроллер вернул число из Git. С автомасштабированием так же: автомасштабировщик поднимает реплики, контроллер опускает. Число реплик либо живёт в Git, либо не пишется в манифест вовсе и исключается из сверки.',
    tone: 'warn',
  },
  {
    n: '11',
    t: 'Удалили манифест из Git — объект остался',
    d: 'В Argo CD `prune` по умолчанию выключен: убранный из репозитория сервис продолжает работать, только помечен как лишний. Во Flux без `prune: true` — то же. Включают осознанно, вместе с защитой важных объектов аннотацией, запрещающей удаление.',
    tone: 'warn',
  },
  {
    n: '12',
    t: 'SealedSecret перестал расшифровываться после переименования',
    d: 'Шифр по умолчанию привязан к имени и пространству имён: `SealedSecret`, перенесённый в `shop-stage` копированием файла, контроллер там не откроет. Для каждого окружения шифруют отдельно — это и правильно: у stage и prod разные пароли.',
    tone: 'warn',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Источники
// ─────────────────────────────────────────────────────────────────────────────────────

export const SOURCES = [
  {
    title: 'Kubernetes: Update API Objects in Place Using kubectl patch',
    href: 'https://kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/',
    what: 'strategic merge против JSON merge на списке контейнеров, `tolerations` без ключа слияния, `$retainKeys` — случаи из `SMP_CASES`',
  },
  {
    title: 'Kubernetes: Strategic Merge Patch (kubernetes/community)',
    href: 'https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/strategic-merge-patch.md',
    what: 'директивы `$patch: delete`, `$patch: replace`, `$retainKeys`, удаление ключа через `null`',
  },
  {
    title: 'Kubernetes: Declarative Management of Kubernetes Objects Using Kustomize',
    href: 'https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/',
    what: 'база и слои, `kubectl apply -k`, генераторы и хеш в имени, `namePrefix`, `commonLabels`, патчи',
  },
  {
    title: 'Kustomize: справочник kustomization',
    href: 'https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/',
    what: '`images` — **пример из `IMAGE_CASES`**, `configMapGenerator` и `behavior`, `patches`, `labels`, устаревшие поля',
  },
  {
    title: 'RFC 6902: JSON Patch и RFC 7386: JSON Merge Patch',
    href: 'https://www.rfc-editor.org/rfc/rfc6902',
    what: 'операции и адреса; **приложения A обоих RFC** прогоняются тестом через модель (RFC 7386 — rfc-editor.org/rfc/rfc7386)',
  },
  {
    title: 'Helm: Values Files',
    href: 'https://helm.sh/docs/chart_template_guide/values_files/',
    what: 'порядок `values.yaml` < `-f` < `--set`, удаление ключа по умолчанию через `null`',
  },
  {
    title: 'Helm: Using Helm',
    href: 'https://helm.sh/docs/intro/using_helm/',
    what: 'несколько `-f` — правый сильнее, формат и ограничения `--set`, `--set-string`, `upgrade --install`, `rollback`, `history`',
  },
  {
    title: 'Helm: Chart Template Guide',
    href: 'https://helm.sh/docs/chart_template_guide/',
    what: 'встроенные объекты, пайплайны, `default`, `quote`, `required`, `with` и `$`, обрезка пробелов, `toYaml | nindent`',
  },
  {
    title: 'Helm: Chart Hooks и Charts Tips and Tricks',
    href: 'https://helm.sh/docs/topics/charts_hooks/',
    what: 'виды хуков, вес и политика удаления; соседняя страница — приём `checksum/config` для перезапуска при смене ConfigMap',
  },
  {
    title: 'Helm: Charts — schema files',
    href: 'https://helm.sh/docs/topics/charts/#schema-files',
    what: '`values.schema.json` и когда Helm его проверяет',
  },
  {
    title: 'Argo CD: Automated Sync Policy и Helm',
    href: 'https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/',
    what: '`prune`, `selfHeal`, интервал опроса, откат при автосинхронизации; страница Helm — рендер через `helm template`',
  },
  {
    title: 'Flux: Kustomization и HelmRelease',
    href: 'https://fluxcd.io/flux/components/kustomize/kustomizations/',
    what: '`interval`, `prune`, `targetNamespace`, расшифровка SOPS; `HelmRelease` ставит настоящий релиз',
  },
  {
    title: 'Sealed Secrets',
    href: 'https://github.com/bitnami-labs/sealed-secrets',
    what: '`kubeseal`, привязка шифра к имени и пространству, обновление и резервная копия ключей',
  },
  {
    title: 'SOPS',
    href: 'https://github.com/getsops/sops',
    what: 'шифрование значений при открытых ключах, age, PGP и KMS',
  },
  {
    title: 'OpenGitOps: принципы',
    href: 'https://opengitops.dev/',
    what: 'четыре принципа: декларативно, версионировано, притягивается автоматически, сверяется постоянно',
  },
];

export const RELATED =
  'Смежное на сайте: [Kubernetes: развёртывание](/delivery/kubernetes/) — выкат, откат и цикл сведения, на котором стоит GitOps. [Вход в кластер](/delivery/ingress/) — хост и сертификат, которые меняются от окружения к окружению. [Docker: образ и слои](/delivery/docker/) — тот самый один образ на все окружения. [GitHub Actions](/delivery/github-actions/) и [GitLab CI](/delivery/gitlab-ci/) — конвейер, который собирает образ и выкатывает его по push-схеме. [Docker Compose](/delivery/compose/) — переменные окружения и окружения на одной машине. [Инфраструктура как код](/delivery/infrastructure-as-code/) — состояние, план и граф Terraform/OpenTofu, `count` против `for_each`.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Трудные места — подробно
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Одна команда prod, пять ключей. Автор курса (2026-09-29): трудное не сокращать, а объяснять
 * подробно и просто. `PRECEDENCE` и `VALUES_WHY` давали порядок и правило слияния общими
 * словами; здесь они прогнаны по ключам сквозного примера — `chart/values.yaml`,
 * `values-prod.yaml`, `values-dev.yaml` и `COMMANDS.prod`. Итоговые значения следуют из
 * `mergeValues` в `VALUES_CODE` (его исполняет тест темы на `VALUES_CASES`); опечатка —
 * из `TYPO_NOTE`. Отдельного прогона этих пяти строк нет.
 */
export const VALUES_SCENE: string[] = [
  'Команда выката prod из сквозного примера: `helm upgrade --install web ./chart -f values-prod.yaml --set image.tag=1.4.2`. Значения собираются в три слоя, от слабого к сильному: `values.yaml` чарта, потом `values-prod.yaml`, потом `--set`. Проследим пять ключей — у каждого свой способ слияния.',
  'Что было бы, **если бы файл окружения заменял values целиком**. В `values-prod.yaml` шесть строк: окружение, реплики, ресурсы. Всё остальное — адрес образа, адрес API, настройки Ingress — пропало бы, и prod собрался бы без репозитория образа и без хоста. Файл окружения пришлось бы держать полной копией `values.yaml` и править в трёх местах сразу. Слияние вглубь и нужно, чтобы слой называл только отличия.',
];

export const VALUES_WALK: { k: string; how: string; result: string }[] = [
  {
    k: '`replicaCount` — число',
    how: 'в чарте `2`, в `values-prod.yaml` — `4`. Скаляр не сливается, а заменяется: сильнее слой — его значение',
    result: '`4`',
  },
  {
    k: '`resources` — словарь',
    how: 'в чарте `requests: {cpu: 100m, memory: 128Mi}`; в prod — `requests: {cpu: 250m}` и новый `limits: {memory: 512Mi}`. Словари сливаются вглубь, ключ за ключом: `cpu` заменён, `memory` в `requests` остался из чарта, `limits` добавлен',
    result: '`requests: {cpu: 250m, memory: 128Mi}`, `limits: {memory: 512Mi}`',
  },
  {
    k: '`image` — словарь, и `--set` поверх',
    how: 'в чарте `repository` и пустой `tag`; файл prod `image` не трогает; `--set image.tag=1.4.2` сильнее любого файла и меняет только `tag` — `repository` остаётся из чарта',
    result: '`registry.example.com/shop/web`, тег `1.4.2`',
  },
  {
    k: '`extraEnv` — список (в dev)',
    how: 'в чарте два элемента, `LOG_LEVEL` и `TZ`; в `values-dev.yaml` — один, `LOG_LEVEL: debug`. Ключа слияния у Helm нет, и список из файла **заменяет** базовый целиком',
    result: 'только `LOG_LEVEL: debug` — `TZ` пропал, хотя его никто не удалял',
  },
  {
    k: '`replicas` — опечатка',
    how: 'если бы в `values-prod.yaml` написали `replicas: 4` вместо `replicaCount: 4`, Helm положил бы новый ключ рядом с настоящим. Шаблон читает `replicaCount` и нового ключа не видит',
    result: '`replicaCount` остался `2` из чарта. Ни ошибки, ни предупреждения — пока нет `values.schema.json`',
  },
];

/** Продолжение `PLAIN_TEMPLATE` — тот же бланк, но с тремя слоями правок. */
export const PLAIN_VALUES =
  'Тот же бланк. `values.yaml` — отпечатанный образец, заполненный целиком. Файл окружения — прозрачная плёнка сверху: на ней вписаны только исправления, а там, где плёнка пустая, просвечивает образец. `--set` — ещё одна плёнка поверх, самая верхняя. Разделы бланка (словари) правятся по строчкам. А таблица-список правится только целиком: вписали в плёнку одну строку таблицы — остальные строки образца под ней больше не видны.';

/**
 * Одна ручная правка ночью. Автор курса (2026-09-29): не сокращать, а объяснять подробно.
 * `PUSH_PULL` сравнивала модели таблицей, `ARGO_CODE` и `FLUX_CODE` называли `prune`,
 * `selfHeal` и `interval` комментариями. Здесь одно событие — ручная правка и удалённый
 * из Git файл — прослежено через четыре настройки. Поведение — ровно `PUSH_PULL`, комментарии
 * листингов и `GITOPS_WHY` (документация Argo CD «Automated Sync Policy», Flux «Kustomization»).
 * В кластере не проверялось.
 */
export const DRIFT_SCENE: string[] = [
  'Ночью в prod растёт нагрузка, и дежурный руками делает `kubectl scale deploy web --replicas=8` — в Git по-прежнему записано `4`. Утром в репозитории доставки удаляют файл старого Ingress, который больше не нужен. Два расхождения между кластером и Git: одно появилось в кластере, другое — в Git.',
  'Что было бы **без сверки вовсе** — если бы манифесты применялись один раз и забывались. Восемь реплик остались бы в кластере навсегда, и никто, читая Git, об этом не узнал бы: «что сейчас в кластере» и «что записано» разошлись бы молча. Старый Ingress тоже остался бы жить — удаление файла само ничего не удаляет.',
];

export const DRIFT_WALK: { k: string; scale: string; removed: string; cost: string }[] = [
  {
    k: 'Push: применяет конвейер',
    scale: 'восемь реплик живут **до следующего выката**: следующий `apply` вернёт `4`, и сделает это посреди рабочего дня, не спрашивая',
    removed: 'при `kubectl apply` Ingress остаётся: команда применяет то, что есть в файлах, а об исчезнувшем файле не знает',
    cost: 'Что в кластере сейчас, знает только последний запуск конвейера.',
  },
  {
    k: 'Argo CD, автоматическая синхронизация без `selfHeal`',
    scale: 'контроллер видит разницу и показывает приложение рассинхронизированным — **дрейф виден**, но не исправлен: автоматическая синхронизация срабатывает на изменения в Git',
    removed: 'с `prune: true` Ingress удаляется: его нет в Git — значит, его не должно быть и в кластере',
    cost: 'Ручная правка переживает ночь, но на виду у всех — решение, откатывать ли, остаётся за человеком.',
  },
  {
    k: 'Argo CD с `selfHeal: true`',
    scale: 'контроллер возвращает `4` сам — ручная правка живёт до ближайшей сверки',
    removed: 'как и выше, с `prune: true` — удалён',
    cost: 'Ночное «добавить реплик руками» больше не работает: правка должна идти через Git. Для срочных мер это надо знать **до** ночи.',
  },
  {
    k: 'Flux, `interval: 10m`',
    scale: 'при каждой сверке Flux применяет Git заново — в листинге это раз в десять минут, и через столько восемь реплик снова станут четырьмя',
    removed: 'с `prune: true` — удалён при сверке',
    cost: 'Та же цена, что у `selfHeal`. Разница в сроке: ручная правка живёт до конца текущего интервала — здесь до десяти минут.',
  },
];

/** Продолжение `PLAIN_GITOPS` — тот же дежурный на ночной правке. */
export const PLAIN_DRIFT =
  'Тот же дежурный и журнал приказов. Ночью кладовщик без приказа вынес на полку ещё четыре ящика. Дежурный без права вмешиваться (`selfHeal` выключен) записывает: «на полке не то, что в журнале», — и ждёт решения. Дежурный с правом (`selfHeal`) молча уносит лишнее обратно. А утром из журнала вычеркнули старую строку, и `prune` означает: вычеркнутое со склада убирают, а не оставляют пылиться.';

/* ──────────────────── Схемы ──────────────────── */

/**
 * Push против pull — раздел «GitOps», подраздел «Push против pull», перед таблицей
 * `PUSH_PULL`.
 *
 * Изображает строки `PUSH_PULL` (кто ходит в кластер, что делает CI, откат) и первые четыре
 * шага `FLOW_STEPS` как две дорожки с участниками. Главное, что добавляет картинка к таблице, —
 * **направление стрелки** к кластеру: в push её тянет конвейер снаружи, в pull — контроллер
 * изнутри. Имена — из сквозного примера темы (`overlays/stage`, Argo CD, Flux). По документации
 * Argo CD и Flux, в кластере не проверялось — как и всё в разделе.
 */
export const PUSH_PULL_DIAGRAM = {
  title: 'Кто ходит в кластер',
  lanes: [
    {
      name: 'Push: применяет CI',
      tone: 'warn',
      nodes: [
        { kind: 'ci', text: '**конвейер CI** собирает образ и публикует его' },
        { kind: 'arrow', dir: 'down', text: '`helm upgrade` / `kubectl apply` — доступ к кластеру лежит в секретах конвейера' },
        { kind: 'cluster', text: '**кластер** — в нём то, что применил последний успешный запуск' },
      ],
      foot: [
        'ручная правка живёт до следующего выката',
        'откат — перезапустить старый конвейер',
      ],
    },
    {
      name: 'Pull: тянет контроллер',
      tone: 'ok',
      nodes: [
        { kind: 'ci', text: '**конвейер CI** собирает образ и делает коммит с новым тегом' },
        { kind: 'arrow', dir: 'down', text: 'коммит: `kustomize edit set image …:1.4.3` в `overlays/stage`' },
        { kind: 'git', text: '**репозиторий доставки** — записанное желаемое состояние' },
        { kind: 'arrow', dir: 'up', text: 'контроллер сам замечает коммит — опросом или по вебхуку' },
        { kind: 'cluster', text: '**кластер** · внутри контроллер Argo CD или Flux: собирает `overlays/stage`, сверяет, применяет разницу' },
      ],
      foot: [
        'в кластер ходит только контроллер, изнутри',
        'ручная правка видна как дрейф; с `selfHeal` откатывается сама',
        'откат — `git revert`',
      ],
    },
  ] as {
    name: string;
    tone: 'warn' | 'ok';
    nodes: { kind: 'ci' | 'git' | 'cluster' | 'arrow'; dir?: 'up' | 'down'; text: string }[];
    foot: string[];
  }[],
  caption:
    'В push-схеме стрелка в кластер идёт снаружи, от конвейера с ключом; в pull-схеме конвейер доходит только до Git, а в кластер смотрит контроллер изнутри.',
};
