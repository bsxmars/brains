import { describe, expect, it, vi } from 'vitest';
import { ANALYTICS_CODE, NRR_CODE, PAGESHOW_CODE, WS_CODE } from '@/content/platform/instant-navigation/data';

/** Executes the printed examples. This checks application policy, not browser eligibility for bfcache. */
class DocumentProbe extends EventTarget {
  prerendering = false;
  visibilityState = 'visible';
}
const transition = (type: string, persisted: boolean) => Object.assign(new Event(type), { persisted });

describe('instant-navigation: просмотр только после активации', () => {
  it.each([false, true])('prerendering=%s: отменённый предрендер не считается, активация считается один раз', (prerendering) => {
    const document = new DocumentProbe();
    document.prerendering = prerendering;
    const analytics = { pageview: vi.fn() };
    new Function('document', 'analytics', ANALYTICS_CODE)(document, analytics);
    expect(analytics.pageview).toHaveBeenCalledTimes(prerendering ? 0 : 1);
    document.prerendering = false;
    document.dispatchEvent(new Event('prerenderingchange'));
    document.dispatchEvent(new Event('prerenderingchange'));
    expect(analytics.pageview).toHaveBeenCalledTimes(1);
  });
});

describe('instant-navigation: восстановление живого документа', () => {
  it('обычный pageshow не повторяет инициализацию; восстановление обновляет данные и сессию', async () => {
    const window = new EventTarget();
    const document = new DocumentProbe();
    const refresh = vi.fn();
    const checkSession = vi.fn().mockResolvedValue(undefined);
    const analytics = { pageview: vi.fn() };
    const saveDraft = vi.fn();
    const socket = { close: vi.fn() };
    const location = { reload: vi.fn() };
    new Function('addEventListener', 'document', 'refreshVolatileData', 'checkSession', 'analytics',
      'saveDraft', 'socket', 'location', PAGESHOW_CODE)(
      window.addEventListener.bind(window), document, refresh, checkSession, analytics, saveDraft, socket, location);
    window.dispatchEvent(transition('pageshow', false));
    expect(refresh).not.toHaveBeenCalled();
    window.dispatchEvent(transition('pageshow', true));
    expect(refresh).toHaveBeenCalledOnce();
    expect(checkSession).toHaveBeenCalledOnce();
    expect(analytics.pageview).toHaveBeenCalledWith({ restoredFromBfcache: true });
    checkSession.mockRejectedValueOnce(new Error('expired'));
    window.dispatchEvent(transition('pageshow', true));
    await Promise.resolve();
    expect(location.reload).toHaveBeenCalledOnce();

    // Завершение процесса может не дать pagehide. Сохранение при hidden независимо от него.
    document.dispatchEvent(new Event('visibilitychange'));
    expect(saveDraft).not.toHaveBeenCalled();
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(saveDraft).toHaveBeenCalledOnce();
    window.dispatchEvent(transition('pagehide', true));
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('сокет создаётся при загрузке и повторно при persisted pageshow, закрывается при уходе', () => {
    const window = new EventTarget();
    const closes: ReturnType<typeof vi.fn>[] = [];
    class WebSocketProbe {
      close = vi.fn();
      constructor(readonly url: string) { closes.push(this.close); }
    }
    new Function('addEventListener', 'WebSocket', 'NOTIFY_URL', WS_CODE)(
      window.addEventListener.bind(window), WebSocketProbe, 'wss://example.test/notify');
    window.dispatchEvent(transition('pageshow', false));
    expect(closes).toHaveLength(1);
    window.dispatchEvent(transition('pagehide', true));
    expect(closes[0]).toHaveBeenCalledWith(1000, 'page hidden');
    window.dispatchEvent(transition('pageshow', true));
    expect(closes).toHaveLength(2);
  });

  it('нет Navigation Timing — диагностика отказа не падает', () => {
    const sendToAnalytics = vi.fn();
    new Function('performance', 'sendToAnalytics', NRR_CODE)({ getEntriesByType: () => [] }, sendToAnalytics);
    expect(sendToAnalytics).not.toHaveBeenCalled();
  });
});
