import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'artifacts', 'node_modules'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
