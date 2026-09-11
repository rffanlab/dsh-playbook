import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)

test('package exports the declared DSH web client bundle', async () => {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.ok(pkg.dsh?.client, 'package declares dsh.client')
  assert.equal(pkg.exports?.['./client'], './lib/client.js')
  await access(resolve(root, 'lib/client.js'))
  assert.ok(pkg.files?.includes('lib/client.js'), 'client bundle must be included in npm package files')
})
