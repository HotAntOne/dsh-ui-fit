#!/usr/bin/env node
/**
 * 自检 / 自愈：确保 Host 半边能解析到 `@deepseek-ai/schemastery`。
 *
 * 为什么需要这个脚本（踩过的坑，2026-11-02）：
 *
 * 本插件在开发期是用 `link:` 装进 profile 的
 * （`~/.dsh/profiles/desktop/package.json` 里 `"dsh-ui-fit": "link:<工作区路径>"`）。
 * 这种情况下 Node 会先把入口解析成**真实路径**（工作区目录），再从真实路径向上找
 * `node_modules`。工作区那条目录链上没有 `node_modules`，于是 `import z from
 * '@deepseek-ai/schemastery'` 抛 ERR_MODULE_NOT_FOUND，Loader 把这一行标成
 * `inactive`——**表现是插件整个消失**（页脚按钮没了、设置页也没了），
 * 但配置、patch、bundles 全都是好的，极难从表面看出来。
 *
 * 所以：装完依赖要能自证。这个脚本做三件事：
 *   1. 用与 Node 相同的规则解析一次；能解析就直接通过。
 *   2. 解析不到时，找同机上已装好的 profile，用 junction / symlink 指过去（开发机自愈）。
 *   3. 都不行就退出码 1，把该跑的命令打出来——绝不静默通过。
 *
 * 用法：`npm run setup`（也可以在 `npm install` 之后手动跑）。
 */

import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = '@deepseek-ai/schemastery'
const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(HERE, 'index.js'))

/** 能不能从本目录解析到目标包；返回解析结果或 null。 */
function tryResolve() {
  try {
    return require.resolve(PACKAGE)
  } catch {
    return null
  }
}

/** 从某个目录出发能不能解析到目标包。 */
function resolveFrom(dir) {
  try {
    return createRequire(join(dir, 'index.js')).resolve(PACKAGE)
  } catch {
    return null
  }
}

/** 本机可能的 profile 目录（开发机自愈用）。 */
function profileCandidates() {
  const out = []
  const dshHome = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  const profilesDir = join(dshHome, 'profiles')
  if (!existsSync(profilesDir)) return out
  for (const name of readdirSync(profilesDir)) {
    const nodeModules = join(profilesDir, name, 'node_modules')
    if (existsSync(nodeModules) && statSync(nodeModules).isDirectory()) out.push(nodeModules)
  }
  return out
}

/** 建一个指向 profile 的 node_modules 链接（只在本目录没有 node_modules 时用）。 */
function linkTo(nodeModules) {
  const target = join(HERE, 'node_modules')
  if (existsSync(target)) return false
  try {
    // Windows 上 type 参数决定建的是 junction（目录）还是 symlink；POSIX 忽略它。
    symlinkSync(nodeModules, target, 'junction')
    return true
  } catch {
    return false
  }
}

const resolved = tryResolve()
if (resolved !== null) {
  console.log(`✓ ${PACKAGE} 可解析：${resolved}`)
  process.exit(0)
}

console.log(`✗ 从 ${HERE} 解析不到 ${PACKAGE}`)
console.log('  这会让 Loader 把 dsh-ui-fit 标成 inactive —— 插件会整个消失。')

for (const nodeModules of profileCandidates()) {
  if (resolveFrom(nodeModules) === null) continue
  if (linkTo(nodeModules)) {
    const after = tryResolve()
    if (after !== null) {
      console.log(`✓ 已链接到 ${nodeModules}`)
      console.log(`  ${PACKAGE} → ${after}`)
      console.log('  注意：这是开发机自愈，正式安装请用 npm install。')
      process.exit(0)
    }
  }
}

console.error('')
console.error('请在插件目录执行：')
console.error('  npm install')
console.error('')
console.error('（package.json 的 dependencies 里已声明该依赖，安装后会在本目录生成 node_modules。）')
process.exit(1)
