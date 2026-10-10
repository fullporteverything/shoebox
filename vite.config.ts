import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'

const shim = (p: string) => fileURLToPath(new URL(`./src/shims/${p}`, import.meta.url))

// `--mode artifact` builds one self-contained HTML file for previewing on
// claude.ai. React loads from the CDN there, so it is aliased to the UMD globals.
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact'
  return {
    esbuild: { jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
    define: { __ARTIFACT__: JSON.stringify(artifact) },
    resolve: artifact
      ? {
          alias: [
            { find: 'react-dom/client', replacement: shim('react-dom-client.ts') },
            { find: 'react-dom', replacement: shim('react-dom.ts') },
            { find: 'react', replacement: shim('react.ts') },
          ],
        }
      : {},
    plugins: artifact
      ? [
          viteSingleFile(),
          {
            name: 'react-from-cdn',
            transformIndexHtml: (html: string) =>
              html.replace(
                '<!-- react-cdn -->',
                [
                  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
                  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
                ]
                  .map((src) => `<script src="${src}" crossorigin="anonymous"></script>`)
                  .join('\n'),
              ),
          },
        ]
      : [],
    build: { outDir: artifact ? 'dist-artifact' : 'dist' },
  }
})
