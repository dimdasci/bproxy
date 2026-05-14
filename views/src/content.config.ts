import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { z } from "zod";
import { viewSchema } from "./lib/view-schema";

const docs = defineCollection({
	loader: glob({
		// Base points through the symlink at views/src/content/docs → ../../docs so that
		// Astro stores filePaths as 'src/content/docs/...' — required for Starlight's
		// autogenerate sidebar to strip the prefix and match directory names correctly.
		pattern: ["**/*.{md,mdx}", "!journal/**", "!skills/**"],
		base: "src/content/docs",
	}),
	// docsSchema({ extend }) only adds fields; it cannot relax a built-in required field.
	// Strip required 'title' then re-add as optional so prose docs fall back to their first H1.
	schema: (context) => {
		const baseSchema = docsSchema()(context);
		return baseSchema.omit({ title: true }).extend({ title: z.string().optional() });
	},
});

const views = defineCollection({
	loader: glob({
		pattern: "**/*.md",
		base: "src/content/docs/views",
	}),
	schema: docsSchema({ extend: viewSchema }),
});

export const collections = { docs, views };
