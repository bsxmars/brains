import { useEffect, useRef, type RefObject } from 'react';

/**
 * Подсветка узла на время, когда его функцию только что вызвали.
 *
 * Эффект без массива зависимостей выполняется после каждого рендера — ровно то, что нужно:
 * «мигнуло» означает «функция была вызвана и результат закоммичен».
 *
 * Подсветка ставится атрибутом напрямую, мимо состояния. Через `useState` она стоила бы
 * ещё одного ре-рендера на каждый ре-рендер — прибор показывал бы удвоенные числа.
 * По той же причине это `data-`атрибут, а не текст: наблюдатель за DOM в соседнем хуке
 * смотрит на структуру и текст, атрибуты он не считает, и подсветка не попадает в его счёт.
 */
export function useFlash<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.flash = 'on';
    const id = window.setTimeout(() => {
      if (ref.current) ref.current.dataset.flash = 'off';
    }, 420);
    return () => window.clearTimeout(id);
  });

  return ref;
}
