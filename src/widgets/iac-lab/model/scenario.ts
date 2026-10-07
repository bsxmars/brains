import type { Config, ResourceConfig, StateInstance, Toggles, World } from './types';

/**
 * Сценарий демо из переключателей: желаемая конфигурация, состояние после прошлого apply
 * и «настоящий мир» для refresh. Те же сценарии тест прогоняет через настоящий `tofu plan`
 * (`tests/unit/infrastructure-as-code.test.ts`), поэтому сборка сценария живёт здесь,
 * а не в компоненте.
 *
 * База — сквозной пример темы: `BASE_CONFIG` с `count` и два состояния, снятые `apply`
 * этой конфигурации с `count` и с `for_each`.
 */

export interface ScenarioInput {
  base: Config;
  stateCount: StateInstance[];
  stateForEach: StateInstance[];
}

export interface Scenario {
  id: string;
  config: Config;
  state: StateInstance[];
  world: World;
}

export const MODES: Toggles['mode'][] = ['count', 'for_each', 'migrate', 'moved'];
export const EDITS: Toggles['edit'][] = ['none', 'input', 'force'];

export const scenarioId = (t: Toggles) => `${t.mode}.${t.edit}.${t.drop ? 'drop' : 'all'}.${t.drift ? 'drift' : 'clean'}`;

/** Все 48 сочетаний переключателей. */
export function allToggles(): Toggles[] {
  return MODES.flatMap((mode) =>
    EDITS.flatMap((edit) =>
      [false, true].flatMap((drop) => [false, true].map((drift) => ({ mode, edit, drop, drift }))),
    ),
  );
}

/**
 * Сценарии вне демо — только для сверки планировщика с `tofu`: `create_before_destroy`
 * у файла конфигурации (и его протекание на зависимости), `depends_on`, ресурс,
 * убранный из конфигурации целиком.
 */
export function extraScenarios(input: ScenarioInput): Scenario[] {
  const edit = (fn: (r: ResourceConfig) => ResourceConfig | null) =>
    input.base.resources.map((r) => fn({ ...r, attrs: { ...r.attrs } })).filter((r): r is ResourceConfig => r !== null);
  return [
    {
      id: 'extra.cbd',
      config: {
        resources: edit((r) => {
          if (r.type === 'random_pet') r.attrs.length = 3;
          if (r.name === 'config') r.createBeforeDestroy = true;
          return r;
        }),
      },
      state: input.stateCount,
      world: {},
    },
    {
      id: 'extra.depends',
      config: {
        resources: edit((r) => {
          if (r.type === 'terraform_data') r.attrs.input = 'v2';
          if (r.name === 'env') {
            r.dependsOn = ['terraform_data.release'];
            r.count = ['dev', 'prod'];
          }
          return r;
        }),
      },
      state: input.stateCount,
      world: {},
    },
    {
      id: 'extra.removed',
      config: { resources: edit((r) => (r.name === 'config' ? null : r)) },
      state: input.stateCount,
      world: {},
    },
  ];
}

export function buildScenario(input: ScenarioInput, t: Toggles): Scenario {
  const fromCount = t.mode === 'count' || t.mode === 'migrate' || t.mode === 'moved';
  const resources = input.base.resources.map((r) => {
    const out = { ...r, attrs: { ...r.attrs } };
    const items = r.count ?? r.forEach;
    if (items) {
      const envs = t.drop ? items.filter((e) => e !== 'stage') : [...items];
      delete out.count;
      delete out.forEach;
      if (t.mode === 'count') out.count = envs;
      else out.forEach = envs;
    }
    if (t.edit === 'input' && r.type === 'terraform_data') out.attrs.input = 'v2';
    if (t.edit === 'force' && r.type === 'random_pet') out.attrs.length = 3;
    return out;
  });
  const list = input.base.resources.find((r) => r.count);
  const moved =
    t.mode === 'moved' && list
      ? (list.count ?? []).map((env, i) => ({
          from: `${list.type}.${list.name}[${i}]`,
          to: `${list.type}.${list.name}["${env}"]`,
        }))
      : [];
  const state = fromCount ? input.stateCount : input.stateForEach;
  const devAddr = fromCount ? 'local_file.env[0]' : 'local_file.env["dev"]';
  return {
    id: scenarioId(t),
    config: { resources, ...(moved.length ? { moved } : {}) },
    state,
    world: t.drift ? { [devAddr]: null } : {},
  };
}
