#!/usr/bin/env node
/**
 * Build a release ZIP for one plugin, plus the matching `<asset>.zip.sha256`
 * sidecar. The host installs this ZIP from a GitHub Release URL.
 *
 * The archive root is the plugin directory itself (`plugin.json` +
 * `dist/index.js` + a minimal `package.json`), which is exactly the layout the
 * host validates after extraction. `package.json` is generated (never copied
 * from the repo) so the extracted `.js` is resolved as ESM: without
 * `"type": "module"` Node would treat it as CommonJS outside the plugin repo.
 *
 * Sources of truth are the committed build artifacts: run `pnpm build` first
 * when `dist/` is stale.
 *
 * Usage: node scripts/package-plugin.mjs [plugin-name]
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(HERE, '..')
const OUT_DIR = path.join(PROJECT_ROOT, 'dist-packages')

/** Fixed DOS timestamp: 1980-01-01 00:00 (deterministic archives). */
const DOS_TIME = 0
const DOS_DATE = 0x0021

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Minimal ZIP writer (deflate, no zip64/encryption/data descriptor).
 * The host parser rejects anything else, so staying in the simple subset is
 * deliberate.
 */
function buildZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = file.data
    const compressed = deflateRawSync(data, { level: 9 })
    const checksum = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 file names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attributes
    // External attributes (unix mode 100644). Plain multiplication, not `<<`:
    // the shift produces a signed 32-bit value and breaks writeUInt32LE.
    central.writeUInt32LE(0o100644 * 0x10000, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += local.length + name.length + compressed.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, eocd])
}

async function packagePlugin(name) {
  const pluginDir = path.join(PROJECT_ROOT, name)
  const manifest = JSON.parse(
    await readFile(path.join(pluginDir, 'plugin.json'), 'utf8'),
  )
  const entry = manifest.entry
  const entryFile = path.join(pluginDir, entry)
  if (typeof entry !== 'string' || !existsSync(entryFile)) {
    throw new Error(
      `${name}: entry ${String(entry)} is missing; run \`pnpm build\` first`,
    )
  }

  const entryPath = entry.replace(/\\/g, '/')
  const packageJson = {
    name: `rem2-plugin-${name}`,
    version: manifest.version,
    private: true,
    type: 'module',
    main: `./${entryPath}`,
  }
  const files = [
    {
      name: 'plugin.json',
      data: await readFile(path.join(pluginDir, 'plugin.json')),
    },
    { name: entryPath, data: await readFile(entryFile) },
    {
      name: 'package.json',
      data: Buffer.from(`${JSON.stringify(packageJson, null, 2)}\n`, 'utf8'),
    },
  ]

  const zip = buildZip(files)
  const assetName = `${name}-${manifest.version}.zip`
  const digest = createHash('sha256').update(zip).digest('hex')

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, assetName), zip)
  await writeFile(
    path.join(OUT_DIR, `${assetName}.sha256`),
    `${digest}  ${assetName}\n`,
    'utf8',
  )
  process.stdout.write(
    `${assetName} (${zip.length} bytes)\nsha256 ${digest}\n`,
  )
}

async function main() {
  const name = process.argv[2]
  if (!name) {
    // Default to the only plugin; list directories instead of hardcoding a name
    // so adding a second plugin forces an explicit choice.
    const candidates = (
      await readdir(PROJECT_ROOT, { withFileTypes: true })
    ).filter(
      entry =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        existsSync(path.join(PROJECT_ROOT, entry.name, 'plugin.json')),
    )
    if (candidates.length !== 1) {
      process.stderr.write(
        `Specify one plugin name; candidates: ${candidates.map(c => c.name).join(', ') || '(none)'}\n`,
      )
      process.exitCode = 1
      return
    }
    await packagePlugin(candidates[0].name)
    return
  }
  await packagePlugin(name)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
