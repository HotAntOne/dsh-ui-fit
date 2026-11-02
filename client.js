/**
 * `dsh-ui-fit` 的浏览器半边。
 *
 * 一个插件、三段互相独立的样式模块，每段有自己的 `<html>` 门控属性：
 *
 * | 模块 | 开关属性 | 作用 |
 * |---|---|---|
 * | 左栏导航 | `data-dsh-fit-nav` | 三态折叠（标准/紧凑/收纳）、页脚切换按钮、宽度挡位入口 |
 * | 输入条   | `data-dsh-fit-composer` | 藏语音键、徽章改图标、窄行收紧间距并铺满宽度 |
 * | 手机密度 | `data-dsh-fit-mobile` | 窄屏十组压缩规则 |
 *
 * 三段开关来自 Host 半边的 `Config`（`ctx.configForms.get('dsh-ui-fit')`）。关掉某一段时
 * 直接摘掉它的门控属性，**该段的每一条规则随之失效**——不是把按钮藏起来，所以关掉就
 * 真的回到宿主原样。
 *
 * 样式表内部顺序固定为：变量 → 导航 → 输入条 → 手机密度。手机密度在最后，因此窄屏
 * 规则天然压过前两段，与合并前三个插件共存时的层叠结果一致。
 *
 * 硬约束（都是踩过的坑）：
 * - 不 `import` 任何 `@deepseek-ai/*`，primitive 只在模块表真的提供时才用；
 * - 颜色一律走 `--dsw-alias-*` 令牌；
 * - 可见文案走 locale 服务；
 * - 所有监听、观察器、槽位注册都在 `apply` 内创建，并返回清理函数；
 * - 样式表用模板字符串，**注释里不能出现反引号**（会截断模板，运行时 `ReferenceError`，
 *   而 `node --check` 查不出来）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-ui-fit',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    /** locale 命名空间。 */
    const NS = 'ui-fit'
    /** 设置命名空间 = cordis.patch.yml 的行 id。 */
    const SETTINGS_NS = 'dsh-ui-fit'

    /** `<html>` 上的根标记：本插件已加载。 */
    const ATTR_ROOT = 'data-dsh-fit'
    /** 模块开关：左栏导航。 */
    const ATTR_NAV = 'data-dsh-fit-nav'
    /** 导航三态：compact / fold（standard 时摘掉）。 */
    const ATTR_NAVMODE = 'data-dsh-fit-navmode'
    /** 模块开关：输入条。 */
    const ATTR_COMPOSER = 'data-dsh-fit-composer'
    /** 输入条「窄行」实测标记。 */
    const ATTR_TIGHT = 'data-dsh-fit-tight'
    /** 模块开关 + 视口：手机密度。 */
    const ATTR_MOBILE = 'data-dsh-fit-mobile'
    /** 标记全局面板 `<nav>`。 */
    const ATTR_NAVLIST = 'data-dsh-fit-navlist'
    /** 标记页脚那一排动作。 */
    const ATTR_FOOT = 'data-dsh-fit-foot'
    /** 宽度挡位插件是否存在。 */
    const ATTR_WIDTH = 'data-dsh-fit-width'

    /** 页脚按钮类名。 */
    const TRIGGER_CLASS = 'dsh-fit-trigger'
    /** 三态持久化键（每浏览器）。 */
    const MODE_KEY = 'dsh-ui-fit:nav'
    /** 旧插件的键，首次读取时迁移过来。 */
    const LEGACY_MODE_KEY = 'dsh-sidebar-fold:mode'
    /** 三态循环。 */
    const MODES = ['standard', 'compact', 'fold']
    /** 输入条「窄行」阈值：低于它就收紧。 */
    const TIGHT_WIDTH = 560
    /** 输入条行选择器。 */
    const ROW_SELECTOR = '[data-composer-card] > [class*="_row"]'
    /** 手机密度断点。 */
    const MOBILE_QUERY = '(max-width: 899px)'
    /** 宽度挡位插件自己的浮动按钮与菜单。 */
    const WIDTH_TOGGLE_ID = 'dsh-wide-toggle'
    const WIDTH_MENU_ID = 'dsh-width-menu'
    /** 宽度挡位 id 顺序。 */
    const TIER_IDS = ['standard', 'medium', 'wide', 'ultra', 'full', 'custom']
    /** 宽度挡位写在 `<body>` 上的属性。 */
    const TIER_ATTR = 'data-dsh-width'
    /** 调试浮层：地址后加 `#fit-debug` 打开。 */
    const DEBUG_HASH = '#fit-debug'

    /** primitives 可选；拿不到就退回普通元素。 */
    let primitives = {}
    try {
      const loaded = require('@deepseek-ai/dsh-client-ui-primitives')
      if (loaded !== null && typeof loaded === 'object') primitives = loaded
    } catch {
      /* 本构建没有这张表：用朴素元素。 */
    }

    /* ================================================================== */
    /* 样式：变量 → 导航 → 输入条 → 手机密度                               */
    /* ================================================================== */

    const CSS = [
      '/* 三段共用的控件直径：390px → 28px，768px → 31px，1440px → 36px。',
      '   导航图标、输入条按钮都读这一个数，改这里一处即可。 */',
      'html[data-dsh-fit] { --dsh-fit-ctl: clamp(28px, 1.5vw + 20px, 36px); }',

      /* ---------------- ① 左栏导航 ---------------- */
      'html[data-dsh-fit-nav="on"] .dsh-fit-trigger{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;justify-content:center;width:var(--dsh-fit-ctl);height:var(--dsh-fit-ctl);margin:0 2px;padding:0;border:none;background:0 0;border-radius:999px;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-trigger[data-mode="compact"]{color:var(--dsw-alias-label-secondary)}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-trigger[data-mode="fold"]{color:var(--dsw-alias-brand-primary)}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-glyph{display:inline-flex;flex:none;align-items:center;justify-content:center;width:calc(var(--dsh-fit-ctl)*0.5);height:calc(var(--dsh-fit-ctl)*0.5);color:currentColor}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-glyph svg{display:block;width:100%;height:100%}',
      'html[data-dsh-fit-nav="on"] [data-dsh-fit-foot]{align-items:center;gap:2px;flex-wrap:wrap}',
      'html[data-dsh-fit-nav="on"] [data-dsh-fit-foot] .dsh-mobile-control__trigger:not(.is-rail):not(:only-child){flex:0 0 var(--dsh-fit-ctl);width:var(--dsh-fit-ctl);min-width:var(--dsh-fit-ctl);height:var(--dsh-fit-ctl);margin:0 2px;padding:0;gap:0;justify-content:center;border:0;border-radius:999px;background:0 0}',
      'html[data-dsh-fit-nav="on"] [data-dsh-fit-foot] .dsh-mobile-control__trigger-icon{width:calc(var(--dsh-fit-ctl)*0.5);height:calc(var(--dsh-fit-ctl)*0.5)}',
      '/* 宽度挡位插件只渲染进 shell.overlay：藏掉它自己的浮动按钮，改由页脚那颗代理。 */',
      'html[data-dsh-fit-nav="on"] #dsh-wide-toggle{position:fixed;left:-9999px;bottom:0;width:1px;height:1px;min-width:0;padding:0;border:0;opacity:0;pointer-events:none;box-shadow:none}',
      'html[data-dsh-fit-nav="on"] #dsh-wide-toggle::after{display:none}',
      'html[data-dsh-fit-nav="on"] #dsh-width-menu{right:auto;left:12px;bottom:132px;z-index:2147483000;pointer-events:auto}',
      'html[data-dsh-fit-nav="on"][data-dsh-fit-width="off"] .dsh-fit-width{display:none}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-width svg{display:block}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-fallback-row{box-sizing:border-box;display:flex;align-items:center;width:100%;padding:8px 10px;border:none;background:0 0;border-radius:8px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}',
      'html[data-dsh-fit-nav="on"] .dsh-fit-fallback-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      'html[data-dsh-fit-nav="on"][data-dsh-fit-navmode="compact"] nav[data-dsh-fit-navlist]{gap:0;margin-bottom:4px}',
      'html[data-dsh-fit-nav="on"][data-dsh-fit-navmode="compact"] nav[data-dsh-fit-navlist] button{min-height:30px;padding-top:4px;padding-bottom:4px}',
      'html[data-dsh-fit-nav="on"][data-dsh-fit-navmode="fold"] nav[data-dsh-fit-navlist]{margin-bottom:6px}',
      'html[data-dsh-fit-nav="on"][data-dsh-fit-navmode="fold"] nav[data-dsh-fit-navlist] button:not([aria-haspopup="menu"]){display:none}',
      '/* 导航模块关掉时，两颗页脚按钮也一起消失，不留死按钮。 */',
      'html:not([data-dsh-fit-nav="on"]) .dsh-fit-trigger{display:none}',

      /* ---------------- ② 输入条 ---------------- */
      /* 输入条左下角的图标按钮统一按宿主自己的节奏走：宿主「+」与右侧两颗是
         28px 按钮 + 14px 图标，而 PUA / 权限模式原来是 36px（PUA 图标 18px），
         并排看就明显大一截。这里把这两个数抽成变量，一处改齐。 */
      'html[data-dsh-fit-composer="on"] [data-composer-card]{--dsh-fit-btn:28px;--dsh-fit-icon:14px}',
      'html[data-dsh-fit-composer="on"] button[data-better-input-state]{display:none !important}',
      'html[data-dsh-fit-composer="on"] .pua-composer .pua-trigger{width:var(--dsh-fit-btn);height:var(--dsh-fit-btn);min-width:var(--dsh-fit-btn);padding:0;gap:0;justify-content:center;border-radius:999px;font-size:0;line-height:0}',
      'html[data-dsh-fit-composer="on"] .pua-composer .pua-trigger .pua-entry-icon{width:var(--dsh-fit-icon);height:var(--dsh-fit-icon)}',
      'html[data-dsh-fit-composer="on"] .pua-composer .pua-trigger .pua-entry-icon svg{display:block;width:var(--dsh-fit-icon);height:var(--dsh-fit-icon)}',
      'html[data-dsh-fit-composer="on"] div[class*="_modes"] button[class*="_trigger"]:has([class*="_triggerIcon"]){width:var(--dsh-fit-btn);height:var(--dsh-fit-btn);min-width:var(--dsh-fit-btn);padding:0;gap:0;justify-content:center;border-radius:999px}',
      'html[data-dsh-fit-composer="on"] div[class*="_modes"] button[class*="_trigger"]:has([class*="_triggerIcon"]) [class*="_triggerIcon"],',
      'html[data-dsh-fit-composer="on"] div[class*="_modes"] button[class*="_trigger"]:has([class*="_triggerIcon"]) [class*="_triggerIcon"] svg{width:var(--dsh-fit-icon);height:var(--dsh-fit-icon)}',
      'html[data-dsh-fit-composer="on"] div[class*="_modes"] button[class*="_trigger"]:has([class*="_triggerIcon"]) [class*="_triggerLabel"],',
      'html[data-dsh-fit-composer="on"] div[class*="_modes"] button[class*="_trigger"]:has([class*="_triggerIcon"]) [class*="_chevron"]{display:none}',
      'html[data-dsh-fit-composer="on"] div[class*="_modes"] button[class*="_chip"]{width:var(--dsh-fit-btn);height:var(--dsh-fit-btn);min-width:var(--dsh-fit-btn);padding:0;gap:0;justify-content:center;border-radius:999px;font-size:0;line-height:0}',
      'html[data-dsh-fit-composer="on"] div[class*="_modes"] button[class*="_chip"] [class*="_glyph"]{width:var(--dsh-fit-icon);height:var(--dsh-fit-icon)}',
      '/* 宿主把 _trailing 钉成 flex:none，行放不下只能折行；这里允许它让位，',
      '   模型选择器本来就会自己省略号。桌面行宽充裕，永远不会真的收缩。 */',
      'html[data-dsh-fit-composer="on"] [data-composer-card] [class*="_trailing"]:not([class*="_trailingActive"]){flex:0 1 auto;min-width:0}',
      'html[data-dsh-fit-composer="on"] [data-composer-card] [class*="_standardControls"]{min-width:0;overflow:hidden}',
      'html[data-dsh-fit-composer="on"] [data-composer-card] [class*="_standardControls"] [class*="_trigger"]{max-width:132px}',
      '/* 以下只在实测行宽 < 560px 时生效：媒体查询问的是窗口宽，折行只关心这一行多宽，',
      '   手机壳里（56px 轨道、外层内边距、抽屉）两者并不相等。 */',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card] > [class*="_row"]{gap:4px;padding:2px 4px 4px}',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card] [class*="_tools"],',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card] [class*="_modes"],',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card] [class*="_standardControls"],',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card] [class*="_trailing"]{gap:4px}',
      /* 窄行只收紧间距，不改按钮尺寸：桌面与窄屏都用宿主的 28px / 14px 节奏，
         否则同一排里会出现 34px 与 28px 混排。 */
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card]{--dsh-fit-btn:28px;--dsh-fit-icon:14px}',
      '/* better-input 的尺寸写在行内样式里，只能 !important 压。 */',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card] button[data-better-input-state]{width:var(--dsh-fit-btn) !important;height:var(--dsh-fit-btn) !important;min-width:0 !important;min-height:0 !important}',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card] .pua-composer{margin:0}',
      '/* 窄行时铺满宽度：卡片的 max-width 与输入区左右内边距各吃掉十几像素，',
      '   而卡片根节点就是它的直接父级，用 :has() 命中，避开哈希类名。 */',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] div:has(> [data-composer-card]){padding-left:6px !important;padding-right:6px !important}',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-composer-card]{max-width:none !important}',
      '/* dsh-mobile 在 720px 以下把所有输入条按钮抬到 44px 触控下限，',
      '   而 width 打不过 min-width —— 这才是折行的真凶。窄行时解掉它。 */',
      '@media (max-width: 720px){',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-dsh-mobile-composer-row] button:not([role="switch"]):not(:where(dialog *, [popover] *, [role="dialog"] *, [role="menu"] *, [role="listbox"] *, [data-trigger-menu] *)){min-width:0 !important;min-height:0 !important}',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] :is([data-dsh-mobile-composer-tools], [data-dsh-mobile-composer-controls], [data-dsh-mobile-composer-trailing]) :where(span, div, button):not(:where(dialog, [popover], [role="dialog"], [role="menu"], [role="listbox"], [data-trigger-menu])):has(> button:not([role="switch"])){min-width:0 !important;min-height:0 !important}',
      'html[data-dsh-fit-composer="on"][data-dsh-fit-tight="on"] [data-dsh-mobile-composer-trailing] > button[class*="_primary"]{min-width:0 !important}',
      '}',

      /* ---------------- ③ 手机密度（只在窄屏） ---------------- */
      'html[data-dsh-fit-mobile="on"] [data-slot="conversation.chat.turnTail"] details.cm-note{margin-top:0 !important;font-size:11px !important;line-height:14px !important;opacity:0.66}',
      'html[data-dsh-fit-mobile="on"] [data-slot="conversation.chat.turnTail"] details.cm-note > summary{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock]{padding-top:0 !important;gap:6px !important;white-space:nowrap !important;overflow:hidden !important;--dsh-fit-context-shift:1px}',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock] .cm-root,',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock] .cm-btn{font-size:11px !important;line-height:16px !important}',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock] .cm-btn{padding:0 2px !important}',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock] .cm-session-detail{display:none !important}',
      '/* 右侧上下文百分比往下 1px：宿主那颗是「14px 圆环 + 13px 文字」，',
      '   与左侧 12px 的「缓存命中」胶囊不同源，基线差一点。 */',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock] button[class*="_trigger"]{transform:translateY(var(--dsh-fit-context-shift, 1px))}',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock] [data-composer-stat="activity"]{display:none !important}',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock] .cm-btn.cm-stat-entry{display:none !important}',
      'html[data-dsh-fit-mobile="on"] div[data-composer-dock] .cm-root.cm-session-cost{display:none !important}',
      '/* 顶栏：宿主 76px 的下限是手机上最大的固定开销（标题行 32 + 标签 28 就够）。 */',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header]{min-height:0 !important;overflow:hidden !important}',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_headerActions"],',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_headerUtilities"]{gap:2px !important}',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_headerActions"] button,',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_headerUtilities"] button{width:32px;height:32px;min-width:32px}',
      '/* 标题行里挤着子智能体、工作区、后台任务三块，窄屏会互相压住：',
      '   收住收缩权，让它横向滚动，并收掉宿主的推挤边距。 */',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_titleRow"]{min-width:0 !important;flex-wrap:nowrap !important;overflow-x:auto !important;column-gap:4px !important;scrollbar-width:none}',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_titleRow"]::-webkit-scrollbar{display:none}',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_titleRow"] button,',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_headerActions"] button,',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_headerUtilities"] button{flex:0 0 auto !important;white-space:nowrap !important;word-break:keep-all !important}',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_headerUtilities"]{margin-left:6px !important}',
      'html[data-dsh-fit-mobile="on"] header[data-dsh-mobile-header] [class*="_headerCorner"]{margin-left:4px !important;margin-right:-4px !important}',
      '/* 消息操作行：触屏没有 hover 收起的可能，这一行是每条消息的固定开销。 */',
      'html[data-dsh-fit-mobile="on"] [data-turn-tail]{gap:8px !important}',
      'html[data-dsh-fit-mobile="on"] [data-turn-tail] [class*="_actions"]{height:20px !important;gap:2px !important;margin-top:0 !important;margin-left:0 !important}',
      'html[data-dsh-fit-mobile="on"] [data-turn-tail] [class*="_actions"] button{width:22px !important;height:22px !important;min-width:22px !important;padding:2px !important}',
      'html[data-dsh-fit-mobile="on"] [data-turn-tail] [class*="_actions"] svg{width:13px;height:13px}',
      'html[data-dsh-fit-mobile="on"] [data-turn-tail] [class*="_timeStart"]{font-size:11px !important;line-height:18px !important;padding-right:6px !important}',
      '/* 操作行第三颗之后（格式、分享一类）收起；Tooltip 会包一层，',
      '   所以按直接子元素序号，并放过时间戳那一格。 */',
      'html[data-dsh-fit-mobile="on"] [data-turn-tail] [class*="_actions"] > button:nth-child(n + 4){display:none !important}',
      'html[data-dsh-fit-mobile="on"] [data-turn-tail] [class*="_actions"] > :nth-child(n + 4):not([class*="_endInfo"]){display:none !important}',
      '/* 助手状态行：33px 的「已完成，用时 X」与 22px 的「深度求索中」各占一行。 */',
      'html[data-dsh-fit-mobile="on"] button[data-turn-process]{height:24px !important;padding-top:0 !important;padding-bottom:2px !important}',
      'html[data-dsh-fit-mobile="on"] [data-chat-running]{font-size:11px !important;line-height:18px !important}',
      'html[data-dsh-fit-mobile="on"] [data-process-activity]{min-height:28px !important}',
      'html[data-dsh-fit-mobile="on"] .pua-activity-header{min-height:30px !important;padding-top:2px !important;padding-bottom:2px !important}',
      'html[data-dsh-fit-mobile="on"] section[data-turn-trigger]{margin-top:2px !important;margin-bottom:2px !important}',
      'html[data-dsh-fit-mobile="on"] section[data-turn-trigger] > button{min-height:30px !important;padding-top:2px !important;padding-bottom:2px !important}',
      '/* 对话标签栏：10px 上边距 + 每格 9px 下内边距，就是这一整条的高度。 */',
      'html[data-dsh-fit-mobile="on"] div:has(> [data-conversation-tabs][role="tablist"]){margin-top:4px !important;padding-left:4px !important}',
      'html[data-dsh-fit-mobile="on"] [data-conversation-tabs][role="tablist"]{gap:14px !important;flex-wrap:nowrap !important;min-width:0 !important;overflow-x:auto !important;overscroll-behavior-x:contain;scrollbar-width:none}',
      'html[data-dsh-fit-mobile="on"] [data-conversation-tabs][role="tablist"]::-webkit-scrollbar{display:none}',
      'html[data-dsh-fit-mobile="on"] [data-conversation-tabs][role="tablist"] [role="tab"]{min-height:20px !important;padding-bottom:5px !important;font-size:12px !important;flex:0 0 auto !important;white-space:nowrap !important}',

      /* ---------------- ④ 设置页 ---------------- */
      /* 这一段不归任何开关管：设置页本身永远要能打开，否则关掉之后就再也开不回来。 */
      'html[data-dsh-fit] .dsh-fit-settings{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;width:100%;max-width:720px;padding:16px}',
      'html[data-dsh-fit] .dsh-fit-settings h2{margin:0;font-size:16px;line-height:24px;color:var(--dsw-alias-label-primary)}',
      'html[data-dsh-fit] .dsh-fit-settings-desc{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      'html[data-dsh-fit] .dsh-fit-srow{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      'html[data-dsh-fit] .dsh-fit-srow:last-of-type{border-bottom:none}',
      'html[data-dsh-fit] .dsh-fit-srow-main{min-width:0}',
      'html[data-dsh-fit] .dsh-fit-srow-title{display:block;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      'html[data-dsh-fit] .dsh-fit-srow-desc{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      'html[data-dsh-fit] .dsh-fit-switch{position:relative;box-sizing:border-box;flex:none;width:34px;height:20px;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-interactive-bg-active);cursor:pointer;transition:background .15s ease}',
      'html[data-dsh-fit] .dsh-fit-switch[data-on="on"]{background:var(--dsw-alias-brand-primary)}',
      'html[data-dsh-fit] .dsh-fit-switch:disabled{opacity:.5;cursor:default}',
      'html[data-dsh-fit] .dsh-fit-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      'html[data-dsh-fit] .dsh-fit-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease}',
      'html[data-dsh-fit] .dsh-fit-switch[data-on="on"] .dsh-fit-switch-knob{transform:translateX(14px)}',
      'html[data-dsh-fit] .dsh-fit-settings-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      'html[data-dsh-fit] .dsh-fit-settings-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
    ].join('\n')

    /* ================================================================== */
    /* 文案                                                                */
    /* ================================================================== */

    const dictionaries = {
      zh: {
        'nav.standard': '导航：标准',
        'nav.compact': '导航：紧凑',
        'nav.fold': '导航：收纳',
        'nav.aria': '切换左栏导航布局',
        'nav.hint': '点击切换：标准（原样）→ 紧凑（每行更矮）→ 收纳（全部收进「更多」）',
        'menu.plugins': '插件管理',
        'menu.group': '全局面板',
        'width.aria': '对话区宽度',
        'width.hint': '选择对话区宽度挡位',
        'width.standard': '标准',
        'width.medium': '中',
        'width.wide': '宽',
        'width.ultra': '超宽',
        'width.full': '满宽',
        'width.custom': '自定义',
        'settings.title': '界面精简',
        'settings.description': '三块样式各管一处，关掉哪一块就立刻回到宿主原样，不用重启。',
        'settings.nav.title': '左栏导航折叠',
        'settings.nav.description':
          '在侧栏页脚加一颗三态按钮：标准 → 紧凑 → 收纳。收纳后所有面板行都进「更多」，仍然可达。',
        'settings.composer.title': '输入条精简',
        'settings.composer.description':
          '隐藏语音键、把徽章换成图标；行宽不足 560px 时收紧间距，让内容铺满整行。',
        'settings.mobile.title': '手机端密度压缩',
        'settings.mobile.description':
          '只在视口 ≤ 899px 时生效：压缩对话标签栏、操作行与状态行的高度，桌面上完全不动。',
        'settings.storage':
          '默认全部开启。开关写在本机 profile 的 dsh-ui-fit 配置段；导航三态另存在浏览器 localStorage 的 dsh-ui-fit:nav。',
        'settings.failed': '写入失败，这一项没有生效，请重试。',
        'settings.unavailable': '配置服务还没就绪，稍等片刻再试。',
        'settings.on': '已开启',
        'settings.off': '已关闭',
      },
      en: {
        'nav.standard': 'Navigation: standard',
        'nav.compact': 'Navigation: compact',
        'nav.fold': 'Navigation: folded',
        'nav.aria': 'Change the left navigation layout',
        'nav.hint': 'Click to cycle: standard → compact (shorter rows) → folded (everything inside More)',
        'menu.plugins': 'Plugin manager',
        'menu.group': 'Global panels',
        'width.aria': 'Conversation width',
        'width.hint': 'Pick a conversation width tier',
        'width.standard': 'standard',
        'width.medium': 'medium',
        'width.wide': 'wide',
        'width.ultra': 'ultra',
        'width.full': 'full',
        'width.custom': 'custom',
        'settings.title': 'UI Fit',
        'settings.description':
          'Three independent style modules. Turning one off restores the stock UI immediately, no restart.',
        'settings.nav.title': 'Collapsible left navigation',
        'settings.nav.description':
          'Adds a three-state footer button: standard → compact → folded. Folded rows stay reachable inside More.',
        'settings.composer.title': 'Compact composer',
        'settings.composer.description':
          'Hides the voice button, swaps badges for icons, and tightens spacing below 560px of row width.',
        'settings.mobile.title': 'Mobile density',
        'settings.mobile.description':
          'Only applies at viewport ≤ 899px: compresses tabs, action rows and status rows. Desktop is untouched.',
        'settings.storage':
          'All on by default. Switches live in this profile dsh-ui-fit config; the navigation state also lives in localStorage key dsh-ui-fit:nav.',
        'settings.failed': 'Write failed; that change did not apply. Try again.',
        'settings.unavailable': 'The config service is not ready yet. Try again in a moment.',
        'settings.on': 'on',
        'settings.off': 'off',
      },
    }

    /* ================================================================== */
    /* 状态：三个开关 + 导航三态 + 窄行标记                                 */
    /* ================================================================== */

    /** 三个模块开关；Host 配置还没到时先全开，与合并前一致。 */
    const flags = { nav: true, composer: true, mobile: true }

    /** 配置是否已经认领到（设置页据此显示可用状态）。 */
    let flagsReady = false

    /** 设置页订阅用的监听器集合。 */
    const flagListeners = new Set()

    /** 通知所有挂载的设置页。 */
    function notifyFlags() {
      for (const listener of Array.from(flagListeners)) {
        try {
          listener()
        } catch {
          /* 一个坏订阅者不能拖住其它人。 */
        }
      }
    }

    /** 订阅三个开关；设置页用它重绘。 */
    function useFlags() {
      const [value, setValue] = useState(0)
      useEffect(() => {
        const listener = () => setValue((tick) => tick + 1)
        flagListeners.add(listener)
        return () => {
          flagListeners.delete(listener)
        }
      }, [])
      return { nav: flags.nav, composer: flags.composer, mobile: flags.mobile, ready: flagsReady, tick: value }
    }

    /**
     * 写一个开关。真正的写入由 `apply` 里装上的 `flagWriter` 完成——它拿得到
     * ConfigFormController 与 `settle`，这里只保留一个可替换的默认实现。
     */
    let flagWriter = () => Promise.resolve(false)

    /** 读三态，并把旧插件的键迁移过来。 */
    function readMode() {
      try {
        const raw = localStorage.getItem(MODE_KEY)
        if (MODES.includes(raw)) return raw
        const legacy = localStorage.getItem(LEGACY_MODE_KEY)
        if (MODES.includes(legacy)) {
          localStorage.setItem(MODE_KEY, legacy)
          return legacy
        }
        return 'standard'
      } catch {
        return 'standard'
      }
    }

    let mode = readMode()
    /** @type {Set<() => void>} */
    const modeListeners = new Set()

    /** 把三个开关与三态写到 `<html>` 上，CSS 据此生效或失效。 */
    function paint() {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      root.setAttribute(ATTR_ROOT, 'on')
      if (flags.nav) root.setAttribute(ATTR_NAV, 'on')
      else root.removeAttribute(ATTR_NAV)
      if (flags.nav && mode !== 'standard') root.setAttribute(ATTR_NAVMODE, mode)
      else root.removeAttribute(ATTR_NAVMODE)
      if (flags.composer) root.setAttribute(ATTR_COMPOSER, 'on')
      else {
        root.removeAttribute(ATTR_COMPOSER)
        root.removeAttribute(ATTR_TIGHT)
      }
    }

    /** 切换三态，持久化并通知所有挂载的控件。 */
    function setMode(next) {
      const value = MODES.includes(next) ? next : 'standard'
      if (value === mode) return
      mode = value
      try {
        localStorage.setItem(MODE_KEY, value)
      } catch {
        /* 隐私模式：本次页面生命周期内仍然生效。 */
      }
      paint()
      for (const listener of [...modeListeners]) {
        try {
          listener()
        } catch {
          /* 一个坏订阅者不能拖住其它人。 */
        }
      }
    }

    /** 订阅三态。 */
    function useMode() {
      const [value, setValue] = useState(mode)
      useEffect(() => {
        const listener = () => setValue(mode)
        modeListeners.add(listener)
        return () => {
          modeListeners.delete(listener)
        }
      }, [])
      return value
    }

    /** 读宽度挡位插件写在 `<body>` 上的当前挡位。 */
    function readTier() {
      if (typeof document === 'undefined' || document.body === null) return 'standard'
      const value = document.body.getAttribute(TIER_ATTR)
      return TIER_IDS.indexOf(value) === -1 ? 'standard' : value
    }

    let tier = readTier()
    /** @type {Set<() => void>} */
    const tierListeners = new Set()

    /** 把最新挡位广播给挂载的控件。 */
    function publishTier() {
      const next = readTier()
      if (next === tier) return
      tier = next
      for (const listener of Array.from(tierListeners)) {
        try {
          listener()
        } catch {
          /* 同上。 */
        }
      }
    }

    /** 订阅挡位。 */
    function useTier() {
      const [value, setValue] = useState(tier)
      useEffect(() => {
        const listener = () => setValue(tier)
        tierListeners.add(listener)
        return () => {
          tierListeners.delete(listener)
        }
      }, [])
      return value
    }

    /* ================================================================== */
    /* DOM 标记                                                            */
    /* ================================================================== */

    /**
     * 标记全局面板 `<nav>`：类名里仍带 `panelList` 局部名，且含宿主「更多」那一行。
     * 两个条件都要满足，免得把别的导航区块（设置面板等）一起收进去。
     */
    function tagNav() {
      if (typeof document === 'undefined') return
      for (const nav of document.querySelectorAll('nav')) {
        if (nav.hasAttribute(ATTR_NAVLIST)) continue
        const className = typeof nav.className === 'string' ? nav.className : ''
        if (!/(?:^|_)panelList(?:_|$)/.test(className)) continue
        if (nav.querySelector('button[aria-haspopup="menu"]') === null) continue
        nav.setAttribute(ATTR_NAVLIST, '')
      }
    }

    /** 标记页脚那一排动作，让 CSS 把邻居拉齐到同一套图标节奏。 */
    function tagFoot() {
      if (typeof document === 'undefined') return
      const rows = []
      const trigger = document.querySelector('.' + TRIGGER_CLASS)
      if (trigger !== null && trigger.parentElement !== null) rows.push(trigger.parentElement)
      const mobile = document.querySelector('.dsh-mobile-control__trigger')
      if (mobile !== null && mobile.parentElement !== null) rows.push(mobile.parentElement)
      for (const row of rows) {
        if (row.hasAttribute(ATTR_FOOT)) continue
        row.setAttribute(ATTR_FOOT, '')
      }
    }

    /** 宽度挡位插件在不在；不在就把页脚那颗入口藏掉，不留死按钮。 */
    function syncWidthPresence() {
      if (typeof document === 'undefined') return
      const present = document.getElementById(WIDTH_TOGGLE_ID) !== null
      document.documentElement.setAttribute(ATTR_WIDTH, present ? 'on' : 'off')
    }

    /* ================================================================== */
    /* 图形                                                                */
    /* ================================================================== */

    /** primitives 里的图标，拿不到就退回文字替身。 */
    function glyph(name, fallback, size) {
      const Icon = primitives[name]
      if (typeof Icon === 'function') return h(Icon, { size })
      return h('span', { 'aria-hidden': 'true' }, fallback)
    }

    /** 「更多」菜单里的一行。 */
    function menuRow(key, label, onSelect, options) {
      const { active, iconName, iconText, separatorBefore } = options || {}
      const MenuItemButton = primitives.MenuItemButton
      if (typeof MenuItemButton !== 'function') {
        return h('button', { key, type: 'button', className: 'dsh-fit-fallback-row', onClick: onSelect }, label)
      }
      const icon = iconName === undefined ? undefined : glyph(iconName, iconText || '', 16)
      return h(
        MenuItemButton,
        { key, current: active === true, separatorBefore: separatorBefore === true, icon, onSelect },
        label,
      )
    }

    /**
     * 折叠按钮的图标：它控制的那几行的缩影——标准三行、紧凑三行更近、
     * 收纳一行加一个尖角。自绘是因为宿主的图标表里没有「导航行」这个语义。
     */
    function navGlyph(value) {
      const rows = value === 'compact' ? [5.6, 8, 10.4] : value === 'fold' ? [8] : [4.4, 8, 11.6]
      const children = rows.map((y) => h('path', { key: 'row-' + y, d: 'M2.8 ' + y + 'H13.2' }))
      if (value === 'fold') children.push(h('path', { key: 'caret', d: 'M6.4 4.6L8 3L9.6 4.6' }))
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        children,
      )
    }

    /** 宽度挡位的图标：六根渐长的横条，当前挡位之前点亮。 */
    function tierGlyph(value) {
      const active = TIER_IDS.indexOf(value)
      const widths = [3.5, 5.3, 7.1, 8.9, 10.7, 12.5]
      const bars = widths.map((width, bar) =>
        h('rect', {
          key: 'bar-' + bar,
          x: 1.5,
          y: 0.75 + bar * 2.55,
          width,
          height: 1.6,
          rx: 0.8,
          fill: 'currentColor',
          opacity: bar <= active ? 1 : 0.3,
        }),
      )
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        bars,
      )
    }

    /* ================================================================== */
    /* 控件                                                                */
    /* ================================================================== */

    /**
     * 转发一次点击给宽度挡位插件自己的触发器。
     *
     * 它用 document 级 click 监听关菜单，而那个监听要等点击冒泡到底才跑。同步转发会让
     * 菜单在同一次手势里「开了又被当成点了外面」立刻关掉，观感就是什么都没发生。延后
     * 一个任务，让这次点击先走完；延后那次点击的 target 是它自己的 trigger，算内部。
     */
    function openWidthMenu() {
      if (typeof document === 'undefined') return
      const menu = document.getElementById(WIDTH_MENU_ID)
      if (menu !== null && !menu.hasAttribute('hidden')) return
      const toggle = document.getElementById(WIDTH_TOGGLE_ID)
      if (toggle === null) return
      const defer = typeof setTimeout === 'function' ? setTimeout : (run) => run()
      defer(() => {
        if (typeof toggle.click === 'function') toggle.click()
      }, 0)
    }

    /** 页脚：三态循环按钮。 */
    function NavTrigger(props) {
      const { t } = props
      const current = useMode()
      const next = MODES[(MODES.indexOf(current) + 1) % MODES.length]
      const hint = t('nav.hint')
      const Tooltip = primitives.Tooltip
      const withTooltip = typeof Tooltip === 'function'
      const button = h(
        'button',
        {
          type: 'button',
          className: 'dsh-fit-trigger',
          'data-mode': current,
          'aria-label': t('nav.aria') + ': ' + t('nav.' + current),
          title: withTooltip ? undefined : hint,
          onClick: () => setMode(next),
        },
        h('span', { className: 'dsh-fit-glyph' }, navGlyph(current)),
      )
      return withTooltip ? h(Tooltip, { label: hint, side: 'top', delayMs: 400 }, button) : button
    }

    /** 页脚：对话宽度挡位入口（宽度挡位插件只渲染进 shell.overlay，放不进这一排）。 */
    function WidthTrigger(props) {
      const { t } = props
      const value = useTier()
      const hint = t('width.hint')
      const Tooltip = primitives.Tooltip
      const withTooltip = typeof Tooltip === 'function'
      const button = h(
        'button',
        {
          type: 'button',
          className: 'dsh-fit-trigger dsh-fit-width',
          'data-tier': value,
          'aria-label': t('width.aria') + ': ' + t('width.' + value),
          title: withTooltip ? undefined : hint,
          onClick: openWidthMenu,
        },
        h('span', { className: 'dsh-fit-glyph' }, tierGlyph(value)),
      )
      return withTooltip ? h(Tooltip, { label: hint, side: 'top', delayMs: 400 }, button) : button
    }

    /** 「更多」菜单内容：插件管理 + 所有被收起来的面板行，保证收纳后仍然可达。 */
    function PanelMenuContent(props) {
      const { entries, onOpen, onDismiss, t } = props
      const rows = []
      const open = (id) => {
        onDismiss()
        onOpen(id)
      }
      rows.push(
        menuRow('dsh-fit-plugins', t('menu.plugins'), () => open('plugins'), {
          iconName: 'IconPluginPinwheelOutlineRegular',
          iconText: '\u25C8',
        }),
      )
      for (const entry of Array.isArray(entries) ? entries : []) {
        rows.push(
          menuRow('dsh-fit-' + entry.id, entry.label, () => open(entry.id), { active: entry.active === true }),
        )
      }
      return h(React.Fragment, null, rows)
    }

    /* ================================================================== */
    /* 设置页                                                              */
    /* ================================================================== */

    /** 一行开关：标题可点（label 包住 input 太啰嗦，直接给按钮挂 aria-label）。 */
    function SettingRow(props) {
      const { title, description, field, value, disabled, onToggle, t } = props
      const state = value ? 'on' : 'off'
      return h(
        'div',
        { className: 'dsh-fit-srow' },
        h(
          'div',
          { className: 'dsh-fit-srow-main' },
          h('span', { className: 'dsh-fit-srow-title' }, title),
          h('div', { className: 'dsh-fit-srow-desc' }, description),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-fit-switch',
            'data-on': state,
            'data-field': field,
            role: 'switch',
            'aria-checked': value ? 'true' : 'false',
            'aria-label': title + '：' + (value ? t('settings.on') : t('settings.off')),
            disabled: disabled === true,
            onClick: () => onToggle(field, !value),
          },
          h('span', { className: 'dsh-fit-switch-knob' }),
        ),
      )
    }

    /**
     * 「界面精简」设置页。
     *
     * 宿主不会按 Config schema 自动生成页面（`@deepseek-ai/dsh-settings` 的 README 明写
     * 目前没有自带客户端这么做），所以必须自己注册 `settings.section`。三个开关直接写
     * 本插件的配置命名空间，写成功后 Host 广播、`sync` 重新 paint，页面与样式同步变化。
     */
    function SettingsSection(props) {
      const { t } = props
      const current = useFlags()
      const [busy, setBusy] = useState(null)
      const [failed, setFailed] = useState(null)
      const rows = [
        { field: 'nav', title: t('settings.nav.title'), description: t('settings.nav.description') },
        { field: 'composer', title: t('settings.composer.title'), description: t('settings.composer.description') },
        { field: 'mobile', title: t('settings.mobile.title'), description: t('settings.mobile.description') },
      ]
      const toggle = (field, next) => {
        setFailed(null)
        setBusy(field)
        Promise.resolve(flagWriter(field, next))
          .then((ok) => {
            if (ok !== true) setFailed(field)
          })
          .catch(() => setFailed(field))
          .then(() => setBusy(null))
      }
      const children = [
        h('h2', { key: 'title' }, t('settings.title')),
        h('p', { key: 'desc', className: 'dsh-fit-settings-desc' }, t('settings.description')),
      ]
      for (const row of rows) {
        children.push(
          h(SettingRow, {
            key: row.field,
            field: row.field,
            title: row.title,
            description: row.description,
            value: current[row.field] === true,
            disabled: busy !== null || !current.ready,
            onToggle: toggle,
            t,
          }),
        )
      }
      if (failed !== null) children.push(h('p', { key: 'failed', className: 'dsh-fit-settings-error' }, t('settings.failed')))
      children.push(h('p', { key: 'note', className: 'dsh-fit-settings-note' }, t('settings.storage')))
      return h('div', { className: 'dsh-fit-settings', 'data-dsh-fit-settings': '' }, children)
    }

    /* ================================================================== */
    /* 插件主体                                                            */
    /* ================================================================== */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const disposers = []
        const push = (dispose) => {
          if (typeof dispose === 'function') disposers.push(dispose)
        }

        paint()

        /* 样式表：只有一张，三段规则都在里面，靠 `<html>` 属性分段生效。 */
        push(
          ctx.effect(() => {
            const tag = document.createElement('style')
            tag.dataset.plugin = 'dsh-ui-fit'
            tag.textContent = CSS
            document.head.appendChild(tag)
            return () => tag.remove()
          }, 'ui-fit: styles'),
        )

        push(ctx.effect(() => ctx.locale.register(NS, dictionaries), 'ui-fit: dictionaries'))

        /* ---------- 手机密度：视口门控 ---------- */
        const media = typeof matchMedia === 'function' ? matchMedia(MOBILE_QUERY) : null
        const paintMobile = () => {
          if (typeof document === 'undefined') return
          const root = document.documentElement
          const on = flags.mobile && media !== null && media.matches
          if (on) root.setAttribute(ATTR_MOBILE, 'on')
          else root.removeAttribute(ATTR_MOBILE)
        }
        paintMobile()
        if (media !== null && typeof media.addEventListener === 'function') {
          media.addEventListener('change', paintMobile)
          push(() => media.removeEventListener('change', paintMobile))
        }

        /* ---------- 输入条：实测行宽 ---------- */
        const findRow = () =>
          typeof document.querySelector === 'function' ? document.querySelector(ROW_SELECTOR) : null

        let frame = null
        let seen = null
        let rowObserver = null

        const paintDebug = () => {
          const on = typeof location !== 'undefined' && location.hash === DEBUG_HASH
          if (!on) return
          let box =
            typeof document.getElementById === 'function' ? document.getElementById('dsh-fit-debug') : null
          if (box === null && document.body) {
            box = document.createElement('div')
            box.id = 'dsh-fit-debug'
            box.style.cssText =
              'position:fixed;left:4px;right:4px;bottom:4px;z-index:2147483647;padding:6px 8px;' +
              'border-radius:8px;background:#000000cc;color:#fff;font:11px/1.45 monospace;' +
              'white-space:pre-wrap;pointer-events:none'
            document.body.appendChild(box)
          }
          if (box === null) return
          const row = findRow()
          const lines = [
            'innerWidth ' + String(window.innerWidth),
            'row ' + String(row === null ? '-' : row.clientWidth),
            'tight ' + String(row !== null && row.clientWidth > 0 && row.clientWidth < TIGHT_WIDTH),
            'nav ' + mode + ' / composer ' + String(flags.composer) + ' / mobile ' + String(flags.mobile),
          ]
          if (row !== null && row.children) {
            for (const child of Array.from(row.children)) {
              const className = typeof child.className === 'string' ? child.className : ''
              lines.push(
                '  ' +
                  className.slice(0, 34) +
                  ' w' +
                  String(Math.round(child.getBoundingClientRect().width)) +
                  ' h' +
                  String(Math.round(child.getBoundingClientRect().height)) +
                  ' top' +
                  String(Math.round(child.getBoundingClientRect().top)),
              )
            }
          }
          box.textContent = lines.join('\n')
        }

        const settle = () => {
          if (typeof document === 'undefined') return
          const root = document.documentElement
          const row = findRow()
          if (row !== seen) {
            seen = row
            if (rowObserver !== null) rowObserver.disconnect()
            rowObserver = null
            if (row !== null && typeof ResizeObserver === 'function') {
              rowObserver = new ResizeObserver(() => schedule())
              rowObserver.observe(row)
            }
          }
          if (row === null || row.clientWidth === 0) {
            paintDebug()
            return
          }
          const tight = row.clientWidth < TIGHT_WIDTH
          if (tight && flags.composer) root.setAttribute(ATTR_TIGHT, 'on')
          else root.removeAttribute(ATTR_TIGHT)
          paintDebug()
        }

        const schedule = () => {
          if (typeof requestAnimationFrame !== 'function') {
            settle()
            return
          }
          if (frame !== null) return
          frame = requestAnimationFrame(() => {
            frame = null
            settle()
          })
        }

        settle()
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('resize', schedule)
          push(() => window.removeEventListener('resize', schedule))
        }
        push(() => {
          if (rowObserver !== null) rowObserver.disconnect()
          if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        })

        /* ---------- 开关：从 Host 配置读，缺失时全开 ---------- */
        if (typeof ctx.inject === 'function') {
          ctx.inject(['configForms'], (scope) => {
            const forms = scope.configForms
            /**
             * 认领本插件的配置条目。
             *
             * 命名空间一般等于 `cordis.patch.yml` 的行 id（`dsh-ui-fit`），但 bundle
             * 条目的真实 ns 可能带前缀。所以先按 id 取，取不到就扫一遍已服务的命名
             * 空间，用本插件 Config 独有的字段指纹认领——两者都不中时保持默认全开。
             */
            const isOurs = (value) =>
              value !== null &&
              typeof value === 'object' &&
              ('composer' in value || 'mobile' in value || 'nav' in value)

            let bound = null
            let boundNs = null
            const bind = () => {
              const direct = forms.get(SETTINGS_NS)
              if (direct !== null && direct !== undefined) {
                const snapshot = direct.getSnapshot()
                if (snapshot !== undefined && snapshot.value !== undefined) {
                  if (bound !== direct) {
                    bound = direct
                    boundNs = SETTINGS_NS
                    bound.subscribe(sync)
                  }
                  return bound
                }
              }
              let view
              try {
                view = forms.describe().getSnapshot().view
              } catch {
                view = undefined
              }
              for (const namespace of view?.namespaces ?? []) {
                if (!isOurs(namespace.value)) continue
                if (namespace.ns === boundNs) return bound
                const form = forms.get(namespace.ns)
                if (form === null || form === undefined) continue
                bound = form
                boundNs = namespace.ns
                bound.subscribe(sync)
                return bound
              }
              return null
            }

            function sync() {
              const form = bound
              if (form === null) return
              const snapshot = form.getSnapshot()
              if (snapshot === undefined || snapshot.value === undefined) return
              const value = snapshot.value
              flags.nav = value.nav !== false
              flags.composer = value.composer !== false
              flags.mobile = value.mobile !== false
              flagsReady = true
              paint()
              paintMobile()
              /* 输入条开关会改变 tight 的允许条件，立刻重测一次。 */
              settle()
              notifyFlags()
            }

            /*
             * 设置页的写入：走同一个 controller 的 mutate，写的是本插件自己的命名空间。
             * 写成功后 Host 会推新快照，sync 负责把样式与页面一起刷新；失败时返回 false，
             * 由页面显示错误、不擅自改本地 flags（避免「界面变了但配置没落」的假象）。
             */
            flagWriter = (field, next) => {
              const form = bound
              if (form === null) return Promise.resolve(false)
              if (typeof form.set !== 'function') return Promise.resolve(false)
              return Promise.resolve(form.set(field, next === true)).catch(() => false)
            }

            bind()
            sync()
            /* 配置是异步到达的：镜像一变就重新认领一次。 */
            try {
              forms.describe().subscribe(() => {
                bind()
                sync()
              })
            } catch {
              /* 没有镜像就只读一次默认值。 */
            }
          })
        }

        /* ---------- 标记：导航行 / 页脚 / 宽度挡位存在性 ---------- */
        tagNav()
        tagFoot()
        syncWidthPresence()
        let tagFrame = 0
        const observer = new MutationObserver(() => {
          if (tagFrame !== 0) return
          tagFrame = requestAnimationFrame(() => {
            tagFrame = 0
            if (document.querySelector('nav[' + ATTR_NAVLIST + ']') === null) tagNav()
            if (document.querySelector('[' + ATTR_FOOT + ']') === null) tagFoot()
            syncWidthPresence()
            if (findRow() !== seen) schedule()
          })
        })
        observer.observe(document.documentElement, { childList: true, subtree: true })
        push(() => {
          observer.disconnect()
          if (tagFrame !== 0) cancelAnimationFrame(tagFrame)
        })

        if (typeof document !== 'undefined' && document.body !== null) {
          const tierObserver = new MutationObserver(() => publishTier())
          tierObserver.observe(document.body, { attributes: true, attributeFilter: [TIER_ATTR] })
          push(() => tierObserver.disconnect())
        }

        /* ---------- 槽位 ---------- */
        push(
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'dsh-ui-fit-nav', order: 50, locale: NS },
              NavTrigger,
            ),
          ),
        )

        push(
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'dsh-ui-fit-width', order: 51, locale: NS },
              WidthTrigger,
            ),
          ),
        )

        push(
          ctx.slots.inject('sidebar.panellist.actions', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist.actions', id: 'dsh-ui-fit-panels', order: 10, locale: NS },
              PanelMenuContent,
            ),
          ),
        )

        /* 设置页：宿主不按 schema 自动生成页面，必须自己注册一节。 */
        push(
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'dsh-ui-fit',
                order: 18,
                label: () => ctx.locale.bind(NS)('settings.title'),
                locale: NS,
              },
              SettingsSection,
            ),
          ),
        )

        return () => {
          for (const dispose of disposers.splice(0).reverse()) {
            try {
              dispose()
            } catch {
              /* 一个清理失败不能拖住其它清理。 */
            }
          }
          if (typeof document !== 'undefined') {
            const root = document.documentElement
            root.removeAttribute(ATTR_ROOT)
            root.removeAttribute(ATTR_NAV)
            root.removeAttribute(ATTR_NAVMODE)
            root.removeAttribute(ATTR_COMPOSER)
            root.removeAttribute(ATTR_TIGHT)
            root.removeAttribute(ATTR_MOBILE)
            root.removeAttribute(ATTR_WIDTH)
            for (const nav of document.querySelectorAll('[' + ATTR_NAVLIST + ']')) nav.removeAttribute(ATTR_NAVLIST)
            for (const foot of document.querySelectorAll('[' + ATTR_FOOT + ']')) foot.removeAttribute(ATTR_FOOT)
            const box = document.getElementById('dsh-fit-debug')
            if (box !== null) box.remove()
          }
        }
      },
    }
  },
})
