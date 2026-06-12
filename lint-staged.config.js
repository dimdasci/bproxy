export default {
	"*.{ts,tsx,mts,js,json}": "biome check --fix --formatter-enabled=true --linter-enabled=false",
	"*.{ts,tsx,mts}": "eslint --no-warn-ignored --max-warnings 0",
};
