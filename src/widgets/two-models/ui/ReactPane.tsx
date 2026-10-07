import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFlash } from '@/features/count-renders';
import { onAction } from '../model/bus';
import { createEditCounter, type EditCounter } from '../model/domEdits';
import { FILTER_QUERY, NODE_ORDER, TASK_ITEMS, makeItem, type TaskItem } from '../model/task';

/**
 * React-половина демо: та же задача, те же узлы, те же данные (`model/task.ts`).
 *
 * ⚠️ Счётчик работы увеличивается **в теле компонента**, то есть в render-фазе, где побочных
 * эффектов быть не должно. Это сознательный размен, тот же, что у прибора соседнего урока:
 * мерить надо именно вызовы функций, а всё остальное в React происходит уже после них.
 * Цена размена ровно та, о которой этот урок и говорит, — в StrictMode и при прерванном
 * конкурентном рендере число окажется больше числа видимых обновлений. Здесь нет ни того,
 * ни другого: остров монтируется без StrictMode, все обновления идут синхронной полосой.
 *
 * `<Profiler onRender>` не годится по другой причине: он вырезан из продакшен-сборки,
 * а сайт собирается статически.
 */
const work = { total: 0, byNode: {} as Record<string, number> };

function report(node: string): void {
  work.total += 1;
  work.byNode[node] = (work.byNode[node] ?? 0) + 1;
}

/* ---------------------------------- Узлы ---------------------------------- */

function Filter({ query }: { query: string }) {
  report('Filter');
  const ref = useFlash<HTMLDivElement>();
  return (
    <div ref={ref} className="tm-node" data-flash="off">
      <div className="tm-node-head">
        <span className="tm-node-name">{'<Filter/>'}</span>
      </div>
      <div className="tm-node-value">фильтр: {query || 'выключен'}</div>
    </div>
  );
}
const MemoFilter = memo(Filter);

function Counter({ shown, total }: { shown: number; total: number }) {
  report('Counter');
  const ref = useFlash<HTMLDivElement>();
  return (
    <div ref={ref} className="tm-node" data-flash="off">
      <div className="tm-node-head">
        <span className="tm-node-name">{'<Counter/>'}</span>
      </div>
      <div className="tm-node-value">
        {shown} из {total}
      </div>
    </div>
  );
}
const MemoCounter = memo(Counter);

function Row({ item }: { item: TaskItem }) {
  report('Row');
  const ref = useFlash<HTMLLIElement>();
  return (
    <li ref={ref} className="tm-row" data-flash="off">
      {item.name}
    </li>
  );
}
const MemoRow = memo(Row);

