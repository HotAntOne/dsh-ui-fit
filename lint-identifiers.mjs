import fs from 'node:fs'

const src = fs.readFileSync('client.js', 'utf8')

const stale = [
  'data-dsh-sfb',
  'dsh-sfb',
  '--dsh-tidy-ctl',
  'data-dsh-tidy',
  'data-dsh-mobile-compact',
  'dsh-input-tidy',
  'dsh-mobile-compact',
]

/**
 * 允许出现的地方：迁移旧键。`LEGACY_MODE_KEY` 必须原样写旧插件的 localStorage
 * 键名，否则老用户的三态选择会丢。除此之外任何旧名字都算残留。
 */
const ALLOWED = /const LEGACY_MODE_KEY = 'dsh-sidebar-fold:mode'/

let bad = 0
for (const needle of stale) {
  let count = 0
  for (const line of src.split('\n')) {
    if (!line.includes(needle)) continue
    if (ALLOWED.test(line)) continue
    count += line.split(needle).length - 1
  }
  if (count > 0) {
    bad += 1
    console.log('LEFTOVER', needle, count)
  }
}

const start = src.indexOf('const CSS = [')
const end = src.indexOf("].join('\\n')", start)
const block = src.slice(start, end)
const backticks = (block.match(/`/g) || []).length
if (backticks > 0) {
  bad += 1
  console.log('BACKTICK inside the CSS array:', backticks)
}

console.log(bad === 0 ? 'OK no stale identifiers, no backticks in CSS' : 'FAILED ' + bad)
process.exit(bad === 0 ? 0 : 1)
