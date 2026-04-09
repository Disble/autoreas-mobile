// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const jsdocPlugin = require('eslint-plugin-jsdoc');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'scripts/*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['src/infrastructure/*', '**/infrastructure/*', 'drizzle-orm', 'drizzle-orm/*'],
              message: 'Dumb UI Rule: UI components (.tsx) cannot directly import infrastructure or database layers. Use a custom hook or repository instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/**/use-*', '**/helpers/hooks/use-*'],
              message:
                'Delivery Rule: app/ files cannot import custom hooks. Move screen logic to a feature entrypoint and keep app/ focused on routing and composition.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ImportDeclaration[source.value='react'] ImportSpecifier[imported.name=/^use(State|Reducer|Effect|Memo|Callback|Ref)$/]",
          message:
            'Delivery Rule: app/ files cannot import React state/effect hooks. Move screen logic into feature hooks/components.',
        },
      ],
    },
  },
  // BARRIER 1: strict colocation for feature UI and hooks
  {
    files: ['src/features/**/*.tsx', 'src/features/**/use-*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message:
                'Strict Colocation: Zod schemas must live in a dedicated *.schema.ts file, never inside a component or hook.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program > VariableDeclaration',
          message:
            'Strict Colocation: Root-level variables are forbidden in feature components/hooks. Move constants to *.constants.ts and helper state to the function body or dedicated modules.',
        },
        {
          selector: 'Program > FunctionDeclaration',
          message:
            'Strict Colocation: Root-level helper functions are forbidden in feature components/hooks. Move them to *.helpers.ts or export the main component/hook function directly.',
        },
        {
          selector: 'Program > ExportNamedDeclaration > VariableDeclaration',
          message:
            'Strict Colocation: Export feature components and hooks as function declarations, not root-level consts.',
        },
        {
          selector: 'Program > ExportDefaultDeclaration > ArrowFunctionExpression',
          message:
            'Strict Colocation: Export feature components and hooks as named function declarations.',
        },
        {
          selector: 'TSInterfaceDeclaration',
          message: 'Strict Colocation: Interfaces must be declared in a separate .types.ts file, not inside the component or hook.',
        },
        {
          selector: 'TSTypeAliasDeclaration',
          message: 'Strict Colocation: Type aliases must be declared in a separate .types.ts file, not inside the component or hook.',
        },
      ],
    },
  },
  // BARRIER 2: readonly props in dedicated type files
  {
    files: ['src/features/**/*.types.ts', 'src/components/**/*.types.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSInterfaceDeclaration[id.name=/Props$/] TSPropertySignature[readonly!=true]',
          message:
            'Type Contract Rule: every Props field must be declared as readonly.',
        },
      ],
    },
  },
  // BARRIER 3: mandatory JSDoc on helpers
  {
    files: ['src/features/**/*.helpers.ts', 'src/helpers/**/*.ts'],
    plugins: {
      jsdoc: jsdocPlugin,
    },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          contexts: [
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
            'ExportNamedDeclaration > FunctionDeclaration',
          ],
          require: {
            FunctionDeclaration: false,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
        },
      ],
    },
  },
]);
