import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'bproxy — Architecture',
      description: 'Architecture views and design docs for bproxy.',
      sidebar: [
        // populated in Task 6
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
