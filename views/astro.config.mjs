import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

/** Converts ```mermaid fenced blocks to <pre class="mermaid"> for CDN rendering. */
function remarkMermaid() {
  return (tree) => {
    function walk(node) {
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (child.type === 'code' && child.lang === 'mermaid') {
            // value is trusted checked-in source; no sanitization needed
            node.children[i] = { type: 'html', value: `<pre class="mermaid">${child.value}</pre>` };
          } else {
            walk(child);
          }
        }
      }
    }
    walk(tree);
  };
}

export default defineConfig({
  markdown: {
    remarkPlugins: [remarkMermaid],
    syntaxHighlight: { excludeLangs: ['mermaid'] },
  },
  integrations: [
    starlight({
      title: 'bproxy — Architecture',
      description: 'Architecture views and design docs for bproxy.',
      sidebar: [
        {
          label: 'Overview',
          items: [
            { label: 'README', link: '/' },
            { label: 'Architecture', link: '/architecture/' },
            { label: 'Scenarios', link: '/scenarios/' },
          ],
        },
        {
          label: 'Views',
          collapsed: false,
          items: [{ autogenerate: { directory: 'views' } }],
        },
        {
          label: 'Solution Specs',
          items: [{ autogenerate: { directory: 'solution' } }],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Decisions (ADRs)', link: '/decisions/' },
            { label: 'Quality Gates', link: '/quality-gates/' },
          ],
        },
        {
          label: 'Plans',
          collapsed: true,
          items: [
            { label: 'Roadmap', link: '/plans/roadmap/' },
            {
              label: 'Phases',
              items: [{ autogenerate: { directory: 'plans/phases' } }],
            },
          ],
        },
      ],
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'script',
          attrs: { type: 'module' },
          content: `
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
            // 'loose' allows HTML in labels (strict strips entities); safe for checked-in source
            mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
          `,
        },
      ],
    }),
  ],
});
