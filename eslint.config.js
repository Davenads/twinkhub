import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// Flat config (ESLint 9). Lint is for *correctness* — undefined/unused vars,
// obvious foot-guns — not style; Prettier owns formatting and
// `eslint-config-prettier` (last) switches off any stylistic ESLint rules so the
// two never disagree. Runtime state and logs are not source, so they're ignored.
export default [
  {
    ignores: ['node_modules/', 'data/', 'logs/', 'coverage/']
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      // Allow deliberately-unused args/vars when prefixed with `_`.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  prettier
];
