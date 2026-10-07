/**
 * Сторона сверки, которой нужен DOM: снять дерево с документа и собрать отчёт.
 *
 * Исходник страницы берётся повторным запросом того же адреса: статический сайт отдаёт
 * ровно тот HTML, который браузер разобрал при загрузке. Разбирает его `DOMParser` —
 * без исполнения скриптов, то есть это дерево «до всех», и до скриптов сайта, и до
 * расширений. Живой документ — то, что есть сейчас.
 *
 * Чего сверка не видит и не может увидеть — подписано в теме рядом с демо:
 * внутренности островов (их переписывает гидратация), закрытые теневые корни, CSS,
 * который прячет или красит, и код, который ничего не вставляет, а только перехватывает.
 */
import {
  diffTrees,
  extraAttributes,
  isExtensionUrl,
  type AuditNode,
  type Finding,
} from './tree';

/** Острова Astro: их содержимое после гидратации законно отличается от серверного. */
const OPAQUE = new Set(['astro-island']);
/** Узлы, которые браузер или сам парсер ведёт по-разному в двух деревьях. */
const SKIP = new Set(['noscript', 'template']);

function label(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const classes = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
  return `${tag}${id}${classes}`.slice(0, 64);
}

function urlOf(el: Element): string {
  return el.getAttribute('src') ?? el.getAttribute('href') ?? '';
}

export function toAuditNode(el: Element, origin: string): AuditNode {
  const tag = el.tagName.toLowerCase();
  const url = urlOf(el);
  let sameOriginUrl = false;
  if (url) {
    try {
      sameOriginUrl = new URL(url, origin).origin === origin;
    } catch {
      sameOriginUrl = false;
    }
  }
  return {
    tag,
    label: label(el),
    opaque: OPAQUE.has(tag),
    sameOriginUrl,
    children: OPAQUE.has(tag)
      ? []
      : [...el.children]
          .filter((child) => !SKIP.has(child.tagName.toLowerCase()))
          .map((child) => toAuditNode(child, origin)),
  };
}

/** Элементы с адресом расширения — во всём документе, включая острова. */
export function extensionUrls(doc: Document): string[] {
  const hits: string[] = [];
  for (const el of doc.querySelectorAll('[src], [href]')) {
    const url = urlOf(el);
    if (isExtensionUrl(url)) hits.push(`${label(el)} → ${url.slice(0, 80)}`);
  }
  return hits;
}

export interface AuditReport {
  /** Сколько элементов в живом документе — для масштаба. */
  elements: number;
  findings: Finding[];
  /** Атрибуты на `<html>` и `<body>`, которых нет в исходнике. */
  attributes: string[];
  extensionUrls: string[];
  /** Сколько островов сверка обошла стороной. */
  islands: number;
}

export function auditDocument(live: Document, source: Document, origin: string): AuditReport {
  const attrs = (doc: Document, tag: 'html' | 'body') => {
    const el = tag === 'html' ? doc.documentElement : doc.body;
    return el ? el.getAttributeNames().map((name) => `<${tag}> ${name}`) : [];
  };
  return {
    elements: live.getElementsByTagName('*').length,
    findings: diffTrees(
      toAuditNode(source.documentElement, origin),
      toAuditNode(live.documentElement, origin),
    ),
    attributes: extraAttributes(
      [...attrs(source, 'html'), ...attrs(source, 'body')],
      [...attrs(live, 'html'), ...attrs(live, 'body')],
    ),
    extensionUrls: extensionUrls(live),
    islands: live.getElementsByTagName('astro-island').length,
  };
}

/** То же для открытой вкладки: исходник — повторный запрос её адреса. */
export async function auditThisPage(): Promise<AuditReport> {
  const response = await fetch(location.href, { credentials: 'same-origin' });
  const html = await response.text();
  const source = new DOMParser().parseFromString(html, 'text/html');
  return auditDocument(document, source, location.origin);
}
