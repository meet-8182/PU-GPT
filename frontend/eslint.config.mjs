import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default [
  ...js.configs.recommended,
  ...tseslint.configs.recommended,
  files: ['**/*.{js,mjs,cjs,jsx}'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
  plugins: {
    react: js.pluginreact,
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
  },
  rules: {
    'no-undef': 'error',
    'react/jsx-no-undef': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react/jsx-no-useless-fragment': 'warn',
  },
];