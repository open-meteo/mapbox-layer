import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default ts.config(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: {
				projectService: true,
				ecmaVersion: 'latest',
				sourceType: 'module'
			}
		},
		files: ['**/*.{js,ts,mjs,cjs}'],
		ignores: ['eslint.config.js', 'prettier.config.js'],
		rules: {
			// Add any project-specific rules here
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			],
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off'
		}
	},
	{
		files: ['eslint.config.js'],
		languageOptions: {
			globals: globals.node, // Only Node globals
			ecmaVersion: 'latest',
			sourceType: 'module'
		}
	}
);
