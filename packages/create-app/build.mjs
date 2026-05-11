import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const __templateDir = resolve(__dirname, 'template')
const __pagesDir = resolve(__templateDir, 'pages')

const shouldCreatePagesDict = () => !existsSync(__pagesDir)

// key: copy to (relative ./)
// value: origin (relative ./template)
const needCopyFiles = {
  'slides.md': '../../../demo/starter/slides.md',
  'pages/imported-slides.md': '../../../demo/starter/pages/imported-slides.md',
  'snippets/external.ts': '../../../demo/starter/snippets/external.ts',
  // Static SVG assets referenced by `slides.md` (e.g. `<img src="/feature-rotate.svg">`).
  // Live in `demo/starter/public/`; need to land at `template/public/` so a scaffolded
  // project can build the demo without "Could not resolve" errors.
  'public/feature-rotate.svg': '../../../demo/starter/public/feature-rotate.svg',
  'public/feature-drag.svg': '../../../demo/starter/public/feature-drag.svg',
  'public/feature-crop.svg': '../../../demo/starter/public/feature-crop.svg',
  'public/feature-crop-2.svg': '../../../demo/starter/public/feature-crop-2.svg',
  'public/feature-reorder.svg': '../../../demo/starter/public/feature-reorder.svg',
  'public/feature-reorder-2.svg': '../../../demo/starter/public/feature-reorder-2.svg',
  'public/feature-resize.svg': '../../../demo/starter/public/feature-resize.svg',
  'public/feature-resize-locked.svg': '../../../demo/starter/public/feature-resize-locked.svg',
}

async function main() {
  if (shouldCreatePagesDict())
    await fs.mkdir(__pagesDir, { recursive: true })

  await Promise.all(
    Object.keys(needCopyFiles).map(async (relativeTargetPath) => {
      const sourcePath = resolve(__templateDir, needCopyFiles[relativeTargetPath])
      const targetPath = resolve(__templateDir, relativeTargetPath)
      if (existsSync(targetPath))
        await fs.rm(targetPath, { recursive: true, force: true })

      await fs.mkdir(dirname(targetPath), { recursive: true })
      await fs.copyFile(sourcePath, targetPath)
    }),
  )
  // eslint-disable-next-line no-console
  console.log('done...')
}

main()
