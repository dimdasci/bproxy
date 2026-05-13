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
      sidebar: [],
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'script',
          attrs: { type: 'module' },
          content: `
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
            mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
          `,
        },
      ],
    }),
  ],
});
