import { memo, useCallback, useMemo, useState } from 'react';
import { useFlash, useRenderCount } from '@/features/count-renders';
import { Btn, Frame, Node, Pills, Stat } from './parts';
import s from './demo.module.css';

/**
 * `useMemo` и `useCallback` как средство от лишних ре-рендеров — и честный показ того,
 * что без `memo` у дочернего компонента они бесполезны.
 *
 * Три тумблера дают восемь сочетаний, и ровно одно из них останавливает ре-рендер ребёнка:
 * `memo` **и** оба пропа стабильны. Один нестабильный проп обнуляет пользу от мемоизации
 * всех остальных — и добавляет стоимость сравнения.
 *
 * Кнопка меняет постороннее состояние: ни `items`, ни строка фильтра при этом не трогаются,
 * то есть у ребёнка нет ни одной содержательной причины перерисовываться.
 */

const ITEMS = ['alpha', 'beta', 'gamma', 'delta'];

interface ChildProps {
  data: string[];
  onSelect: () => void;
  withMemo: boolean;
}

function Child({ data, withMemo }: ChildProps) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  return (
    <Node
      name="Child"
      renders={renders}
      memo={withMemo}
      innerRef={ref}
      note="тяжёлый список — тот, чей ре-рендер и хочется убрать"
      value={`получил элементов: ${data.length}`}
    />
  );
}
const MemoChild = memo(Child);

interface LabProps {
  withMemo: boolean;
  stableData: boolean;
  stableCallback: boolean;
}

function Lab({ withMemo, stableData, stableCallback }: LabProps) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  const [unrelated, setUnrelated] = useState(0);
  const [query, setQuery] = useState('');

  // Оба варианта считаются всегда: хуки вызываются безусловно, тумблер только выбирает,
  // какую из двух ссылок отдать ребёнку.
  const memoized = useMemo(() => ITEMS.filter((item) => item.includes(query)), [query]);
  const recomputed = ITEMS.filter((item) => item.includes(query));
  const data = stableData ? memoized : recomputed;

  const stable = useCallback(() => {}, []);
  const onSelect = stableCallback ? stable : () => {};

  const C = withMemo ? MemoChild : Child;

  return (
    <Node
      name="Page"
      renders={renders}
      innerRef={ref}
      note="родитель: держит фильтр и постороннее состояние"
      value={`постороннее состояние: ${unrelated}`}
      extra={
        <>
          <Btn primary onClick={() => setUnrelated((x) => x + 1)}>
            изменить постороннее состояние
          </Btn>
          <input
            className={s.input}
            value={query}
            placeholder="фильтр"
            aria-label="строка фильтра"
            onChange={(event) => setQuery(event.target.value)}
          />
        </>
      }
    >
      <C data={data} onSelect={onSelect} withMemo={withMemo} />
    </Node>
  );
}

export default function MemoLab() {
  const [withMemo, setWithMemo] = useState<'on' | 'off'>('off');
  const [stableData, setStableData] = useState<'on' | 'off'>('off');
  const [stableCallback, setStableCallback] = useState<'on' | 'off'>('off');
  const [generation, setGeneration] = useState(0);

  const bump = () => setGeneration((g) => g + 1);
  const all = withMemo === 'on' && stableData === 'on' && stableCallback === 'on';

  return (
    <Frame
      bar={
        <>
          <Pills
            label="React.memo на Child"
            name="ml-memo"
            value={withMemo}
            onChange={(v) => { setWithMemo(v); bump(); }}
            options={[
              { value: 'off', label: 'выкл' },
              { value: 'on', label: 'вкл' },
            ]}
          />
          <Pills
            label="проп data"
            name="ml-data"
            value={stableData}
            onChange={(v) => { setStableData(v); bump(); }}
            options={[
              { value: 'off', label: 'filter на каждом рендере' },
              { value: 'on', label: 'useMemo' },
            ]}
          />
          <Pills
            label="проп onSelect"
            name="ml-cb"
            value={stableCallback}
            onChange={(v) => { setStableCallback(v); bump(); }}
            options={[
              { value: 'off', label: 'новая функция' },
              { value: 'on', label: 'useCallback' },
            ]}
          />
        </>
      }
      foot={
        <span>
          Кнопка меняет состояние, от которого ребёнок не зависит вовсе. Всё, что решает
          его судьбу, — сравнение ссылок в пропсах.
        </span>
      }
    >
      <Lab
        key={`${withMemo}-${stableData}-${stableCallback}-${generation}`}
        withMemo={withMemo === 'on'}
        stableData={stableData === 'on'}
        stableCallback={stableCallback === 'on'}
      />

      <div className={s.stats}>
        <Stat
          label="пропсы стабильны"
          value={stableData === 'on' && stableCallback === 'on' ? 'оба' : stableData === 'on' || stableCallback === 'on' ? 'один из двух' : 'ни одного'}
          tone={stableData === 'on' && stableCallback === 'on' ? 'ok' : 'warn'}
        />
        <Stat
          label="ребёнок уйдёт в bailout"
          value={all ? 'да' : 'нет'}
          tone={all ? 'ok' : 'warn'}
          note={
            withMemo === 'off'
              ? 'без memo сравнивать пропсы некому: useMemo и useCallback здесь — чистый расход'
              : 'memo сравнивает каждый проп через Object.is; одного отличия достаточно'
          }
        />
      </div>
    </Frame>
  );
}
