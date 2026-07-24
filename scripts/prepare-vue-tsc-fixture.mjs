import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pnpmDir = resolve('node_modules/.pnpm')

if (!existsSync(pnpmDir)) {
  process.exit(0)
}

const entries = await readdir(pnpmDir)
const checkerDirs = entries.filter(name => name.startsWith('vite-plugin-checker@'))

for (const dir of checkerDirs) {
  const preparePath = join(
    pnpmDir,
    dir,
    'node_modules/vite-plugin-checker/dist/checkers/vueTsc/prepareVueTsc.js'
  )

  if (!existsSync(preparePath)) continue

  try {
    const { prepareVueTsc } = await import(pathToFileURL(preparePath).href)
    await prepareVueTsc()
    console.log('[postinstall] vue-tsc fixture prepared')
    process.exit(0)
  } catch (error) {
    console.warn('[postinstall] vue-tsc fixture preparation skipped:', error instanceof Error ? error.message : error)
    process.exit(0)
  }
}
