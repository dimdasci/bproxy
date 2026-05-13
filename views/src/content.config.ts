import { defineCollection } from 'astro:content';
import { z } from 'zod';
import { docsSchema } from '@astrojs/starlight/schema';
import { glob } from 'astro/loaders';
import { viewSchema } from './lib/view-schema';

const docs = defineCollection({
  loader: glob({
    // Exclude docs/views/ — served by the separate `views` collection below
    pattern: ['**/*.{md,mdx}', '!views/**'],
    base: '../docs',
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
    pattern: '**/*.md',
    base: '../docs/views',
  }),
  schema: docsSchema({ extend: viewSchema }),
});

export const collections = { docs, views };
