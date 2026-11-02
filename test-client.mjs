/**
 * `dsh-ui-fit` 浏览器半边的离线冒烟测试。
 *
 * 用 vm 沙箱跑真实的 client.js：假的 `window.__ModuleLoader__`、假模块表（不提供
 * primitives，走兜底分支）、假 Cordis 上下文、假 DOM。断言覆盖：
 *
 * 1. 模块形状与三个槽位注册；
 * 2. 样式表里三段规则都在，且都用新的 `data-dsh-fit-*` 门控；
 * 3. 导航三态循环、localStorage 持久化、图标随状态变化；
 * 4. 宽度入口延后一拍转发、菜单已开时不转发；
 * 5. 「更多」菜单的行与回调；
 * 6. 三个开关真的能让对应规则失效（摘掉 `<html>` 属性）；
 * 7. primitives 存在时走 Tooltip / MenuItemButton；
 * 8. 清理时把标记和样式全部摘掉。
 *
 * 跑法：`node test-client.mjs`
 */
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* 相对本文件定位，换机器 / 换 clone 目录都不用改。 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), 'client.js')

/* ---------------- 假 DOM ---------------- */

const styles = []
const htmlAttrs = new Map()
const navAttrs = new Set()
const footAttrs = new Set()

const fakeFoot = {
  hasAttribute: (name) => footAttrs.has(name),
  setAttribute: (name) => footAttrs.add(name),
  removeAttribute: (name) => footAttrs.delete(name),
}
const fakeTrigger = { parentElement: fakeFoot }

/**
 * 槽位锚点 `[data-slot="sidebar.panellist"]` 的替身。
 *
 * 真实 DOM 里这些锚点是 `<div data-slot="sidebar.panellist" style="display:contents">`，
 * 插件的 `tagNav()` 用 `anchor.closest('nav')` 往上找到面板 `<nav>`。这里让 `closest`
 * 返回 `fakeNav`，就能验证「走契约锚点」这条路径——把 `fakeNav.className` 改成别的
 * （模拟宿主换哈希类名）也仍然能标记上。
 */
let panelAnchors = [{ closest: (sel) => (sel === 'nav' ? fakeNav : null) }]

const fakeNav = {
  className: 'wtg9ga_panelList',
  hasAttribute: (name) => navAttrs.has(name),
  setAttribute: (name) => navAttrs.add(name),
  removeAttribute: (name) => navAttrs.delete(name),
  querySelector: () => ({ kind: 'more' }),
}

const fakeRow = {
  clientWidth: 400,
  children: [],
  getBoundingClientRect: () => ({ width: 400, height: 48, top: 0 }),
}

const fakeToggle = {
  clicks: 0,
  click() {
    this.clicks += 1
  },
}
const fakeMenu = {
  open: false,
  hasAttribute(name) {
    return name === 'hidden' && !this.open
  },
}

const bodyAttrs = new Map()
const timers = []
const timerIds = new Map()
let timerSeq = 0
const flushTimers = () => {
  for (const run of timers.splice(0)) run()
  timerIds.clear()
}

/** 假元素：够 drag-guide 用（属性表 + 行内样式 + 父子关系）。 */
function fakeElement(tag) {
  const attrs = new Map()
  const styleProps = new Map()
  /* `el.style.left = '10px'` 和 `el.style.setProperty('left', …)` 都要能读到，用 Proxy 统一。 */
  const style = new Proxy(
    {
      setProperty: (name, value) => styleProps.set(name, String(value)),
      removeProperty: (name) => styleProps.delete(name),
      getPropertyValue: (name) => (styleProps.has(name) ? styleProps.get(name) : ''),
    },
    {
      set(target, prop, value) {
        if (prop in target) {
          target[prop] = value
          return true
        }
        styleProps.set(prop, String(value))
        return true
      },
      get(target, prop) {
        if (prop in target) return target[prop]
        return styleProps.has(prop) ? styleProps.get(prop) : ''
      },
    },
  )
  return {
    tagName: tag || 'div',
    dataset: {},
    textContent: '',
    className: '',
    hidden: false,
    removed: false,
    parentNode: null,
    style,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    hasAttribute: (name) => attrs.has(name),
    remove() {
      this.removed = true
      const at = styles.indexOf(this)
      if (at >= 0) styles.splice(at, 1)
      if (this.parentNode !== null) this.parentNode.removeChild(this)
    },
  }
}

