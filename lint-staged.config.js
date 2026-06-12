export default {
	"*.{ts,tsx,mts,js,json,md}": "biome check --fix --formatter-enabled=true --linter-enabled=false",
	"*.{ts,tsx,mts}": "eslint --max-warnings 0",
};
