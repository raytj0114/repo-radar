import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ['.next/**', 'out/**', 'coverage/**', 'next-env.d.ts', '.claude/**'],
  },
  {
    rules: {
      // `const { omit, ...rest } = obj` でフィールドを除外するイディオムを許可
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // PlaywrightのfixtureはテストへFixtureを引き渡すコールバックを `use` と名付ける規約だが、
    // これはReactの `use` フックではない。E2EにReact Hooksのルールを適用しない
    files: ['e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
];

export default eslintConfig;
