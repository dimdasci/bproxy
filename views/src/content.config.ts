import { defineCollection, z } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { glob } from 'astro/loaders';
import { viewSchema } from './lib/view-schema';

const docs = defineCollection({
  loader: glob({
    // Exclude docs/views/ — served by the separate `views` collection below
    pattern: ['**/*.{md,mdx}', '!views/**'],
    base: '../docs',
  }),
  // Custom schema: take base Starlight schema and make title optional
  schema: (context) => {
    const baseSchema = docsSchema()(context);
    // Use .pick() to extract all keys, then .omit() title, then .merge() with optional title
    return baseSchema.omit({ title: true }).merge(
      z.object({ title: z.string().optional() })
    );
  },
});

const views = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: '../docs/views',
  }),
  schema: docsSchema({ extend: viewSchema }),
});

export const collections = { docs, views };
