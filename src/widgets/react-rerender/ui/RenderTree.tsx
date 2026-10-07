import {
  createContext,
  memo,
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useFlash, useRenderCount } from '@/features/count-renders';
import { Btn, DomMeter, Frame, Node, Pills, Stat } from './parts';
import s from './demo.module.css';

/**
 * Живое дерево компонентов: какое поддерево перерисовалось и почему.
 *
 * Каждый узел показывает, сколько раз была вызвана его функция, и мигает в момент вызова.
 * Рядом — второй прибор, считающий настоящие правки DOM. Расхождение между этими двумя
 * числами и есть главный тезис урока.
 *
 * Все обработчики стабилизированы через `useCallback` намеренно: иначе `memo` ломался бы
 * о новую ссылку на каждом рендере, и тумблер проверял бы не то, что написано на нём.
 * Цену нестабильной ссылки показывает соседнее демо (`MemoLab`).
 *
 * Смена любого тумблера перемонтирует дерево — счётчики обнуляются. Иначе числа от разных
 * конфигураций складывались бы в одну кучу и сравнивать их было бы нельзя.
 */

type StateIn = 'App' | 'Content' | 'Counter';

const ThemeCtx = createContext('светлая');

interface Flags {
  withMemo: boolean;
}

function Header({ withMemo }: Flags) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  return (
    <Node
      name="Header"
      renders={renders}
      memo={withMemo}
      innerRef={ref}
      note="ничего не читает и ни от чего не зависит"
    />
  );
}
const MemoHeader = memo(Header);

function Sidebar({ withMemo }: Flags) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  return <Node name="Sidebar" renders={renders} memo={withMemo} innerRef={ref} note="боковая колонка" />;
}
const MemoSidebar = memo(Sidebar);

function Article({ withMemo }: Flags) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  return (
    <Node
      name="Article"
      renders={renders}
      memo={withMemo}
      innerRef={ref}
      note="«тяжёлый» блок — тот, ради которого всё и затевается"
    />
  );
}
const MemoArticle = memo(Article);

function ThemeLabel({ withMemo }: Flags) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  const theme = useContext(ThemeCtx);
  return (
    <Node
      name="ThemeLabel"
      renders={renders}
      memo={withMemo}
      innerRef={ref}
      note="потребитель контекста"
      value={`тема: ${theme}`}
    />
  );
}
const MemoThemeLabel = memo(ThemeLabel);

interface CounterProps extends Flags {
  stateIn: StateIn;
  count: number;
  onInc: (() => void) | null;
}

function Counter({ withMemo, stateIn, count, onInc }: CounterProps) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  const [own, setOwn] = useState(0);
  const bump = useCallback(() => setOwn((x) => x + 1), []);

  const value = stateIn === 'Counter' ? own : count;
  const handle = stateIn === 'Counter' ? bump : onInc;

  return (
    <Node
      name="Counter"
      renders={renders}
      memo={withMemo}
      innerRef={ref}
      note={stateIn === 'Counter' ? 'состояние здесь' : `состояние выше, в <${stateIn}/>`}
      value={`значение: ${value}`}
      extra={
        <Btn primary onClick={() => handle?.()}>
          счётчик +1
        </Btn>
      }
    />
  );
}
const MemoCounter = memo(Counter);

interface ContentProps extends Flags {
  stateIn: StateIn;
  count: number;
  onInc: (() => void) | null;
  children?: ReactNode;
}

function Content({ withMemo, stateIn, count, onInc, children }: ContentProps) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  const [own, setOwn] = useState(0);
  const bump = useCallback(() => setOwn((x) => x + 1), []);

  const value = stateIn === 'Content' ? own : count;
  const inc = stateIn === 'Content' ? bump : onInc;

  const C = withMemo ? MemoCounter : Counter;
  const T = withMemo ? MemoThemeLabel : ThemeLabel;
  const S = withMemo ? MemoSidebar : Sidebar;
  const A = withMemo ? MemoArticle : Article;

  return (
    <Node
      name="Content"
      renders={renders}
      memo={withMemo}
      innerRef={ref}
      note={stateIn === 'Content' ? 'состояние здесь' : 'просто узел на пути вниз'}
    >
      <C withMemo={withMemo} stateIn={stateIn} count={value} onInc={stateIn === 'Counter' ? null : inc} />
      <T withMemo={withMemo} />
      <S withMemo={withMemo} />
      {children ?? <A withMemo={withMemo} />}
    </Node>
  );
}
const MemoContent = memo(Content);

