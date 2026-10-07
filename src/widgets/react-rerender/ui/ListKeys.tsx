import { useState } from 'react';
import { useFlash, useRenderCount } from '@/features/count-renders';
import { Btn, Frame, Pills } from './parts';
import s from './demo.module.css';

/**
 * `key={index}` против стабильного ключа.
 *
 * Всё демо держится на одной детали: у каждой строки есть **локальное состояние** — текст
 * в поле. Оно живёт на фибере, а какой фибер достанется новому элементу, решает ключ.
 *
 * Начальное значение поля задаётся при монтировании и больше не обновляется из пропсов —
 * поэтому подмену видно сразу, без единого нажатия: строка «Задача B» показывает `aaa`,
 * набранное для «Задачи A». Номер фибера сквозной и выдаётся один раз на монтирование:
 * он доказывает, что компонент **не перемонтировался**, а был переиспользован для другой
 * сущности. Это и есть настоящая механика — не «React всё пересоздал», а наоборот.
 */

interface Item {
  id: string;
  title: string;
  seed: string;
}

const INITIAL: Item[] = [
  { id: 'a', title: 'Задача A', seed: 'aaa' },
  { id: 'b', title: 'Задача B', seed: 'bbb' },
  { id: 'c', title: 'Задача C', seed: 'ccc' },
];

/** Сквозная нумерация смонтированных строк: номер выдаётся один раз и живёт с фибером. */
let mounted = 0;

function Row({ row }: { row: Item }) {
  const renders = useRenderCount();
  const ref = useFlash<HTMLLIElement>();
  const [fiber] = useState(() => ++mounted);
  const [text, setText] = useState(row.seed);

  const own = text === row.seed;

  return (
    <li className={s.listRow} ref={ref} data-flash="off">
      <span className={s.rowTitle}>{row.title}</span>
      <span className={s.rowId} data-meter>{`фибер #${fiber} · вызовов: ${renders}`}</span>
      <input
        className={s.input}
        value={text}
        aria-label={`состояние строки «${row.title}»`}
        onChange={(event) => setText(event.target.value)}
      />
      <span className={s.badge} data-tone={own ? 'ok' : 'err'}>
        {own ? 'своё' : 'чужое'}
      </span>
    </li>
  );
}

export default function ListKeys() {
  const [keyMode, setKeyMode] = useState<'index' | 'id'>('index');
  const [rows, setRows] = useState<Item[]>(INITIAL);
  const [generation, setGeneration] = useState(0);

  const reset = (mode: 'index' | 'id' = keyMode) => {
    setKeyMode(mode);
    setRows(INITIAL);
    setGeneration((g) => g + 1);
  };

  const removeFirst = () => setRows((list) => list.slice(1));
  const insertFirst = () =>
    setRows((list) => [{ id: `n${generation}-${list.length}`, title: 'Новая', seed: 'новое' }, ...list]);
  const reverse = () => setRows((list) => [...list].reverse());

  return (
    <Frame
      bar={
        <>
          <Pills
            label="ключ списка"
            name="lk-key"
            value={keyMode}
            onChange={(mode) => reset(mode)}
            options={[
              { value: 'index', label: 'key={i}' },
              { value: 'id', label: 'key={task.id}' },
            ]}
          />
          <div className={s.actions}>
            <Btn primary onClick={removeFirst} disabled={rows.length === 0}>
              удалить первую
            </Btn>
            <Btn onClick={insertFirst}>вставить в начало</Btn>
            <Btn onClick={reverse}>перевернуть</Btn>
            <Btn onClick={() => reset()}>сброс</Btn>
          </div>
        </>
      }
      foot={
        <span>
          «Своё» значит, что текст в поле — тот, что задан этой строке при монтировании.
          «Чужое» — состояние досталось от прежнего жильца фибера.
        </span>
      }
    >
      <ul className={s.list} key={`${keyMode}-${generation}`}>
        {rows.map((row, index) => (
          <Row key={keyMode === 'index' ? index : row.id} row={row} />
        ))}
      </ul>

      <p className={s.verdict} data-tone={keyMode === 'index' ? 'err' : 'ok'}>
        {keyMode === 'index'
          ? 'Ключ — позиция. Удалили первую — и React переиспользовал фибер «Задачи A» для «Задачи B»: тип совпал, значит обновились только пропсы, а хуки остались от прежней сущности.'
          : 'Ключ — идентичность. React находит фибер каждой задачи по её id, состояние едет вместе с ней, а удаляется ровно тот компонент, который исчез из списка.'}
      </p>
    </Frame>
  );
}