/** 主对话区根元素：宿主在它上面发布 `--dsh-chat-content-width`。 */
const fakeWidthRoot = {
  offsetWidth: 1200,
  parentElement: null,
  closest: () => null,
}
const fakeWidthTarget = {
  style: {
    props: new Map(),
    setProperty(name, value) {
      this.props.set(name, value)
    },
    removeProperty(name) {
      this.props.delete(name)
    },
    getPropertyValue(name) {
      return this.props.has(name) ? this.props.get(name) : ''
    },
  },
}
fakeWidthRoot.parentElement = fakeWidthTarget

/**
 * 宿主发布在根元素上的计算样式。真实浏览器里自定义属性的计算值是 token 串
 * （`clamp(680px, calc(...), 920px)`），所以默认空表就代表「解析不出数字」。
 */
const rootStyle = new Map()
const getComputedStyle = (el) => ({
  getPropertyValue: (name) => (el === fakeWidthRoot && rootStyle.has(name) ? rootStyle.get(name) : ''),
})

/** 内容宽度读数：跟真实宿主一样，行内变量优先，否则按 column × 0.64 夹取。 */
function contentWidthPx() {
  const raw = fakeWidthTarget.style.getPropertyValue('--dsh-chat-user-width')
  const px = parseFloat(raw)
  if (Number.isFinite(px) && px > 0) return px
  return Math.max(680, Math.min(1200 * 0.64, 920))
}

const docListeners = new Map()
const bodyChildren = []

const document = {
  head: { appendChild: (el) => styles.push(el) },
  body: {
    getAttribute: (name) => (bodyAttrs.has(name) ? bodyAttrs.get(name) : null),
    setAttribute: (name, value) => bodyAttrs.set(name, value),
    appendChild: (el) => {
      bodyChildren.push(el)
      el.parentNode = document.body
    },
    removeChild: (el) => {
      const at = bodyChildren.indexOf(el)
      if (at >= 0) bodyChildren.splice(at, 1)
      el.parentNode = null
    },
  },
  documentElement: {
    setAttribute: (name, value) => htmlAttrs.set(name, value),
    removeAttribute: (name) => htmlAttrs.delete(name),
  },
  getElementById: (id) => {
    if (id === 'dsh-wide-toggle') return fakeToggle
    if (id === 'dsh-width-menu') return fakeMenu
    return null
  },
  createElement: (tag) => fakeElement(tag),
  addEventListener: (type, fn) => {
    if (!docListeners.has(type)) docListeners.set(type, [])
    docListeners.get(type).push(fn)
  },
  removeEventListener: (type, fn) => {
    const list = docListeners.get(type)
    if (list === undefined) return
    const at = list.indexOf(fn)
    if (at >= 0) list.splice(at, 1)
  },
  querySelectorAll: (selector) => {
    if (selector === 'nav') return [fakeNav]
    if (selector === '[data-dsh-fit-foot]') return footAttrs.has('data-dsh-fit-foot') ? [fakeFoot] : []
    if (selector === '[data-dsh-fit-navlist]') return navAttrs.has('data-dsh-fit-navlist') ? [fakeNav] : []
    if (selector === '[data-conversation-content]') return [fakeWidthRoot]
    if (selector === '[data-slot="sidebar.panellist"]') return panelAnchors
    return []
  },
  querySelector: (selector) => {
    if (selector === '[data-composer-card] > [class*="_row"]') return fakeRow
    if (selector === 'nav[data-dsh-fit-navlist]') return navAttrs.has('data-dsh-fit-navlist') ? fakeNav : null
    if (selector === '.dsh-fit-trigger') return fakeTrigger
    if (selector === '[data-dsh-fit-foot]') return footAttrs.has('data-dsh-fit-foot') ? fakeFoot : null
    return null
  },
}

/* ---------------- 沙箱 ---------------- */

let loadedSpec
const sandbox = {
  window: { __ModuleLoader__: { load: (spec) => (loadedSpec = spec) }, innerWidth: 400 },
  document,
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null
    },
    setItem(key, value) {
      this.store.set(key, String(value))
    },
    removeItem(key) {
      this.store.delete(key)
    },
  },
  requestAnimationFrame: (fn) => {
    fn()
    return 1
  },
  cancelAnimationFrame: () => {},
  getComputedStyle,
  setTimeout: (fn) => {
    timerSeq += 1
    timerIds.set(timerSeq, fn)
    timers.push(fn)
    return timerSeq
  },
  clearTimeout: (id) => {
    const fn = timerIds.get(id)
    if (fn === undefined) return
    timerIds.delete(id)
    const at = timers.indexOf(fn)
    if (at >= 0) timers.splice(at, 1)
  },
  matchMedia: (query) => ({
    query,
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  console,
}
sandbox.window.document = document
sandbox.globalThis = sandbox

vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'client.js' })