interface AppProps extends Flags {
  stateIn: StateIn;
  viaChildren: boolean;
  theme: string;
}

function App({ withMemo, stateIn, viaChildren, theme }: AppProps) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  const [count, setCount] = useState(0);
  const inc = useCallback(() => setCount((x) => x + 1), []);

  const H = withMemo ? MemoHeader : Header;
  const C = withMemo ? MemoContent : Content;
  const A = withMemo ? MemoArticle : Article;

  return (
    <ThemeCtx.Provider value={theme}>
      <Node name="App" renders={renders} innerRef={ref} note="провайдер контекста; memo на корень не вешают">
        <H withMemo={withMemo} />
        <C withMemo={withMemo} stateIn={stateIn} count={count} onInc={stateIn === 'App' ? inc : null}>
          {viaChildren ? <A withMemo={withMemo} /> : undefined}
        </C>
      </Node>
    </ThemeCtx.Provider>
  );
}

export default function RenderTree() {
  const [stateIn, setStateIn] = useState<StateIn>('App');
  const [withMemo, setWithMemo] = useState<'on' | 'off'>('off');
  const [viaChildren, setViaChildren] = useState<'inside' | 'children'>('inside');
  const [theme, setTheme] = useState('светлая');
  const [generation, setGeneration] = useState(0);

  const treeRef = useRef<HTMLDivElement | null>(null);
  const signature = `${stateIn}-${withMemo}-${viaChildren}-${generation}`;

  /**
   * Выбрать значение тумблера и вернуть контекст в исходное состояние.
   *
   * Тип параметра выписан как `Dispatch<SetStateAction<T>>`, а не как `(value: T) => void`:
   * сеттер из `useState` принимает ещё и функцию-обновлятель, и по более узкой сигнатуре
   * вывод типов не находил `T` — он падал до `string`, после чего union каждого тумблера
   * переставал совпадать. Приведение здесь не нужно: `Pills` выводит `T` из своих опций.
   */
  const pick =
    <T,>(set: Dispatch<SetStateAction<T>>) =>
    (value: T) => {
      set(value);
      setTheme('светлая');
    };

  return (
    <Frame
      bar={
        <>
          <Pills
            label="состояние счётчика"
            name="rt-state"
            value={stateIn}
            onChange={pick(setStateIn)}
            options={[
              { value: 'App', label: 'поднято в App' },
              { value: 'Content', label: 'в Content' },
              { value: 'Counter', label: 'опущено в Counter' },
            ]}
          />
          <Pills
            label="React.memo на узлах"
            name="rt-memo"
            value={withMemo}
            onChange={pick(setWithMemo)}
            options={[
              { value: 'off', label: 'выкл' },
              { value: 'on', label: 'вкл' },
            ]}
          />
          <Pills
            label="Article"
            name="rt-children"
            value={viaChildren}
            onChange={pick(setViaChildren)}
            options={[
              { value: 'inside', label: 'внутри Content' },
              { value: 'children', label: 'через children из App' },
            ]}
          />
        </>
      }
      foot={
        <span>
          Мигнул узел — значит его функцию вызвали заново. Счётчики обнуляются при смене
          тумблера и по кнопке «сброс».
        </span>
      }
    >
      <div className={s.split}>
        <div className={s.pane} ref={treeRef}>
          <App
            key={signature}
            withMemo={withMemo === 'on'}
            stateIn={stateIn}
            viaChildren={viaChildren === 'children'}
            theme={theme}
          />
        </div>

        <div className={s.pane}>
          <div className={s.actions}>
            <Btn onClick={() => setTheme((t) => (t === 'светлая' ? 'тёмная' : 'светлая'))}>
              сменить контекст
            </Btn>
            <Btn onClick={() => setGeneration((g) => g + 1)}>сброс</Btn>
          </div>

          <div className={s.stats}>
            <DomMeter targetRef={treeRef} resetKey={signature} />
            <Stat
              label="что здесь важно"
              value={withMemo === 'on' ? 'memo' : 'по умолчанию'}
              note={
                withMemo === 'on'
                  ? 'memo останавливает спуск там, где пропсы не изменились, — и не останавливает потребителя контекста'
                  : 'ре-рендер идёт вниз по всему поддереву'
              }
            />
          </div>

          <p className={s.verdict} data-tone="muted">
            Кнопка «счётчик +1» меняет одно число. Сравните, сколько функций после этого было
            вызвано и сколько правок получил документ.
          </p>
        </div>
      </div>
    </Frame>
  );
}
