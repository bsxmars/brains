import { type ReactNode, type RefObject } from 'react';
import { useDomMutations } from '@/features/count-renders';
import s from './demo.module.css';

/**
 * Общая обвязка четырёх React-демо урока: рамка, «пилюли», кнопки и приборы.
 *
 * Всё это — части одного слайса, а не общие компоненты: `shared/ui` собран для Astro и Vue,
 * а здесь нужен React. Вид при этом обязан совпадать с Vue-демо курса, поэтому рамка
 * повторяет `DemoFrame.vue`, а «пилюли» и кнопки — скины из `shared/styles/overrides.css`.
 */

export function Frame({ bar, children, foot }: { bar?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className={s.frame}>
      {bar ? <div className={s.bar}>{bar}</div> : null}
      <div className={s.body}>{children}</div>
      {foot ? <div className={s.foot}>{foot}</div> : null}
    </div>
  );
}

export interface PillOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Переключатель — настоящая радиогруппа, а не набор кнопок: стрелки на клавиатуре и
 * объявление «выбрано 2 из 3» скринридером. Ровно то же решение, что у Vue-демо курса,
 * где на этом месте стоит `SegmentedControl` библиотеки.
 */
export function Pills<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: PillOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className={s.pills}>
      <legend className={s.pillsLabel}>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={s.pill}>
          <input
            className={s.pillInput}
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function Btn({
  onClick,
  children,
  primary = false,
  disabled = false,
}: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={primary ? `${s.btn} ${s.btnPrimary}` : s.btn}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Показание прибора. `data-meter` — метка для наблюдателя за DOM: текст счётчика меняется
 * на каждом ре-рендере, и без этой метки «правок DOM» никогда не было бы нуля.
 */
export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className={s.stat} data-meter>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue} data-tone={tone}>
        {value}
      </div>
      {note ? <div className={s.statNote}>{note}</div> : null}
    </div>
  );
}

/**
 * Счётчик правок DOM внутри поддерева.
 *
 * Отдельный компонент, а не хук в корне демо, и это не украшение: хук держит состояние,
 * значит его владелец перерисовывается на каждую мутацию. Владелец внутри наблюдаемого
 * поддерева получил бы бесконечный цикл, а владелец-родитель — испортил бы все счётчики
 * ниже. Поэтому прибор стоит листом, рядом с деревом, а не над ним.
 */
export function DomMeter({
  targetRef,
  resetKey,
  label = 'правок DOM',
}: {
  targetRef: RefObject<HTMLElement | null>;
  resetKey?: unknown;
  label?: string;
}) {
  const mutations = useDomMutations(targetRef, resetKey);
  return (
    <Stat
      label={label}
      value={mutations}
      tone={mutations === 0 ? 'ok' : undefined}
      note="вставки, удаления и правки текста; счётчики рендеров из подсчёта исключены"
    />
  );
}

/** Узел дерева компонентов: имя, пометка, счётчик вызовов и вложенные узлы. */
export function Node({
  name,
  renders,
  note,
  value,
  extra,
  memo = false,
  innerRef,
  children,
}: {
  name: string;
  renders: number;
  note?: string;
  value?: ReactNode;
  /** Органы управления внутри узла — кнопка, поле ввода. */
  extra?: ReactNode;
  memo?: boolean;
  innerRef?: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}) {
  return (
    <div className={s.tree}>
      <div className={s.node} ref={innerRef} data-flash="off" data-memo={memo ? 'yes' : 'no'}>
        <div className={s.nodeHead}>
          <span className={s.nodeName}>{`<${name}/>`}</span>
          {memo ? <span className={s.nodeTag}>memo</span> : null}
          <span className={s.nodeMeter} data-meter data-zero={renders === 0 ? 'yes' : 'no'}>
            {`вызовов: ${renders}`}
          </span>
        </div>
        {note ? <div className={s.nodeNote}>{note}</div> : null}
        {value !== undefined ? <div className={s.nodeValue}>{value}</div> : null}
        {extra ? <div className={s.actions}>{extra}</div> : null}
      </div>
      {children ? <div className={s.children}>{children}</div> : null}
    </div>
  );
}
