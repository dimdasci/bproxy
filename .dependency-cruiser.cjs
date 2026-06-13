/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: "shared-no-imports",
			comment: "shared/ must not import from any other workspace",
			severity: "error",
			from: { path: "^shared/src" },
			to: { path: "^(service|extension|cli|views)/" },
		},
		{
			name: "cli-only-shared",
			comment: "cli/ may import only from shared/",
			severity: "error",
			from: { path: "^cli/src" },
			to: { path: "^(service|extension|views)/" },
		},
		{
			name: "service-only-shared",
			comment: "service/ may import only from shared/",
			severity: "error",
			from: { path: "^service/src" },
			to: { path: "^(cli|extension|views)/" },
		},
		{
			name: "extension-only-shared",
			comment: "extension/ may import only from shared/",
			severity: "error",
			from: { path: "^extension/src" },
			to: { path: "^(cli|service|views)/" },
		},
		{
			name: "extension-no-handle-types",
			comment: "extension/ must stay unaware of daemon-owned element handle types",
			severity: "error",
			from: { path: "^extension/src" },
			to: { path: "^shared/src/handles\.ts$" },
		},
		{
			name: "no-circular",
			comment: "No circular dependencies anywhere",
			severity: "error",
			from: {},
			to: { circular: true },
		},
		{
			name: "no-orphans",
			comment: "No orphan modules",
			severity: "warn",
			from: { orphan: true, pathNot: ["\\.d\\.ts$", "__tests__"] },
			to: {},
		},
		{
			name: "no-test-imports-in-prod",
			comment: "Production code must not import test files",
			severity: "error",
			from: { pathNot: "__tests__" },
			to: { path: "__tests__" },
		},
	],
	options: {
		doNotFollow: { path: "node_modules" },
		tsPreCompilationDeps: true,
		tsConfig: { fileName: "tsconfig.base.json" },
		enhancedResolveOptions: {
			exportsFields: ["exports"],
			conditionNames: ["import", "require", "node", "default"],
		},
	},
};
