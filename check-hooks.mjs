#!/usr/bin/env node
/**
 * 体检脚本：DSH 升级后，检查本插件的 CSS 还认不认得宿主。
 *
 * 纯样式插件不会把软件改坏，但宿主一旦改版，选择器可能悄悄失效（样式不生效、
 * 或者位置规则藏错元素）。这个脚本把每一段规则依赖的钩子逐个在 asar 里数一遍，
 * 缺了就报出来。
 *
 * 用法：
 *   node check-hooks.mjs                     # 默认 asar + 当前 profile
 *   node check-hooks.mjs --asar <路径>
 *   node check-hooks.mjs --dir <某个 node_modules 目录>
 *
 * 退出码：0 全部命中；1 有缺失。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_ASAR = 'D:/Program Files/DeepSeek Harness/resources/app.asar'
const DEFAULT_DIR = `${process.env.HOME ?? process.env.USERPROFILE}/.dsh/profiles/desktop/node_modules`

/**
 * 每一组规则依赖的钩子。`needle` 是要在宿主源码里找到的字面量，`label` 是报错时
 * 给人看的说明（写清是哪一段的哪条规则）。
 */
const HOOKS = [
  /* ---- 一、左栏导航 ---- */
  { needle: '_panelList', label: '导航：全局面板 nav 的类名局部名' },
  { needle: 'aria-haspopup', label: '导航：宿主「更多」行（区分面板 nav 用）' },
  { needle: 'dsh-mobile-control__trigger', label: '导航：页脚 dsh-mobile 触发器（对齐图标节奏用）' },
  /* ---- 二、对话宽度（1.2.0 起自实现，不再依赖第三方插件） ---- */
  { needle: 'data-conversation-content', label: '宽度：主对话区根元素（宽度变量发布点）' },
  { needle: 'data-sidebar-chat', label: '宽度：侧栏会话副本（要排除的那份）' },
  { needle: 'dsh-chat-content-width', label: '宽度：内容宽度 CSS 变量' },
  { needle: 'dsh.conversation.contentWidth', label: '宽度：宿主的内容宽度偏好键' },
  { needle: 'data-width-handle', label: '宽度：拖拽手柄（读数 guide 挂在它上面）' },

  /* ---- 三、输入条 ---- */
  { needle: 'data-better-input-state', label: '输入条：语音按钮（隐藏目标）' },
  { needle: 'pua-trigger', label: '输入条：PUA 控件' },
  { needle: 'pua-entry-icon', label: '输入条：PUA 图标' },
  { needle: 'data-composer-card', label: '输入条：输入卡（窄行测量与精确选择器）' },
  { needle: '_triggerIcon', label: '输入条：模式控件的图标（:has 守卫）' },
  { needle: '_triggerLabel', label: '输入条：模式控件的文字' },
  { needle: '_chevron', label: '输入条：模式控件的箭头' },
  { needle: '_trailing', label: '输入条：右侧控件组类名后缀' },
  { needle: '_standardControls', label: '输入条：模型选择器容器类名后缀' },
  { needle: 'data-dsh-mobile-composer-row', label: '输入条：dsh-mobile 的 44px 触控下限（要反制）' },
  { needle: 'data-dsh-mobile-composer-trailing', label: '输入条：dsh-mobile 右侧容器' },

  /* ---- 四、手机端密度 ---- */
  { needle: 'data-composer-dock', label: '手机：底部状态条容器' },
  { needle: 'data-composer-stat', label: '手机：统计胶囊（计时/用量）' },
  { needle: 'data-conversation-tabs', label: '手机：视图标签行' },
  { needle: 'data-dsh-mobile-header', label: '手机：顶栏' },
  { needle: 'data-turn-tail', label: '手机：消息操作行 / 每轮费用行' },
  { needle: 'data-turn-process', label: '手机：「已完成，用时」行' },
  { needle: 'data-turn-trigger', label: '手机：「收到执行请求」行' },
  { needle: 'data-chat-running', label: '手机：「深度求索中」行' },
  { needle: 'data-process-activity', label: '手机：活动状态区' },
  { needle: 'pua-activity-header', label: '手机：PUA 活动头' },
  { needle: 'cm-note', label: '手机：每轮费用行' },
  { needle: 'cm-btn', label: '手机：费用按钮' },
  { needle: 'cm-session-detail', label: '手机：本会话明细' },
  { needle: 'cm-stat-entry', label: '手机：费用明细入口' },
  { needle: 'cm-session-cost', label: '手机：本会话合计' },
  { needle: '_headerActions', label: '手机：顶栏操作区类名后缀' },
  { needle: '_headerUtilities', label: '手机：顶栏工具区类名后缀' },
  { needle: '_headerCorner', label: '手机：顶栏角落（工作区芯片）类名后缀' },
  { needle: '_titleRow', label: '手机：顶栏标题行类名后缀' },
  { needle: '_actions', label: '手机：消息操作行类名后缀' },
  { needle: '_endInfo', label: '手机：时间戳容器类名后缀' },
  { needle: '_timeStart', label: '手机：时间戳类名后缀' },
]

