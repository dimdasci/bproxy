import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import sonarjs from "eslint-plugin-sonarjs";

export default [
	{
		ignores: [
			"**/dist/**",
			"**/node_modules/**",
			"**/.astro/**",
			"**/.output/**",
			"**/.wxt/**",
			"poc/**",
			"docs/**",
			"views/scripts/**",
		],
	},
	{
		files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				projectService: {
					allowDefaultProject: ["*.config.ts", "*/*.config.ts"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: {
			"@typescript-eslint": tseslint,
			sonarjs,
		},
		rules: {
			// typescript-eslint recommended-type-checked (subset — key rules)
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-floating-promises": "error",

			// sonarjs
			"sonarjs/cognitive-complexity": ["error", 15],

			// built-in complexity and size
			complexity: ["error", 10],
			"max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
			"max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
			"max-depth": ["error", 4],
			"no-warning-comments": ["error", { terms: ["TODO", "FIXME", "XXX"] }],
		},
	},
	{
		files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
		rules: {
			"max-lines-per-function": "off",
			"max-lines": "off",
			"sonarjs/cognitive-complexity": "off",
		},
	},
];
