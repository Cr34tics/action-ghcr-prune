// ESLint v10 flat config with compatibility layer for typescript-eslint
const js = require('@eslint/js')
const { fixupPluginRules } = require('@eslint/compat')
const tseslint = require('typescript-eslint')

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  // Ignore build output & deps
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'eslint.config.cjs',
      'coverage/**',
      '*.config.ts',
    ],
  },

  // Base JS rules
  js.configs.recommended,

  // TypeScript recommended (with compatibility layer for ESLint 10)
  ...tseslint.configs.recommended.map((config) => {
    if (!config.plugins) return config
    return {
      ...config,
      plugins: Object.fromEntries(
        Object.entries(config.plugins).map(([name, plugin]) => [
          name,
          fixupPluginRules(plugin),
        ])
      ),
    }
  }),

  // Your project rules
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off', // allow logging in actions
    },
  },
]
