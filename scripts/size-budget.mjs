#!/usr/bin/env node
// Fails the build if dist/ exceeds the deployment size budget.
// Keeps the site permanently fast to load on GitHub Pages.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Elite-build budget: generous enough for the compressed HD model pack
// (~3.7 MB of GLBs), tight enough to keep first paint fast on Pages.
const TOTAL_MAX = 25 * 1024 * 1024 // 25 MB total
const FILE_MAX = 4 * 1024 * 1024   // 4 MB per file

const files = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p)
    else files.push({ path: p, size: s.size })
  }
}
walk('dist')

const total = files.reduce((s, f) => s + f.size, 0)
const kb = n => (n / 1024).toFixed(1) + ' KB'
console.log(`size-budget: ${files.length} files, total ${kb(total)} (budget ${kb(TOTAL_MAX)})`)
for (const f of files.sort((a, b) => b.size - a.size).slice(0, 8)) console.log(`  ${kb(f.size).padStart(10)}  ${f.path}`)

let fail = false
if (total > TOTAL_MAX) { console.error('FAIL: total dist size exceeds budget'); fail = true }
for (const f of files) if (f.size > FILE_MAX) { console.error(`FAIL: ${f.path} exceeds per-file budget`); fail = true }
process.exit(fail ? 1 : 0)
