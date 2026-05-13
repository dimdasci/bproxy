import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { glob } from 'astro/loaders';
import { viewSchema } from './lib/view-schema';

const docs = defineCollection({
  loader: glob({
    // Exclude docs/views/ — served by the separate `views` collection below
    pattern: ['**/*.{md,mdx}', '!views/**'],
    base: '../docs',
  }),
  schema: docsSchema(),
});

const views = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: '../docs/views',
  }),
  schema: docsSchema({ extend: viewSchema }),
});

export const collections = { docs, views };
