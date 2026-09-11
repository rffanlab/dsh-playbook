import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { normalizePlaybook } from './core.js'

export async function loadPlaybooksFromDirectory(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = entries
    .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
    .map(entry => entry.name)
    .sort()
  const loaded = []
  for (const name of files) {
    const path = join(directory, name)
    const raw = JSON.parse(await readFile(path, 'utf8'))
    loaded.push({ playbook: normalizePlaybook(raw), source: path })
  }
  return loaded
}
