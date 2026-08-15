/**
 * Build script: dsh-balance ships plain JavaScript (no TypeScript, no
 * bundler), so "building" is copying the authored `src/` files into the
 * shipped `lib/` artifacts. The dshmarket install validation requires the
 * declared entry artifact (`lib/index.js`) to exist — a source-only checkout
 * is rejected — so `lib/` is committed to the repository.
 */
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })
for (const file of ['index.js', 'client.js', 'index.d.ts']) {
  copyFileSync(new URL(`../src/${file}`, import.meta.url), new URL(`../lib/${file}`, import.meta.url))
}
console.log('built lib/ from src/')
