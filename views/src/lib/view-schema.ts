import { z } from 'zod';

export const viewLayer = z.enum(['c1', 'c2', 'c3', 'c4', 'behavior', 'threat']);
export type ViewLayer = z.infer<typeof viewLayer>;

export const viewSchema = z.object({
  layer: viewLayer,
  sources: z.array(z.string()).min(1),
  relatedAdrs: z.array(z.string().regex(/^ADR-\d{3}$/)).optional(),
  related: z.array(z.string()).min(1).optional(),
});

export type ViewFrontmatter = z.infer<typeof viewSchema>;
