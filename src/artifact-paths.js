import { isAbsolute, resolve, relative, sep } from 'node:path'

function contained(root, path) {
  const r = relative(root, path)
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r))
}
/** Resolve notation, not contents. Never search other directories to find a match. */
export function manifestPath(value, isolation) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0'))
    throw new Error('MANIFEST_PATH_REQUIRED: provide a bounded manifest path')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.split(/[\\/]/).includes('..'))
    throw new Error('RUN_PATH_TRAVERSAL: URLs and parent traversal are not manifest paths')
  if (!isolation?.workspace || !isolation.root || !isolation.key) throw new Error('Missing Host run path context')
  const normalized = value.replace(/^(\.\/)+/, '')
  const projectForm = /^\.dsh-runs[\\/]/.test(normalized)
  const root = isolation.realRoot ?? isolation.root
  let resolved = isAbsolute(value) ? resolve(value) : resolve(projectForm ? isolation.workspace : root, normalized)
  if (contained(isolation.root, resolved)) resolved = resolve(root, relative(isolation.root, resolved))
  if (!contained(root, resolved)) throw new Error('CROSS_RUN_PATH: manifest must belong to the allocated current run; no search or adoption of another run')
  return { path: resolved, submitted: value, base: projectForm ? 'session-workspace' : isAbsolute(value) ? 'absolute' : 'run-root',
    correction: resolved === value ? null : { field: 'production_manifest', from: value, to: resolved, reason: 'explicit path-base normalization; no filesystem guessing' } }
}