assert.equal(loadedSpec.id, 'dsh-ui-fit', '模块 id')
assert.equal(typeof loadedSpec.factory, 'function', 'factory 是函数')

/* ---------------- 假 React / 假上下文 ---------------- */

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() }
  },
  Fragment: 'Fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

const moduleTable = { react: React } // 故意不给 primitives
const bundle = loadedSpec.factory((id) => {
  if (id in moduleTable) return moduleTable[id]
  throw new Error('MODULE_NOT_FOUND ' + id)
})

assert.equal(JSON.stringify(bundle.inject), '["slots","locale"]', 'bundle inject')
assert.equal(typeof bundle.apply, 'function', 'apply 是函数')

const registrations = []
function makeCtx(extra) {
  return {
    effect(fn, label) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register: (ns, dicts) => {
        assert.equal(ns, 'ui-fit', 'locale 命名空间')
        assert.ok(dicts.zh && dicts.en, '中英双字典')
        return () => {}
      },
      bind: () => (key) => key,
    },
    slots: {
      inject(name, provider) {
        const disposer = provider()
        registrations.push({ name })
        return disposer
      },
      register(spec, Component) {
        assert.ok(spec.name && spec.id, '注册项有 name 和 id')
        assert.equal(typeof Component, 'function', '注册的组件是函数')
        return () => {}
      },
    },
    ...(extra || {}),
  }
}

const cleanup = bundle.apply(makeCtx())

assert.deepEqual(
  registrations.map((r) => r.name),
  ['sidebar.footer.action', 'sidebar.footer.action', 'sidebar.panellist.actions', 'settings.section'],
  '两个页脚按钮 + 一个「更多」菜单段 + 一个设置页',
)

/* ---------------- 样式表与门控 ---------------- */

