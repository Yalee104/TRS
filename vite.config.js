// =============================================================================
//  vite.config.js  —  MULTI-PAGE setup for the mini-game playground
// =============================================================================
//
//  This repo holds several independent mini-games. Vite is a "multi-page app"
//  by default: every .html file can be its own entry point. We just have to
//  list them so the production build (`npm run build`) emits all of them.
//
//  In dev (`npm run dev`) you don't even need this list — you navigate to the
//  page's URL directly, e.g.:
//     http://localhost:5173/                         (the menu)
//     http://localhost:5173/games/grid-path-puzzle/  (the puzzle demo)
//     http://localhost:5173/games/strategy/          (the strategy game)
// =============================================================================

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // The repo root is the Vite root, so the menu index.html is the default page.
  build: {
    rollupOptions: {
      input: {
        menu: resolve(__dirname, 'index.html'),
        puzzle: resolve(__dirname, 'games/grid-path-puzzle/index.html'),
        strategy: resolve(__dirname, 'games/strategy/index.html'),
        strategyRun: resolve(__dirname, 'games/strategy-run/index.html'),
      },
    },
  },
});
