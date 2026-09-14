import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', shell: process.platform === 'win32' })
if (packed.error) throw packed.error
if (packed.status !== 0) throw new Error(packed.stderr)
const [info] = JSON.parse(packed.stdout), paths = new Set(info.files.map(file => file.path))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
for (const entry of Object.values(pkg.exports)) if (typeof entry === 'string') assert.ok(paths.has(entry.replace(/^\.\//, '')), `Missing packed export: ${entry}`)
assert.ok(pkg.exports['./client'], 'dsh.client requires an exported ./client bundle')
assert.ok(paths.has(pkg.dsh.bundle.patch.replace(/^\.\//, '')))
for (const required of ['src/run-isolation.js', 'src/host-isolation.js', 'docs/RUN-ISOLATION.md', 'src/project-library.js', 'src/intake-policy.js', 'src/domain-sops.js', 'docs/PROJECT-SOPS.md', 'src/sops.js', 'src/routing.js', 'src/automation.js', 'src/tool.js', 'src/host.js', 'src/receipts.js', 'src/context.js', 'src/quality.js', 'src/media_worker.py', 'src/media-checks.js', 'src/host-media.js', 'src/run-control.js', 'src/video-sop.js', 'src/report-export.js', 'docs/MEDIA-REVISION.md', 'docs/MEDIA-REVISION.en.md', 'README.md', 'README.en.md', 'docs/SOP-CATALOG.md']) assert.ok(paths.has(required), `Missing ${required}`)
console.log(`Packed-contract checks passed: ${paths.size} files, ${info.size} bytes.`)