function List({ items, withMemo }: { items: TaskItem[]; withMemo: boolean }) {
  report('List');
  const ref = useFlash<HTMLDivElement>();
  const R = withMemo ? MemoRow : Row;
  return (
    <div ref={ref} className="tm-node" data-flash="off">
      <div className="tm-node-head">
        <span className="tm-node-name">{'<List/>'}</span>
      </div>
      <ul className="tm-list">
        {items.map((item) => (
          <R key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}
const MemoList = memo(List);

function Status({ tick }: { tick: number }) {
  report('Status');
  const ref = useFlash<HTMLDivElement>();
  return (
    <div ref={ref} className="tm-node" data-flash="off">
      <div className="tm-node-head">
        <span className="tm-node-name">{'<Status/>'}</span>
      </div>
      <div className="tm-node-value">нажатий: {tick}</div>
    </div>
  );
}
const MemoStatus = memo(Status);

/* --------------------------------- Задача --------------------------------- */

function App({ withMemo }: { withMemo: boolean }) {
  report('App');
  const ref = useFlash<HTMLDivElement>();

  const [query, setQuery] = useState('');
  const [items, setItems] = useState<TaskItem[]>([...TASK_ITEMS]);
  const [tick, setTick] = useState(0);
  const next = useRef(TASK_ITEMS.length + 1);

  /**
   * Оба варианта считаются всегда: хуки вызываются безусловно, тумблер только выбирает,
   * какую из двух ссылок отдать детям. Иначе переключение меняло бы состав хуков.
   */
  const memoized = useMemo(() => items.filter((item) => item.name.includes(query)), [items, query]);
  const recomputed = items.filter((item) => item.name.includes(query));
  const filtered = withMemo ? memoized : recomputed;

  useEffect(
    () =>
      onAction((action) => {
        if (action === 'tick') setTick((t) => t + 1);
        else if (action === 'query') setQuery((q) => (q ? '' : FILTER_QUERY));
        else if (action === 'add') setItems((prev) => [...prev, makeItem(next.current++)]);
      }),
    [],
  );

  const F = withMemo ? MemoFilter : Filter;
  const C = withMemo ? MemoCounter : Counter;
  const L = withMemo ? MemoList : List;
  const S = withMemo ? MemoStatus : Status;

  return (
    <div ref={ref} className="tm-node" data-flash="off">
      <div className="tm-node-head">
        <span className="tm-node-name">{'<App/>'}</span>
      </div>
      <div className="tm-node-note">держит три поля: строку фильтра, список и счётчик нажатий</div>

      <div className="tm-children">
        <F query={query} />
        <C shown={filtered.length} total={items.length} />
        <L items={filtered} withMemo={withMemo} />
        <S tick={tick} />
      </div>
    </div>
  );
}

/* -------------------------------- Приборы --------------------------------- */

interface Shot {
  ran: boolean;
  work: number;
  dom: number;
  byNode: { name: string; n: number }[];
}

const EMPTY: Shot = { ran: false, work: 0, dom: 0, byNode: [] };

/**
 * Прибор — отдельный компонент и лист, а не хук в панели.
 *
 * Он держит состояние, значит перерисовывается на каждое показание. Владелец внутри
 * наблюдаемого поддерева получил бы бесконечный цикл, а владелец над ним — испортил бы
 * все числа ниже: показания прибора считались бы работой.
 */
function Meters({ treeRef }: { treeRef: RefObject<HTMLDivElement | null> }) {
  const [shot, setShot] = useState<Shot>(EMPTY);
  const counter = useRef<EditCounter | null>(null);

  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    counter.current = createEditCounter(el);
    return () => {
      counter.current?.stop();
      counter.current = null;
    };
  }, [treeRef]);

  useEffect(
    () =>
      onAction((action) => {
        work.total = 0;
        work.byNode = {};
        counter.current?.reset();

        if (action === 'reset') {
          setShot(EMPTY);
          return;
        }

        /**
         * Обнуление происходит здесь, в обработчике события, — то есть заведомо раньше, чем
         * React начнёт рендерить: обновление из внешнего слушателя планируется микрозадачей.
         * А снимаются показания в `setTimeout`, потому что к этому моменту гарантированно
         * прошёл и коммит, и доставка записей наблюдателю за документом: и то, и другое —
         * микрозадачи.
         */
        window.setTimeout(() => {
          setShot({
            ran: true,
            work: work.total,
            dom: counter.current?.read() ?? 0,
            byNode: NODE_ORDER.map((name) => ({ name, n: work.byNode[name] ?? 0 })),
          });
        }, 0);
      }),
    [],
  );

  return (
    <div className="tm-meters" data-meter>
      <div className="tm-stats">
        <div className="tm-stat">
          <div className="tm-stat-label">вызовов функций</div>
          <div className="tm-stat-value">{shot.ran ? shot.work : '—'}</div>
          <div className="tm-stat-note">за последнее нажатие, вместе с монтированием</div>
        </div>
        <div className="tm-stat">
          <div className="tm-stat-label">правок DOM</div>
          <div className="tm-stat-value" data-tone={shot.ran && shot.dom === 0 ? 'ok' : undefined}>
            {shot.ran ? shot.dom : '—'}
          </div>
          <div className="tm-stat-note">вставки, удаления и правки текста</div>
        </div>
      </div>

      {shot.ran ? (
        <div className="tm-chips">
          {shot.byNode.map((node) => (
            <span key={node.name} className="tm-chip" data-zero={node.n === 0 ? 'yes' : 'no'}>
              {node.name}
              <span className="tm-chip-num">{node.n}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="tm-empty">нажмите кнопку наверху</div>
      )}
    </div>
  );
}

/** Радиогруппа вместо пары кнопок: стрелки на клавиатуре и объявление выбранного состояния. */
function Pills({
  value,
  onChange,
}: {
  value: 'off' | 'on';
  onChange: (value: 'off' | 'on') => void;
}) {
  return (
    <fieldset className="tm-pills">
      <legend className="tm-pills-label">React.memo на узлах</legend>
      {(['off', 'on'] as const).map((option) => (
        <label key={option} className="tm-pill">
          <input
            className="tm-pill-input"
            type="radio"
            name="two-models-memo"
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          <span>{option === 'off' ? 'нет' : 'везде'}</span>
        </label>
      ))}
    </fieldset>
  );
}

export default function ReactPane() {
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [withMemo, setWithMemo] = useState<'off' | 'on'>('off');
  const [generation, setGeneration] = useState(0);

  useEffect(
    () =>
      onAction((action) => {
        if (action === 'reset') setGeneration((g) => g + 1);
      }),
    [],
  );

  return (
    <section className="tm-pane">
      <header className="tm-pane-head">
        <span className="tm-pane-title">React 19</span>
        <span className="tm-pane-tag">вызовов функций компонентов</span>
        <Pills
          value={withMemo}
          onChange={(value) => {
            setWithMemo(value);
            setGeneration((g) => g + 1);
          }}
        />
      </header>

      {/* Смена тумблера перемонтирует дерево: иначе числа двух конфигураций складывались бы. */}
      <div className="tm-tree" ref={treeRef}>
        <App key={`${withMemo}-${generation}`} withMemo={withMemo === 'on'} />
      </div>

      <Meters treeRef={treeRef} />
    </section>
  );
}
