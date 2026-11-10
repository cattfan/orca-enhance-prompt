// The web panel: React + Tailwind + shadcn/ReUI components, built into ../src/web-dist, which Orca
// shows as the Enhance Prompt panel. `npm run dev` here shows it in a browser with sample data.
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { orcaBridge } from './orca-bridge.ts'
import { defineConfig } from 'vite'

export default defineConfig({
  // Orca serves the panel from the plugin folder: every asset path must be relative.
  base: './',
  plugins: [react(), tailwindcss(), orcaBridge()],
  // 'orca' is the panel-runtime module the panel's state uses; in the frame it is orca-runtime.ts.
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src'), orca: path.resolve(import.meta.dirname, 'src/orca-runtime.ts') } },
  server: { port: 5174, fs: { allow: ['..'] } },
  build: {
    outDir: '../src/web-dist',
    emptyOutDir: true,
    // Minified for a fast load; the listing policy allows bundled output when the source is in the
    // repository (web/src). The other sections load on first use (see main.tsx).
    minify: true,
    chunkSizeWarningLimit: 700,
    // One script and one stylesheet: the frame loads nothing from the network.
    rollupOptions: { output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' } }
  }
})
