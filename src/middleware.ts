import { defineMiddleware } from 'astro:middleware';
import { splitLinkWordsInHtml } from '@/shared/lib/format';

/**
 * Ссылки прозы — по словам, чтобы подчёркивание не шло по пробелам, растянутым выравниванием
 * по ширине (см. `splitLinkWordsInHtml`). Middleware, а не rehype-плагин: Markdown в Astro 7
 * собирает Sätteri, и rehype-плагины MDX он не запускает. Работает и в деве, и при сборке
 * статических страниц.
 */
export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  if (!response.headers.get('content-type')?.includes('text/html')) return response;
  const html = await response.text();
  return new Response(splitLinkWordsInHtml(html), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});
