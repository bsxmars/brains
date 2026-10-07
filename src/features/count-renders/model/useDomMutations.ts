import { useEffect, useState, type RefObject } from 'react';

/**
 * Сколько раз по-настоящему изменился DOM внутри поддерева — главный прибор урока.
 *
 * Ре-рендер и обновление DOM — разные события, и весь урок держится на том, что читатель
 * увидит их порознь: счётчики в узлах считают вызовы функций, этот хук считает правки
 * документа. Считаются вставки и удаления узлов (`childList`) и правки текста
 * (`characterData`) — то, что пользователь видит.
 *
 * Атрибуты сознательно не наблюдаются: подсветка ре-рендера ставится атрибутом, и прибор
 * мерил бы сам себя.
 *
 * По той же причине из подсчёта выброшено всё, что лежит внутри `[data-meter]`: сами
 * счётчики — это текст, который меняется на каждом ре-рендере, и без фильтра «правок DOM»
 * никогда не было бы нуля.
 *
 * ⚠️ Хук обязан вызываться **вне** наблюдаемого поддерева: он держит состояние, а значит,
 * его владелец перерисовывается на каждую мутацию. Владелец внутри поддерева дал бы цикл.
 */
export function useDomMutations(target: RefObject<HTMLElement | null>, resetKey?: unknown): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const el = target.current;
    if (!el) return;

    const observer = new MutationObserver((records) => {
      const real = records.filter((record) => {
        const node = record.target;
        const element = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
        return !element?.closest('[data-meter]');
      });
      if (real.length) setCount((n) => n + real.length);
    });

    observer.observe(el, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [target]);

  useEffect(() => {
    setCount(0);
  }, [resetKey]);

  return count;
}
