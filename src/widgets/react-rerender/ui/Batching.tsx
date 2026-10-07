import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useFlash, useRenderCount } from '@/features/count-renders';
import { Btn, Frame, Pills, Stat } from './parts';
import s from './demo.module.css';

/**
 * Батчинг: три `setState` подряд — сколько ре-рендеров.
 *
 * Счётчик показывает сам измеряемый компонент, и это единственный честный способ: любой
 * посредник, которому пришлось бы сообщить число, сам вызвал бы ре-рендер и испортил его.
 *
 * Смена режима перемонтирует измеряемое поддерево — счётчик начинается заново с единицы
 * (монтирование — это тоже вызов функции).
 */

type Mode = 'handler' | 'promise' | 'timeout' | 'flushSync';

const NOTE: Record<Mode, string> = {
  handler: 'три setState прямо в обработчике клика',
  promise: 'три setState внутри .then у разрешённого промиса',
  timeout: 'три setState внутри setTimeout(…, 0)',
  flushSync: 'каждый setState обёрнут в flushSync — явный отказ от батчинга',
};

function Row({ a }: { a: number }) {
  const renders = useRenderCount();
  return <Stat label="вызовов <Row/>" value={renders} note={`получает проп a = ${a}`} />;
}

function Target({ mode }: { mode: Mode }) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLDivElement>();
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);

  const bump = () => {
    setA((x) => x + 1);
    setB((x) => x + 1);
    setC((x) => x + 1);
  };

  const run = () => {
    if (mode === 'handler') bump();
    else if (mode === 'promise') void Promise.resolve().then(bump);
    else if (mode === 'timeout') window.setTimeout(bump, 0);
    else {
      flushSync(() => setA((x) => x + 1));
      flushSync(() => setB((x) => x + 1));
      flushSync(() => setC((x) => x + 1));
    }
  };

  return (
    <div className={s.node} ref={ref} data-flash="off">
      <div className={s.nodeHead}>
        <span className={s.nodeName}>&lt;Target/&gt;</span>
        <span className={s.nodeMeter} data-meter>{`вызовов: ${renders}`}</span>
      </div>
      <div className={s.nodeNote}>{NOTE[mode]}</div>

      <div className={s.values}>
        <span className={s.value}>{`a = ${a}`}</span>
        <span className={s.value}>{`b = ${b}`}</span>
        <span className={s.value}>{`c = ${c}`}</span>
      </div>

      <div className={s.stats}>
        <Stat
          label="вызовов <Target/>"
          value={renders}
          tone={mode === 'flushSync' ? 'warn' : 'ok'}
          note="монтирование тоже вызов, поэтому отсчёт идёт от единицы"
        />
        <Row a={a} />
      </div>

      <div className={s.actions}>
        <Btn primary onClick={run}>
          три setState
        </Btn>
      </div>
    </div>
  );
}

export default function Batching() {
  const [mode, setMode] = useState<Mode>('handler');
  const [generation, setGeneration] = useState(0);

  return (
    <Frame
      bar={
        <>
          <Pills
            label="где вызваны setState"
            name="bt-mode"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setGeneration((g) => g + 1);
            }}
            options={[
              { value: 'handler', label: 'в обработчике' },
              { value: 'promise', label: 'в промисе' },
              { value: 'timeout', label: 'в setTimeout' },
              { value: 'flushSync', label: 'через flushSync' },
            ]}
          />
          <Btn onClick={() => setGeneration((g) => g + 1)}>сброс</Btn>
        </>
      }
      foot={
        <span>
          Три состояния изменились в каждом режиме. Вопрос ровно один: во сколько рендеров это
          обошлось.
        </span>
      }
    >
      <Target key={`${mode}-${generation}`} mode={mode} />
    </Frame>
  );
}
