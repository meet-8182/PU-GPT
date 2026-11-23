const js = require('@eslint/js');
const react = require('eslint-plugin-react');

module.exports = [
  js.configs.recommended,
  {
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
      react,
    },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    plugins: {
      react,
    },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
    },
  },
];