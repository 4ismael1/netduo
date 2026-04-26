import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        // Force heavy vendor libs into their OWN chunks even when
        // imported synchronously. Without this, switching Dashboard
        // from lazy() to a top-level import in App.jsx pulls recharts
        // (~280 kB) and a couple of other libs into the main bundle,
        // bloating it from 278 kB to 632 kB. Splitting them keeps the
        // main bundle small while still letting the browser load all
        // chunks in parallel via <link rel="modulepreload">. End
        // result: Dashboard renders its skeleton on the very first
        // React commit (no Suspense fallback gap, no double-skeleton
        // flicker) without making the cold-start parse measurably
        // slower.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts')) return 'recharts'
            if (id.includes('victory-vendor')) return 'recharts'
            if (id.includes('d3-')) return 'recharts'
            if (id.includes('framer-motion')) return 'framer-motion'
            if (id.includes('lucide-react')) return 'lucide'
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.test.{js,jsx}', 'electron/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
