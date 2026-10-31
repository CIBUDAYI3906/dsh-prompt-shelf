/**
 * Guard rail for `npm publish`: a package that still carries the repository
 * placeholder, or a `client.js` whose module id no longer matches the package
 * name, must fail here rather than ship.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const problems = []

/** @param condition - the requirement. @param message - what failed. */
function require(condition, message) {
  if (!condition) problems.push(message)
}

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
require(pkg.private !== true, 'package.json still has "private": true')
require(typeof pkg.name === 'string' && pkg.name.startsWith('dsh-'), 'the package name should start with "dsh-"')
require(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version), 'package.json needs a semver version')
require(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json must declare dsh.bundle.patch')
require(typeof pkg.dsh?.client?.platform === 'string', 'package.json must declare dsh.client.platform')
require(typeof pkg.engines?.dsh === 'string', 'package.json must declare an engines.dsh range')
require(pkg.repository?.url?.includes('OWNER') !== true, 'repository.url still contains OWNER — run `npm run owner <github-user>`')
require(pkg.homepage?.includes('OWNER') !== true, 'homepage still contains OWNER — run `npm run owner <github-user>`')

const client = readFileSync(join(pkgDir, 'client.js'), 'utf8')
require(client.includes('id: ' + JSON.stringify(pkg.name)), 'client.js module id does not match the package name — run `npm run build`')
const patch = readFileSync(join(pkgDir, 'cordis.patch.yml'), 'utf8')
require(patch.includes('name: ' + pkg.name), 'cordis.patch.yml must mount the package by its own name')
require(readFileSync(join(pkgDir, 'icon.png')).length < 256 * 1024, 'icon.png must stay under 256 KiB')
for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'LICENSE', 'icon.png']) {
  try {
    readFileSync(join(pkgDir, file))
  } catch {
    problems.push('missing file: ' + file)
  }
}

if (problems.length > 0) {
  console.error('preflight failed:')
  for (const problem of problems) console.error('  ✗ ' + problem)
  process.exit(1)
}
console.log('preflight: OK — ' + pkg.name + '@' + pkg.version)
