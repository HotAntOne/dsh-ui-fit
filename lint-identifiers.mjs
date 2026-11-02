import fs from 'node:fs'

const src = fs.readFileSync('client.js', 'utf8')

/**
 * 被合并掉的三个旧插件留下的名字，一个都不许再出现。
 *
 * 这份清单本身必须写出这些名字才能检查它们，除此之外 client.js 里任何一处都算残留。
 * （早期版本曾允许保留旧 localStorage 键做一次性迁移；迁移窗口已关闭，例外已撤掉。）
 */
const stale = [
  'data-dsh-sfb',
  'dsh-sfb',
  '--dsh-tidy-ctl',
  'data-dsh-tidy',
  'data-dsh-mobile-compact',
  'dsh-sidebar-fold',
  'dsh-input-tidy',
  'dsh-mobile-compact',
]

let bad = 0
for (const needle of stale) {
  let count = 0
  for (const line of src.split('\n')) {
    if (!line.includes(needle)) continue
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
