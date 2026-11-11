import type { SiteCase } from './types';

/** Site comes from the lesson's PSL examples; URL supplies the actual origin. */
export function compareBoundaries(
  document: SiteCase,
  hostSite = 'https://shop.com',
  hostURL = 'https://app.shop.com',
) {
  const origin = new URL(document.full).origin;
  const hostOrigin = new URL(hostURL).origin;
  return {
    origin,
    hostOrigin,
    sameSite: document.site === hostSite,
    sameOrigin: origin === hostOrigin,
  };
}
