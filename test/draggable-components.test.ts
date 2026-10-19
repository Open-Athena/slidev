import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDraggableComponents } from '../packages/slidev/node/syntax'

describe('resolveDraggableComponents', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('`true` lists the deck\'s single-root components; lists pass through', () => {
    root = mkdtempSync(join(tmpdir(), 'slidev-cmp-'))
    mkdirSync(join(root, 'components'))
    const files: Record<string, string> = {
      'Single.vue': '<template>\n  <!-- a comment -->\n  <div class="x"><span /></div>\n</template>\n',
      'Fragment.vue': '<template>\n  <h2>a</h2>\n  <p>b</p>\n</template>\n',
      'NoTemplate.vue': '<script setup lang="ts">\nconst x = 1\n</script>\n',
      'notes.md': '# not a component\n',
    }
    for (const [name, body] of Object.entries(files))
      writeFileSync(join(root, 'components', name), body)
    expect([
      resolveDraggableComponents(true, root),
      resolveDraggableComponents(['Fragment'], root),
      resolveDraggableComponents(undefined, root),
    ]).toEqual([['Single'], ['Fragment'], []])
  })
})
