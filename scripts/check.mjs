import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
for (const directory of ['src', 'lib', 'scripts']) {
  for (const name of readdirSync(directory).filter(file => /\.(m?js)$/.test(file))) {
    const result = spawnSync(process.execPath, ['--check', `${directory}/${name}`], { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
console.log('Syntax checks passed.')
