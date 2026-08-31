import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import n from 'eslint-plugin-n';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config.
 *
 * Layers, in order (later entries win):
 *  1. ignores
 *  2. @eslint/js recommended       — universal JS bug catches
 *  3. typescript-eslint recommended — TS-aware rules (no full type-check; that's
 *     `npm run typecheck`), keeps linting fast
 *  4. eslint-plugin-n recommended   — Node correctness
 *  5. project tweaks
 *  6. eslint-config-prettier        — turns OFF every stylistic rule. Last.
 */
export default tseslint.config(
  {
    ignores: ['node_modules/', 'coverage/', 'dist/'],
  },

  js.configs.recommended,
  tseslint.configs.recommended,
  n.configs['flat/recommended-module'],

  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Allow intentionally-unused identifiers prefixed with `_`
      // (e.g. the `_next` arg an Express error handler must declare).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // server.ts is a process entry point — process.exit() during graceful
      // shutdown is deliberate.
      'n/no-process-exit': 'off',

      // Not a published npm library, so these only produce noise.
      'n/no-unpublished-import': 'off',
      'n/no-unpublished-require': 'off',

      // Source imports use `.ts` specifiers, which eslint-plugin-n can't
      // resolve. TypeScript already validates every import path.
      'n/no-missing-import': 'off',
    },
  },

  prettier,
);