assert.equal(styles.length, 1, '只注入一张样式表')
const css = styles[0].textContent
assert.match(css, /--dsh-fit-ctl: clamp\(28px, 1\.5vw \+ 20px, 36px\)/, '控件直径变量定义在最前')
assert.match(css, /data-dsh-fit-navmode="compact"/, '导航紧凑规则存在')
assert.match(css, /data-dsh-fit-navmode="fold"/, '导航收纳规则存在')
assert.match(css, /data-dsh-fit-composer="on"/, '输入条规则存在')
assert.match(css, /data-dsh-fit-tight="on"/, '输入条窄行规则存在')
assert.match(css, /data-dsh-fit-mobile="on"/, '手机密度规则存在')
/* 专家按钮：窄屏压成纯图标。文字与箭头必须藏掉，按钮要回到方形图标位。 */
assert.match(
  css,
  /html\[data-dsh-fit-mobile="on"\] \[data-composer-card\] \.aag-btn-wrap \.aag-btn-label/,
  '手机端隐藏专家按钮文字',
)
assert.match(
  css,
  /html\[data-dsh-fit-mobile="on"\] \[data-composer-card\] \.aag-btn-wrap \.aag-btn-chevron\{display:none !important\}/,
  '手机端隐藏专家按钮下拉箭头',
)
/* 桌面不能受影响：这条规则必须挂在 mobile 门控下，不能是裸的 `.aag-btn-label`。 */
assert.equal(
  /(^|\n)(?!html\[data-dsh-fit-mobile)[^\n]*\.aag-btn-label/.test(css),
  false,
  '专家按钮的隐藏规则只在手机端生效',
)
assert.match(
  css,
  /html:not\(\[data-dsh-fit-nav="on"\]\) \.dsh-fit-trigger\[data-mode\]\{display:none\}/,
  '关掉导航只藏三态按钮，宽度按钮不受牵连',
)
assert.match(css, /#dsh-width-menu\{display:none\}/, '第三方宽度菜单被藏掉，只留本插件入口')
assert.match(css, /--dsh-fit-context-shift:1px/, '上下文百分比下移量可调')
assert.match(
  css,
  /\[data-composer-card\]\{--dsh-fit-btn:28px;--dsh-fit-icon:14px\}/,
  '输入条图标按宿主节奏：28px 按钮 + 14px 图标',
)
assert.match(
  css,
  /\.pua-trigger\{width:var\(--dsh-fit-btn\);height:var\(--dsh-fit-btn\)/,
  'PUA 按钮读统一按钮尺寸',
)
assert.match(css, /\.pua-entry-icon svg\{display:block;width:var\(--dsh-fit-icon\);height:var\(--dsh-fit-icon\)\}/, 'PUA 图标读统一图标尺寸')
assert.ok(
  !/--dsh-fit-ctl\)\{width:var\(--dsh-fit-ctl\);height:var\(--dsh-fit-ctl\)/.test(css) ||
    !/\.pua-trigger\{width:var\(--dsh-fit-ctl\)/.test(css),
  'PUA 按钮不再用导航那颗 36px 变量',
)
assert.match(
  css,
  /\[data-dsh-fit-tight="on"\] \[data-composer-card\]\{--dsh-fit-btn:28px;--dsh-fit-icon:14px\}/,
  '窄行也只收紧间距，不把按钮改大',
)
assert.ok(
  !/\[data-dsh-fit-tight="on"\] \[data-composer-card\]\{--dsh-fit-ctl:34px/.test(css),
  '窄行不再覆盖导航那颗控件直径变量',
)
assert.match(css, /\.dsh-fit-switch\[data-on="on"\]\{background:var\(--dsw-alias-brand-primary\)\}/, '开关打开态用品牌色')
assert.match(css, /\.dsh-fit-settings\{/, '设置页样式段存在')
assert.ok(
  !/html:not\(\[data-dsh-fit-(nav|composer|mobile)="on"\]\)[^{]*\.dsh-fit-settings/.test(css),
  '设置页不归任何开关管（否则关掉就再也开不回来）',
)

assert.equal(htmlAttrs.get('data-dsh-fit'), 'on', '根标记')
assert.equal(htmlAttrs.get('data-dsh-fit-nav'), 'on', '导航默认开')
assert.equal(htmlAttrs.get('data-dsh-fit-composer'), 'on', '输入条默认开')
assert.equal(htmlAttrs.get('data-dsh-fit-mobile'), 'on', '手机密度默认开（matchMedia 命中）')
assert.equal(htmlAttrs.get('data-dsh-fit-tight'), 'on', '行宽 400 < 560，窄行标记生效')
assert.equal(htmlAttrs.get('data-dsh-fit-width'), 'on', '宽度段默认开')
assert.equal(htmlAttrs.get('data-dsh-fit-navmode'), undefined, '标准态不打三态属性')
assert.ok(navAttrs.has('data-dsh-fit-navlist'), '面板 nav 已标记')
assert.ok(footAttrs.has('data-dsh-fit-foot'), '页脚那一排已标记')

/* ---------------- 导航锚点走契约，不靠哈希类名 ---------------- */

/* 宿主改版把哈希类名换掉（`wtg9ga_panelList` → 别的），类名判据必然失效；
   此时应当靠 `[data-slot="sidebar.panellist"]` 锚点仍然认出面板 nav。 */
const originalClassName = fakeNav.className
fakeNav.className = 'zzz_renamed_9f2c1'
navAttrs.clear()
const cleanupAnchor = bundle.apply(makeCtx())
assert.ok(navAttrs.has('data-dsh-fit-navlist'), '哈希类名变了，靠槽位锚点仍能标记面板 nav')
cleanupAnchor()
navAttrs.clear()

/* 锚点也不存在时（更老的宿主），退回类名判据。 */
panelAnchors = []
fakeNav.className = originalClassName
const cleanupFallback = bundle.apply(makeCtx())
assert.ok(navAttrs.has('data-dsh-fit-navlist'), '没有锚点时退回类名判据')
cleanupFallback()
navAttrs.clear()
panelAnchors = [{ closest: (sel) => (sel === 'nav' ? fakeNav : null) }]

/* ---------------- 组件 ---------------- */

let navComponent
let widthComponent
let menuComponent
let settingsComponent
const ctx2 = makeCtx({
  slots: {
    inject: (name, provider) => provider(),
    register(spec, Component) {
      if (spec.id === 'dsh-ui-fit-nav') navComponent = Component
      if (spec.id === 'dsh-ui-fit-width') widthComponent = Component
      if (spec.name === 'sidebar.panellist.actions') menuComponent = Component
      if (spec.name === 'settings.section') settingsComponent = Component
      return () => {}
    },
  },
})
const cleanup2 = bundle.apply(ctx2)
assert.equal(typeof navComponent, 'function')
assert.equal(typeof widthComponent, 'function')
assert.equal(typeof menuComponent, 'function')
assert.equal(typeof settingsComponent, 'function', '设置页组件已注册')

const t = (key) => 'L:' + key

const navTree = navComponent({ wide: true, t })
assert.equal(navTree.type, 'button', '没有 primitives 时是普通按钮')
assert.equal(navTree.props.className, 'dsh-fit-trigger')
assert.equal(navTree.props['data-mode'], 'standard', '起始是标准态')
assert.equal(navTree.props.title, 'L:nav.hint', '没有 Tooltip 时用原生 title')
assert.equal(navTree.children.length, 1, '只放图标')
assert.equal(navTree.children[0].props.className, 'dsh-fit-glyph')
const standardGlyph = navTree.children[0].children[0]
assert.equal(standardGlyph.type, 'svg', '导航图标是自绘的')
assert.equal(standardGlyph.props.viewBox, '0 0 16 16')
assert.equal(standardGlyph.props.width, 14, '与页脚其它按钮同一节奏')
assert.equal(standardGlyph.children.length, 3, '标准态三行')

const widthTree = widthComponent({ wide: true, t })
/* 触发器 + 菜单是兄弟节点，用 Fragment 包着。 */
assert.equal(widthTree.type, 'Fragment', '触发器和菜单同属一个 Fragment')
const widthButton = widthTree.children[0]
const widthMenu = widthTree.children[1]
assert.equal(widthButton.props.className, 'dsh-fit-trigger dsh-fit-width')
assert.equal(widthButton.props['data-tier'], 'standard', '默认标准挡位')
assert.equal(widthButton.props['aria-haspopup'], 'menu', '按钮声明弹出菜单')
const tierSvg = widthButton.children[0].children[0]
assert.equal(tierSvg.children.length, 6, '六个挡位六根条')
assert.equal(tierSvg.children[0].props.opacity, 1, '当前挡位之前点亮')
assert.equal(tierSvg.children[5].props.opacity, 0.3, '之后变暗')

/* 菜单：六行，每行是 menuitemradio，带实际像素读数。 */
assert.equal(widthMenu.props.className, 'dsh-fit-width-menu')
assert.equal(widthMenu.props.role, 'menu')
assert.equal(widthMenu.props.hidden, true, '默认收起')
assert.equal(widthMenu.children.length, 6, '六个挡位')
assert.equal(widthMenu.children[0].props.role, 'menuitemradio')
assert.equal(widthMenu.children[0].props['aria-checked'], 'true', '标准档选中')
assert.equal(widthMenu.children[1].props['aria-checked'], 'false')
/* 1200 列宽：标准 = clamp(680, 1200*0.64=768, 920) = 768。 */
assert.equal(widthMenu.children[0].children[1].children[0], '768px', '标准档报实际宽度')
/* 中档名义 1120 超过上限（1200-176=1024）→ 报「名义 → 实际」，别让六档看起来全一样。 */
assert.equal(widthMenu.children[1].children[1].children[0], '1120px → 1024px', '够不着时报夹取后的值')
assert.equal(widthMenu.children[5].children[1].children[0], '', '自定义未设置时不显示读数')

/* 点按钮开菜单（不再转发第三方插件）。 */
const toggleClicks = fakeToggle.clicks
widthButton.props.onClick()
assert.equal(fakeToggle.clicks, toggleClicks, '不再转发给第三方插件')
assert.equal(widthComponent({ wide: true, t }).children[1].props.hidden, true, '受控组件：测试替身不重渲染')

/* 选「中」：写持久化、写宽度变量、写宿主偏好键。 */
widthMenu.children[1].props.onClick()
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:width'), 'medium', '挡位持久化')
assert.equal(fakeWidthTarget.style.getPropertyValue('--dsh-chat-user-width'), '1024px', '宽度落到宿主变量')
assert.equal(sandbox.localStorage.getItem('dsh.conversation.contentWidth'), '1120', '写宿主偏好键（名义值）')

/* 选「满宽」：column − 176 = 1024。 */
widthComponent({ wide: true, t }).children[1].children[4].props.onClick()
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:width'), 'full')
assert.equal(fakeWidthTarget.style.getPropertyValue('--dsh-chat-user-width'), '1024px', '满宽等于列宽减边距')

/* 回标准：行内变量与偏好键都清掉，交还宿主。 */
widthComponent({ wide: true, t }).children[1].children[0].props.onClick()
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:width'), 'standard')
assert.equal(fakeWidthTarget.style.getPropertyValue('--dsh-chat-user-width'), '', '标准档清掉行内变量')
assert.equal(sandbox.localStorage.getItem('dsh.conversation.contentWidth'), null, '标准档也清掉宿主偏好键')

/* ---------------- 拖拽读数（guide） ---------------- */

/*
 * 宿主自己的手柄在 phase=active 时才挂载，测试里用一个带 closest 的假手柄，
 * 直接派发到 document 级监听上——这正是插件实际依赖的那条路径。
 */
const fakeHandle = { closest: (sel) => (sel === '[data-width-handle]' ? fakeHandle : null) }
const dispatchDoc = (type, x, y) => {
  const list = docListeners.get(type) || []
  for (const fn of list) fn({ type, target: fakeHandle, clientX: x, clientY: y })
}

const guides = bodyChildren.filter((el) => el.className === 'dsh-fit-width-guide')
assert.ok(guides.length >= 1, 'guide 挂在 body 上')
/* 前面几段 harness 各自 apply 过一次，取最后挂上去的那个（当前活跃实例）。 */
const guideEl = guides[guides.length - 1]
assert.equal(guideEl.hidden, true, '默认不显示')
assert.equal(guideEl.getAttribute('data-dsh-fit-width-guide'), '', '带标记属性')

/* 标准挡位：1200 列宽 → 默认宽度 min(max(680, 768), 1024) = 768 */
dispatchDoc('pointerdown', 600, 300)
dispatchDoc('pointermove', 540, 320)
assert.equal(guideEl.hidden, false, '拖动时显示读数')
assert.equal(guideEl.textContent, '768px', '读数取宿主默认公式（CSS 变量是 clamp 串，解析不出数字）')
assert.equal(guideEl.style.getPropertyValue('left'), '556px', '跟手：clientX + 16')
assert.equal(guideEl.style.getPropertyValue('top'), '320px')

/* 落点与标准挡位一致 → 不记自定义 */
dispatchDoc('pointerup', 540, 320)
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:width'), 'standard', '没动过就不改挡位')
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:widthCustom'), null, '没动过就不记自定义')
assert.equal(guideEl.hidden, false, '松手后先留着，800ms 后再收')
flushTimers()
assert.equal(guideEl.hidden, true, '800ms 后收起读数')

/* 落点变了 → 记成自定义挡位 */
rootStyle.set('--dsh-chat-content-width', '700px')
dispatchDoc('pointerdown', 600, 300)
dispatchDoc('pointermove', 500, 300)
assert.equal(guideEl.textContent, '700px', '读数优先用宿主发布的实际宽度')
dispatchDoc('pointerup', 500, 300)
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:width'), 'custom', '拖动改变宽度后切到自定义')
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:widthCustom'), '700', '记住落点宽度')
flushTimers()
rootStyle.clear()

/* 清掉拖拽状态，别影响后面的断言 */
sandbox.localStorage.setItem('dsh-ui-fit:width', 'standard')
sandbox.localStorage.removeItem('dsh-ui-fit:widthCustom')

/* ---------------- 三态循环 ---------------- */

navTree.props.onClick()
assert.equal(htmlAttrs.get('data-dsh-fit-navmode'), 'compact', '第二态：紧凑')
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:nav'), 'compact', '持久化到新键')
const compactTree = navComponent({ wide: true, t })
assert.equal(compactTree.children[0].children[0].children.length, 3, '紧凑态仍是三行')
assert.notEqual(
  compactTree.children[0].children[0].children[0].props.d,
  standardGlyph.children[0].props.d,
  '紧凑态行距更近',
)

compactTree.props.onClick()
assert.equal(htmlAttrs.get('data-dsh-fit-navmode'), 'fold', '第三态：收纳')
const foldTree = navComponent({ wide: true, t })
assert.equal(foldTree.children[0].children[0].children.length, 2, '收纳态一行 + 一个尖角')
assert.equal(foldTree.props['aria-label'], 'L:nav.aria: L:nav.fold')

foldTree.props.onClick()
assert.equal(sandbox.localStorage.getItem('dsh-ui-fit:nav'), 'standard', '第四次点击回到标准')
assert.equal(htmlAttrs.has('data-dsh-fit-navmode'), false, '标准态摘掉三态属性')

/* ---------------- 「更多」菜单 ---------------- */

const opened = []
const dismissed = []
const menuTree = menuComponent({
  entries: [
    { id: 'plugin-market', label: '插件市场', active: true },
    { id: 'ssh', label: 'SSH' },
  ],
  onOpen: (id) => opened.push(id),
  onDismiss: () => dismissed.push(1),
  t: (key) => key,
})
assert.equal(menuTree.children.length, 3, '插件管理 + 两个面板')
assert.equal(menuTree.children[0].props.className, 'dsh-fit-fallback-row', '没有 primitives 时用兜底行')
menuTree.children[0].props.onClick()
menuTree.children[2].props.onClick()
assert.deepEqual(opened, ['plugins', 'ssh'], '打开的面板 id')
assert.equal(dismissed.length, 2, '每行先关菜单')

/* ---------------- 开关真的能停掉规则 ---------------- */

const cleanup3 = bundle.apply(
  makeCtx({
    inject(services, provider) {
      /* 数组来自 vm realm，原型不同，只能结构化比较。 */
      assert.equal(JSON.stringify(services), '["configForms"]', '注入 configForms')
      provider({
        configForms: {
          get: (ns) => {
            assert.equal(ns, 'dsh-ui-fit', '命名空间等于行 id')
            return {
              getSnapshot: () => ({ value: { nav: false, composer: false, mobile: false } }),
              subscribe: () => () => {},
            }
          },
          describe: () => ({ getSnapshot: () => ({ view: undefined }), subscribe: () => () => {} }),
        },
      })
    },
  }),
)

assert.equal(htmlAttrs.has('data-dsh-fit-nav'), false, '关掉导航：属性摘掉，规则随之失效')
assert.equal(htmlAttrs.has('data-dsh-fit-navmode'), false, '关掉导航：三态属性也摘掉')
assert.equal(htmlAttrs.has('data-dsh-fit-composer'), false, '关掉输入条：属性摘掉')
assert.equal(htmlAttrs.has('data-dsh-fit-tight'), false, '关掉输入条：窄行标记也摘掉')
assert.equal(htmlAttrs.has('data-dsh-fit-mobile'), false, '关掉手机密度：属性摘掉')
assert.equal(htmlAttrs.get('data-dsh-fit'), 'on', '根标记保留（插件还在）')
cleanup3()

/* 直接 id 拿不到（bundle 条目 ns 带前缀）时，用字段指纹从 describe 里认领。 */
let mirrorPush
const discoveredNs = []
const cleanup3b = bundle.apply(
  makeCtx({
    inject(services, provider) {
      provider({
        configForms: {
          get: (ns) => {
            discoveredNs.push(ns)
            if (ns === 'dsh-ui-fit') return { getSnapshot: () => ({ value: undefined }), subscribe: () => () => {} }
            return {
              getSnapshot: () => ({ value: { nav: true, composer: false, mobile: true } }),
              subscribe: () => () => {},
            }
          },
          describe: () => ({
            getSnapshot: () => ({
              view: { namespaces: [{ ns: 'dsh-bundle:dsh-ui-fit', value: { nav: true, composer: false, mobile: true } }] },
            }),
            subscribe: (listener) => {
              mirrorPush = listener
              return () => {}
            },
          }),
        },
      })
    },
  }),
)
assert.ok(discoveredNs.includes('dsh-bundle:dsh-ui-fit'), '按指纹认领到真实命名空间')
assert.equal(htmlAttrs.has('data-dsh-fit-composer'), false, '认领后读到 composer=false')
assert.equal(htmlAttrs.get('data-dsh-fit-nav'), 'on', 'nav 仍为开')
assert.equal(typeof mirrorPush, 'function', '订阅了配置镜像')
cleanup3b()

/* ---------------- 设置页 ---------------- */

const setCalls = []
let settingsSection
const settingsForm = {
  getSnapshot: () => ({ value: { nav: true, composer: true, mobile: true } }),
  subscribe: () => () => {},
  set: (field, value) => {
    setCalls.push([field, value])
    return Promise.resolve(true)
  },
}
const cleanup5 = bundle.apply(
  makeCtx({
    inject(services, provider) {
      provider({
        configForms: {
          get: () => settingsForm,
          describe: () => ({ getSnapshot: () => ({ view: undefined }), subscribe: () => () => {} }),
        },
      })
    },
    slots: {
      inject: (name, provider) => provider(),
      register(spec, Component) {
        if (spec.name === 'settings.section') settingsSection = Component
        return () => {}
      },
    },
  }),
)
assert.equal(typeof settingsSection, 'function', '设置页组件已捕获')

const settingsTree = settingsSection({ t, close: () => {} })
assert.equal(settingsTree.type, 'div')
assert.equal(settingsTree.props.className, 'dsh-fit-settings')
assert.equal(settingsTree.props['data-dsh-fit-settings'], '', '带自己的根标记')
assert.equal(settingsTree.children.length, 7, '标题 + 说明 + 四行开关 + 存储说明')
assert.equal(settingsTree.children[0].type, 'h2')
assert.equal(settingsTree.children[0].children[0], 'L:settings.title', '标题走 locale')
assert.equal(settingsTree.children[1].props.className, 'dsh-fit-settings-desc')
assert.equal(settingsTree.children[6].props.className, 'dsh-fit-settings-note', '存储说明在最后')
/* 第四行是宽度开关，顺序必须与 Config 字段一致，否则开关会串位。 */
const widthRowElement = settingsTree.children[5]
assert.equal(widthRowElement.props.field, 'width', '第四行是宽度开关')
assert.equal(widthRowElement.props.title, 'L:settings.width.title')
assert.equal(widthRowElement.props.description, 'L:settings.width.description')

const navRowElement = settingsTree.children[2]
assert.equal(typeof navRowElement.type, 'function', '行是组件')
const navRow = navRowElement.type(navRowElement.props)
assert.equal(navRow.props.className, 'dsh-fit-srow')
assert.equal(navRow.children[0].props.className, 'dsh-fit-srow-main')
assert.equal(navRow.children[0].children[0].children[0], 'L:settings.nav.title')
assert.equal(navRow.children[0].children[1].children[0], 'L:settings.nav.description')

const navSwitch = navRow.children[1]
assert.equal(navSwitch.type, 'button')
assert.equal(navSwitch.props.className, 'dsh-fit-switch')
assert.equal(navSwitch.props.role, 'switch', '无障碍语义是开关')
assert.equal(navSwitch.props['aria-checked'], 'true', '默认开')
assert.equal(navSwitch.props['data-on'], 'on', '开启态给样式钩子')
assert.equal(navSwitch.props['data-field'], 'nav')
assert.equal(navSwitch.props.disabled, false, '配置已就绪时可点')
assert.equal(navSwitch.props['aria-label'], 'L:settings.nav.title：L:settings.on')
assert.equal(navSwitch.children[0].props.className, 'dsh-fit-switch-knob')

navRowElement.props.onToggle('nav', false)
assert.deepEqual(setCalls, [['nav', false]], '点击写入本插件的配置命名空间')

const offRow = navRowElement.type({ ...navRowElement.props, value: false })
assert.equal(offRow.children[1].props['aria-checked'], 'false')
assert.equal(offRow.children[1].props['data-on'], 'off')
assert.equal(offRow.children[1].props['aria-label'], 'L:settings.nav.title：L:settings.off')
cleanup5()

/* ---------------- 有 primitives 时 ---------------- */

const Icon = (props) => ({ type: 'Icon', props, children: [] })
const primitives = {
  MenuItemButton: (props) => ({ type: 'MenuItemButton', props, children: [props.children] }),
  Tooltip: (props) => ({ type: 'Tooltip', props, children: [props.children] }),
  IconPluginPinwheelOutlineRegular: Icon,
}
const bundle2 = loadedSpec.factory((id) => {
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  if (id === 'react') return React
  throw new Error('MODULE_NOT_FOUND ' + id)
})

let fancyNav
let fancyMenu
const cleanup4 = bundle2.apply(
  makeCtx({
    slots: {
      inject: (name, provider) => provider(),
      register(spec, Component) {
        if (spec.id === 'dsh-ui-fit-nav') fancyNav = Component
        if (spec.name === 'sidebar.panellist.actions') fancyMenu = Component
        return () => {}
      },
    },
  }),
)

const fancyTree = fancyNav({ wide: true, t })
assert.equal(fancyTree.type, primitives.Tooltip, '有 primitives 时套 Tooltip')
assert.equal(fancyTree.children[0].type, 'button')
assert.equal(fancyTree.children[0].props.title, undefined, '有 Tooltip 就不留原生 title')
const fancyGlyph = fancyTree.children[0].children[0].children[0]
assert.equal(fancyGlyph.props.stroke, 'currentColor', '图标继承按钮颜色')
assert.equal(fancyGlyph.children.length, 3, '标准态三行')

const fancyMenuTree = fancyMenu({
  entries: [{ id: 'ssh', label: 'SSH' }],
  onOpen: () => {},
  onDismiss: () => {},
  t: (key) => key,
})
assert.equal(fancyMenuTree.children[0].type, primitives.MenuItemButton, '插件管理行用 MenuItemButton')
assert.equal(fancyMenuTree.children[0].props.icon.type, Icon, '行图标来自 primitives')
assert.equal(fancyMenuTree.children[1].props.current, false, '非当前行不点亮')
cleanup4()

/* ---------------- 清理 ---------------- */

cleanup2()
cleanup()
assert.equal(styles.length, 0, '样式表已移除')
assert.equal(htmlAttrs.has('data-dsh-fit'), false, '根标记已摘')
assert.equal(htmlAttrs.has('data-dsh-fit-nav'), false, '导航标记已摘')
assert.equal(htmlAttrs.has('data-dsh-fit-composer'), false, '输入条标记已摘')
assert.equal(htmlAttrs.has('data-dsh-fit-mobile'), false, '手机密度标记已摘')
assert.equal(htmlAttrs.has('data-dsh-fit-width'), false, '宽度存在性标记已摘')
assert.equal(navAttrs.has('data-dsh-fit-navlist'), false, 'nav 标记已摘')
assert.equal(footAttrs.has('data-dsh-fit-foot'), false, '页脚标记已摘')

console.log('OK dsh-ui-fit client smoke test')
