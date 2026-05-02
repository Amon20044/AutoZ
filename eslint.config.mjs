import nextVitals from 'eslint-config-next/core-web-vitals'
import prettier from 'eslint-config-prettier'

export default [
  {
    ignores: [
      '.next/**',
      'dist/**',
      'node_modules/**',
      'public/sw.js',
    ],
  },
  ...nextVitals,
  prettier,
  {
    rules: {
      'import/prefer-default-export': 'off',
      'no-console': 'warn',
      'no-var': 'error',
      'no-html-link-for-pages': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['app/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
      },
    },
  },
]
