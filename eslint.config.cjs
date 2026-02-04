// ESLint v9 flat config for shared library
const js = require('@eslint/js')
const tseslint = require('typescript-eslint')

/** @type {import('eslint').Linter.FlatConfig[]} */
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

  // TypeScript recommended (parser + rules)
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Your project rules
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
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
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      'no-console': 'off', // allow logging in actions
    },
  },
]
