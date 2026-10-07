import type { ChangeReport, Compiled, MiniCompiler, MiniDocument, State, Update } from './types';

/**
 * Сборка учебного компилятора из строки и прогон одного шаблона.
 *
 * Демо и тест собирают компилятор одним и тем же кодом — этим модулем. Строка напечатана
 * в теме по шагам; если текст на странице разойдётся с поведением, покраснеет
 * `tests/unit/framework-compilers.test.ts`.
 *
 * Ни Vue, ни глобального `document`: документ передаёт вызывающий — в браузере настоящий,
 * в тесте из happy-dom.
 */

/** Свежий экземпляр компилятора из строки `MINI_COMPILER_CODE`. */
export function loadMiniCompiler(code: string): MiniCompiler {
  return new Function(code)() as MiniCompiler;
}

/** Сколько узлов в поддереве, не считая корня. */
export function countNodes(root: Node): number {
  let n = 0;
  for (let child = root.firstChild; child; child = child.nextSibling) n += 1 + countNodes(child);
  return n;
}

/** Строка из поля ввода → значение: число, если похоже на число, иначе строка. */
export function parseValue(raw: string): string | number {
  const trimmed = raw.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : raw;
}

/**
 * Один шаблон: скомпилировать, смонтировать, менять значения по одному.
 *
 * Интерпретатор гоняется рядом в отсоединённом узле — чтобы на каждое изменение сказать,
 * сколько узлов он пересоздал бы, делая ту же работу без компиляции.
 */
export class CompilerLab {
  readonly compiled: Compiled;
  /** Записи в DOM, сделанные при монтировании (первое заполнение). */
  readonly mountOps: string[];
  private readonly api: MiniCompiler;
  private readonly source: string;
  private readonly target: Element;
  private readonly scratch: Element;
  private readonly update: Update;
  private readonly ops: string[] = [];
  private state: State;

  constructor(api: MiniCompiler, source: string, doc: MiniDocument, target: Element, initial: State) {
    this.api = api;
    this.source = source;
    this.target = target;
    this.scratch = doc.createElement('div');
    this.compiled = api.compile(source);
    this.state = Object.fromEntries(this.compiled.names.map((name) => [name, initial[name] ?? 0]));
    const rt = api.createRuntime(doc, (op) => this.ops.push(op));
    const mount = api.instantiate(this.compiled.code, rt);
    this.update = mount(target, this.state);
    this.mountOps = this.take();
  }

  get values(): State {
    return { ...this.state };
  }

  /** Поменять одно имя: скомпилированный код получает флаг только для него. */
  set(name: string, value: unknown): ChangeReport {
    this.state = { ...this.state, [name]: value };
    this.update(this.state, { [name]: true });
    const ops = this.take();
    this.scratch.innerHTML = this.api.interpret(this.source, this.state);
    return { ops, rebuilt: countNodes(this.scratch), html: this.target.innerHTML };
  }

  private take(): string[] {
    return this.ops.splice(0);
  }
}