const args = process.argv.slice(2)
const asarIndex = args.indexOf('--asar')
const dirIndex = args.indexOf('--dir')
const asarPath =
  asarIndex >= 0 ? args[asarIndex + 1] : args[0] && !args[0].startsWith('-') ? args[0] : DEFAULT_ASAR
const extraDir = dirIndex >= 0 ? args[dirIndex + 1] : DEFAULT_DIR

/** 读取 asar 内的文本条目。 */
function readAsar(archive) {
  const fd = readFileSync(archive)
  const headerPickleSize = fd.readUInt32LE(4)
  const jsonLength = fd.readUInt32LE(12)
  const json = JSON.parse(fd.toString('utf8', 16, 16 + jsonLength))
  const base = 8 + headerPickleSize
  const chunks = []

  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const full = prefix === '' ? name : `${prefix}/${name}`
      if (entry.files) {
        walk(entry, full)
        continue
      }
      if (!full.endsWith('.js')) continue
      if ((entry.size ?? 0) > 2 * 1024 * 1024) continue
      const start = base + Number(entry.offset)
      chunks.push(fd.subarray(start, start + Number(entry.size)).toString('utf8'))
    }
  }
  walk(json, '')
  return chunks
}

/**
 * 读取某个 node_modules 目录下所有 `lib/*.js`。
 *
 * 要同时处理两种布局：平铺的 `name/lib/`，以及作用域包的 `@scope/name/lib/`。
 * 漏掉后者会让「PUA 控件」这类钩子被误报成缺失（踩过一次）。
 */
function readDir(dir) {
  const out = []
  const push = (p) => {
    try {
      if (statSync(p).size <= 4 * 1024 * 1024) out.push(readFileSync(p, 'utf8'))
    } catch {
      /* 跳过不可读的包。 */
    }
  }
  const readLib = (pkgDir) => {
    push(join(pkgDir, 'lib', 'client.js'))
    try {
      for (const inner of readdirSync(join(pkgDir, 'lib'))) {
        if (inner.endsWith('.js')) push(join(pkgDir, 'lib', inner))
      }
    } catch {
      /* 这个包没有 lib 目录。 */
    }
  }
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name.startsWith('@')) {
      try {
        for (const inner of readdirSync(join(dir, name))) readLib(join(dir, name, inner))
      } catch {
        /* 空作用域目录。 */
      }
      continue
    }
    readLib(join(dir, name))
  }
  return out
}

const corpus = []
try {
  corpus.push(...readAsar(asarPath))
} catch (error) {
  console.error(`读不到 asar：${asarPath}（${error.message}）`)
  process.exitCode = 1
}
corpus.push(...readDir(extraDir))

if (corpus.length === 0) {
  console.error('没有读到任何源码，无法体检。')
  process.exit(1)
}

const text = corpus.join('\n')
let missing = 0
for (const { needle, label } of HOOKS) {
  const count = text.split(needle).length - 1
  if (count === 0) {
    missing += 1
    console.log(`✗ ${label}：找不到 ${needle}`)
  } else {
    console.log(`✓ ${label}：${needle} ×${count}`)
  }
}

console.log(
  missing === 0
    ? '\n全部钩子都在：本版插件与当前 DSH 匹配。'
    : `\n有 ${missing} 个钩子缺失：对应规则会静默失效，需要按新 DOM 修选择器（不会损坏软件）。`,
)
process.exit(missing === 0 ? 0 : 1)
