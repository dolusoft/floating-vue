// Local release for the Dolusoft fork: lint, build, test, pack, then publish the tarball as an
// immutable GitHub Release asset. Usage: pnpm release:dolusoft [--dry-run]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'dolusoft/floating-vue'
const BRANCH = 'main'
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = resolve(rootDir, 'packages/floating-vue')
const outDir = resolve(rootDir, '.release')
const dryRun = process.argv.includes('--dry-run')
const isWindows = process.platform === 'win32'

// Files a consumer imports; the tarball must contain each of them.
const REQUIRED_PACKED_FILES = [
  'package/package.json',
  'package/dist/floating-vue.mjs',
  'package/dist/floating-vue.umd.js',
  'package/dist/index.d.ts',
  'package/dist/style.css',
  'package/nuxt.mjs',
]

function run (bin, args, cwd = rootDir) {
  execFileSync(bin, args, { cwd, stdio: 'inherit', shell: isWindows && bin === 'pnpm' })
}

function output (bin, args, cwd = rootDir) {
  return execFileSync(bin, args, { cwd, encoding: 'utf-8', shell: isWindows && bin === 'pnpm' }).trim()
}

function fail (message) {
  console.error(`release:dolusoft: ${message}`)
  process.exit(1)
}

// <upstream version>-[<prerelease>.]dolusoft.<n>; the prerelease part is mandatory.
function assertDolusoftVersion (version) {
  if (!/^\d+\.\d+\.\d+-(?:[0-9A-Za-z-]+\.)*dolusoft\.[1-9]\d*$/.test(version)) {
    fail(`version ${version} does not match <upstream>-[<pre>.]dolusoft.<n>`)
  }
}

const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8'))
const version = pkg.version
assertDolusoftVersion(version)
const tag = `v${version}`
const file = `dolusoft-floating-vue-${version}.tgz`

if (output('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== BRANCH) fail(`release only from ${BRANCH}`)
if (output('git', ['status', '--porcelain'])) fail('working tree is not clean')
if (output('git', ['ls-remote', '--tags', 'origin', tag])) {
  fail(`${tag} already exists on origin; bump the version, never reuse a tag`)
}

run('pnpm', ['run', 'lint'])
run('pnpm', ['run', 'build'])
// The peeky unit runner does not finish on Windows; the node:test suite runs against the build.
run('pnpm', ['run', 'test:node'], pkgDir)

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
run('pnpm', ['pack', '--pack-destination', outDir], pkgDir)
if (output('git', ['status', '--porcelain', '--', '.', ':!.release'])) {
  fail('release steps (lint, build, test or pack) changed tracked files')
}

// tar is called with a relative path from inside outDir: GNU tar reads "C:\..." as a remote host.
const listing = output('tar', ['-tzf', file], outDir).split(/\r?\n/u)
const missing = REQUIRED_PACKED_FILES.filter(entry => !listing.includes(entry))
if (missing.length) fail(`tarball is missing: ${missing.join(', ')}`)
const packed = JSON.parse(output('tar', ['-xOzf', file, 'package/package.json'], outDir))
if (packed.version !== version) fail(`packed version ${packed.version} is not ${version}`)
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, range] of Object.entries(packed[field] || {})) {
    if (/^(workspace|catalog):/.test(range)) fail(`packed ${field}.${name} is ${range}`)
  }
}

const sha = output('git', ['rev-parse', 'HEAD'])
const tarball = resolve(outDir, file)
console.log(`Ready: ${tag} at ${sha} -> ${tarball}`)

// The dry run comes before the push (commit -> dry run -> push), so it only reports this check.
run('git', ['fetch', 'origin', BRANCH])
const remoteHead = output('git', ['rev-parse', `origin/${BRANCH}`])
if (dryRun) {
  if (sha !== remoteHead) console.warn(`HEAD is not pushed yet (origin/${BRANCH} is ${remoteHead})`)
  process.exit(0)
}
if (sha !== remoteHead) fail(`HEAD ${sha} is not origin/${BRANCH} (${remoteHead}); push first`)

run('git', ['tag', '-a', tag, '-m', `Dolusoft fork release ${version}`])
run('git', ['push', 'origin', tag])
run('gh', [
  'release', 'create', tag, tarball,
  '--repo', REPO,
  '--verify-tag',
  '--prerelease',
  '--title', `floating-vue ${version} (Dolusoft fork)`,
  '--notes', `Built from ${sha} on ${BRANCH}. Consume via the asset URL; never overwrite.`,
])
console.log(`https://github.com/${REPO}/releases/download/${tag}/${file}`)
