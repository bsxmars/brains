import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import ts from 'typescript-eslint';

/**
 * Набор узкий: цель — держать границы слоёв и швы к зависимостям, а не переучивать стиль.
 *
 * ⚠️ **Правила здесь не складываются, а заменяют друг друга.** В плоском конфиге последний
 * подошедший блок перезаписывает `no-restricted-imports` целиком. Раньше это тихо ломало
 * половину защиты: блоки границ слоёв шли после шва к библиотеке, и для любого файла
 * в `widgets`, `entities` и `features` от шва не оставалось ничего — запрет на прямой импорт
 * `@ilomee/*` действовал только там, где своего блока слоя не было. Поэтому теперь у каждого
 * файла ровно один блок, и в нём сразу все ограничения: слои, шов к библиотеке и шов к d3.
 */

/** Шов к библиотеке компонентов: имя `@ilomee/*` знает только `shared/ui/aura.ts`. */
const AURA = ['@ilomee/aura-vue', '@ilomee/aura-core', '@ilomee/aura-core/dom'].map((name) => ({
  name,
  message: 'Компоненты и API библиотеки — только через @/shared/ui (см. shared/ui/aura.ts).',
}));

/** Шов к d3: шкалы и засечки знает только `shared/lib/chart.ts`. */
const D3 = {
  group: ['d3-*'],
  message: 'Шкалы и засечки — только через @/shared/lib/chart.ts.',
};

/** Слои FSD: импорт только вниз. Порядок — pages → widgets → features → entities → shared. */
const ABOVE = {
  shared: ['@/entities/*', '@/features/*', '@/widgets/*', '@/pages/*'],
  entities: ['@/features/*', '@/widgets/*', '@/pages/*'],
  features: ['@/widgets/*', '@/pages/*'],
  widgets: ['@/pages/*'],
  pages: [],
};

/** Один блок ограничений на файл: иначе последний перезапишет предыдущие. */
const limits = (layers, { aura = true, d3 = true } = {}) => ({
  'no-restricted-imports': [
    'error',
    {
      paths: aura ? AURA : [],
      patterns: [...layers.map((group) => ({ group: [group] })), ...(d3 ? [D3] : [])],
    },
  ],
});

export default ts.config(
  { ignores: ['dist/**', '.astro/**', 'legacy/**', 'node_modules/**', 'tests/fixtures/compression/**', 'tests/fixtures/performance-budgets/**'] },

  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  ...astro.configs.recommended,

  {
    files: ['**/*.{ts,tsx,vue,astro}'],
    languageOptions: {
      parserOptions: { parser: ts.parser, ecmaVersion: 'latest', sourceType: 'module' },
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',

      // Форматирование — не дело линтера: правила про переносы и порядок атрибутов только
      // шумят. Здесь ловятся ошибки, а не стиль.
      'vue/singleline-html-element-content-newline': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/html-self-closing': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/attributes-order': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      /**
       * Правило требует импортировать из `vue`, а не из внутренних пакетов, — и для
       * прикладного кода оно право. Но курс объясняет устройство самой реактивности, и его
       * демо строятся на `@vue/reactivity` напрямую: там это не случайный импорт, а предмет
       * урока. Список исключений по именам слайсов развалился бы при первом переименовании.
       */
      'vue/prefer-import-from-vue': 'off',
    },
  },

  {
    /**
     * React-компоненты демо. Без явного включения JSX парсер спотыкается на первой же
     * угловой скобке: общий блок настроен под `.ts`, где `<` — это сравнение.
     */
    files: ['**/*.tsx'],
    languageOptions: {
      parser: ts.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 'latest', sourceType: 'module' },
    },
  },

  // ---- Слой shared ----
  {
    // Шов к библиотеке: единственное место, где имя `@ilomee/*` разрешено.
    files: ['src/shared/ui/**/*.{ts,tsx,vue,astro}'],
    rules: limits(ABOVE.shared, { aura: false }),
  },
  {
    // Шов к d3: единственное место, где разрешены сами пакеты шкал.
    files: ['src/shared/lib/chart.ts'],
    rules: limits(ABOVE.shared, { d3: false }),
  },
  {
    files: ['src/shared/**/*.{ts,tsx,vue,astro}'],
    ignores: ['src/shared/ui/**', 'src/shared/lib/chart.ts'],
    rules: limits(ABOVE.shared),
  },

  // ---- Остальные слои ----
  { files: ['src/entities/**/*.{ts,tsx,vue,astro}'], rules: limits(ABOVE.entities) },
  { files: ['src/features/**/*.{ts,tsx,vue,astro}'], rules: limits(ABOVE.features) },
  { files: ['src/widgets/**/*.{ts,tsx,vue,astro}'], rules: limits(ABOVE.widgets) },
  { files: ['src/pages/**/*.{ts,tsx,vue,astro}'], rules: limits(ABOVE.pages) },
  /**
   * Только `data.ts` уроков: разбирать `.mdx` этим парсером нельзя — он спотыкается о первую
   * строку фронтматтера, а плагина для MDX в проекте нет. Границы слоёв в тексте урока
   * проверяет сборка: несуществующий импорт её просто уронит.
   */
  { files: ['src/content/**/*.ts'], rules: limits(ABOVE.pages) },

  {
    files: ['tests/**/*.ts', '*.config.ts', '*.config.mjs', '*.config.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
);
