/**
 * `dsh-ui-fit` 的浏览器半边。
 *
 * 一个插件、三段互相独立的样式模块，每段有自己的 `<html>` 门控属性：
 *
 * | 模块 | 开关属性 | 作用 |
 * |---|---|---|
 * | 左栏导航 | `data-dsh-fit-nav` | 三态折叠（标准/紧凑/收纳）、页脚切换按钮 |
 * | 输入条   | `data-dsh-fit-composer` | 藏语音键、徽章改图标、窄行收紧间距并铺满宽度 |
 * | 手机密度 | `data-dsh-fit-mobile` | 窄屏十组压缩规则 |
 * | 对话宽度 | `data-dsh-fit-width` | 六档内容宽度 + 拖拽读数；自实现，不依赖第三方插件 |
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
    /**
     * 面板导航的槽位锚点。`data-slot` 由渲染器写死，是宿主公开契约；
     * 类名（`wtg9ga_panelList`）是构建哈希，宿主改版就变，只作兜底。
     */
    const NAV_SLOT_SELECTOR = '[data-slot="sidebar.panellist"]'
    /** 标记页脚那一排动作。 */
    const ATTR_FOOT = 'data-dsh-fit-foot'
    /** 页脚动作排的槽位锚点（宿主契约，改版不动）。 */
    const FOOT_SLOT_SELECTOR = '[data-slot="sidebar.footer.action"]'
    /** 宽度挡位插件是否存在。 */
    const ATTR_WIDTH = 'data-dsh-fit-width'

    /** 页脚按钮类名。 */
    const TRIGGER_CLASS = 'dsh-fit-trigger'
    /** 三态持久化键（每浏览器）。 */
    const MODE_KEY = 'dsh-ui-fit:nav'
    /** 三态循环。 */
    const MODES = ['standard', 'compact', 'fold']
    /** 输入条「窄行」阈值：低于它就收紧。 */
    const TIGHT_WIDTH = 560
    /** 输入条行选择器。 */
    const ROW_SELECTOR = '[data-composer-card] > [class*="_row"]'
    /** 手机密度断点。 */
    const MOBILE_QUERY = '(max-width: 899px)'
    /* ---------------- 自实现宽度轴 ---------------- */

    /** 宽度挡位 id 顺序。 */
    const TIER_IDS = ['standard', 'medium', 'wide', 'ultra', 'full', 'custom']

    /** 六档持久化键（每浏览器）。 */
    const WIDTH_KEY = 'dsh-ui-fit:width'
    /** 自定义档记住的像素值。 */
    const WIDTH_CUSTOM_KEY = 'dsh-ui-fit:widthCustom'
    /** 宿主自己的宽度偏好键：写它，宿主的拖拽手柄与重排都跟着走。 */
    const APP_WIDTH_KEY = 'dsh.conversation.contentWidth'
    /** 固定档的目标宽度。 */
    const NOMINAL_WIDTH_PX = { medium: 1120, wide: 1280, ultra: 1400 }
    /** 宿主的内容宽度下限，与 `resolveContentWidth` 保持一致。 */
    const CONTENT_MIN = 640
    /** 两侧拖拽手柄与安全边距占掉的横向空间。 */
    const CONTENT_EDGE_BUDGET = 176
    /** 宿主发布 `--dsh-chat-content-width` 的那个元素。 */
    const WIDTH_ROOT_SELECTOR = '[data-conversation-content]'
    /** 侧栏里的会话副本不算主对话区。 */
    const WIDTH_SIDEBAR_SELECTOR = '[data-sidebar-chat]'
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

      /* ---------------- ① 左栏导航 + 对话宽度（共用页脚按钮样式） ---------------- */
      /* 两颗页脚按钮的公共外形挂根标记，不挂 nav 门控：关掉导航时宽度按钮还要在。 */
      'html[data-dsh-fit] .dsh-fit-trigger{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;justify-content:center;width:var(--dsh-fit-ctl);height:var(--dsh-fit-ctl);margin:0 2px;padding:0;border:none;background:0 0;border-radius:999px;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      'html[data-dsh-fit] .dsh-fit-trigger[data-mode="compact"]{color:var(--dsw-alias-label-secondary)}',
      'html[data-dsh-fit] .dsh-fit-trigger[data-mode="fold"]{color:var(--dsw-alias-brand-primary)}',
      'html[data-dsh-fit] .dsh-fit-trigger[data-tier]:not([data-tier="standard"]){color:var(--dsw-alias-brand-primary)}',
      'html[data-dsh-fit] .dsh-fit-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      'html[data-dsh-fit] .dsh-fit-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      'html[data-dsh-fit] .dsh-fit-glyph{display:inline-flex;flex:none;align-items:center;justify-content:center;width:calc(var(--dsh-fit-ctl)*0.5);height:calc(var(--dsh-fit-ctl)*0.5);color:currentColor}',
      'html[data-dsh-fit] .dsh-fit-glyph svg{display:block;width:100%;height:100%}',
      'html[data-dsh-fit] [data-dsh-fit-foot]{align-items:center;gap:2px;flex-wrap:wrap}',
      'html[data-dsh-fit] [data-dsh-fit-foot] .dsh-mobile-control__trigger:not(.is-rail):not(:only-child){flex:0 0 var(--dsh-fit-ctl);width:var(--dsh-fit-ctl);min-width:var(--dsh-fit-ctl);height:var(--dsh-fit-ctl);margin:0 2px;padding:0;gap:0;justify-content:center;border:0;border-radius:999px;background:0 0}',
      'html[data-dsh-fit] [data-dsh-fit-foot] .dsh-mobile-control__trigger-icon{width:calc(var(--dsh-fit-ctl)*0.5);height:calc(var(--dsh-fit-ctl)*0.5)}',
      /*
       * 与第三方宽度插件共存时的收尾：它的浮动按钮在右下角，本插件的入口在页脚，
       * 两个按钮控制同一个宽度轴会互相打脸。这里把它的按钮压成不可见不可点，
       * 只留本插件那一个入口。卸载它之后这几条规则自然失效，无需改动。
       */
      'html[data-dsh-fit] #dsh-wide-toggle{position:fixed;left:-9999px;bottom:0;width:1px;height:1px;min-width:0;padding:0;border:0;opacity:0;pointer-events:none;box-shadow:none}',
      'html[data-dsh-fit] #dsh-wide-toggle::after{display:none}',
      'html[data-dsh-fit] #dsh-width-menu{display:none}',
      /* 自己实现的挡位菜单：定在侧栏页脚正上方，和页脚按钮同侧。 */
      'html[data-dsh-fit] .dsh-fit-width-menu{position:fixed;left:12px;bottom:132px;z-index:2147483000;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;min-width:210px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:0 8px 28px rgba(0,0,0,.24)}',
      'html[data-dsh-fit] .dsh-fit-width-item{display:flex;align-items:center;justify-content:space-between;gap:12px;box-sizing:border-box;width:100%;padding:8px 12px;border:none;border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}',
      'html[data-dsh-fit] .dsh-fit-width-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      'html[data-dsh-fit] .dsh-fit-width-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      'html[data-dsh-fit] .dsh-fit-width-item[aria-checked="true"]{color:var(--dsw-alias-brand-primary)}',
      'html[data-dsh-fit] .dsh-fit-width-value{flex:none;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
      'html[data-dsh-fit] .dsh-fit-width-item[aria-checked="true"] .dsh-fit-width-value{color:var(--dsw-alias-brand-primary)}',
      /* 拖拽读数：跟着鼠标显示当前内容宽度。 */
      'html[data-dsh-fit] .dsh-fit-width-guide{position:fixed;z-index:2147483001;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;transform:translateY(-50%);box-shadow:0 8px 28px rgba(0,0,0,.24)}',
      'html[data-dsh-fit] .dsh-fit-width-menu[hidden],html[data-dsh-fit] .dsh-fit-width-guide[hidden]{display:none}',
      /* 宽度段关掉时，入口、菜单、拖拽读数一起消失——不留点了没反应的死按钮。 */
      'html[data-dsh-fit]:not([data-dsh-fit-width="on"]) .dsh-fit-width,html[data-dsh-fit]:not([data-dsh-fit-width="on"]) .dsh-fit-width-guide{display:none}',
      'html[data-dsh-fit] .dsh-fit-width svg{display:block}',
      'html[data-dsh-fit] .dsh-fit-fallback-row{box-sizing:border-box;display:flex;align-items:center;width:100%;padding:8px 10px;border:none;background:0 0;border-radius:8px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}',
      'html[data-dsh-fit] .dsh-fit-fallback-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      'html[data-dsh-fit][data-dsh-fit-navmode="compact"] nav[data-dsh-fit-navlist]{gap:0;margin-bottom:4px}',
      'html[data-dsh-fit][data-dsh-fit-navmode="compact"] nav[data-dsh-fit-navlist] button{min-height:30px;padding-top:4px;padding-bottom:4px}',
      'html[data-dsh-fit][data-dsh-fit-navmode="fold"] nav[data-dsh-fit-navlist]{margin-bottom:6px}',
      'html[data-dsh-fit][data-dsh-fit-navmode="fold"] nav[data-dsh-fit-navlist] button:not([aria-haspopup="menu"]){display:none}',
      /* 导航模块关掉时，只有三态按钮消失；宽度按钮不受影响。 */
      'html:not([data-dsh-fit-nav="on"]) .dsh-fit-trigger[data-mode]{display:none}',

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
        'width.hint': '选择对话区宽度挡位（也可以直接拖对话区两侧的手柄）',
        'width.menu': '对话区宽度挡位',
        'width.standard': '标准',
        'width.medium': '中',
        'width.wide': '宽',
        'width.ultra': '超宽',
        'width.full': '满宽',
        'width.custom': '自定义',
        'settings.title': '界面精简',
        'settings.description': '四块样式各管一处，关掉哪一块就立刻回到宿主原样，不用重启。',
        'settings.nav.title': '左栏导航折叠',
        'settings.nav.description':
          '在侧栏页脚加一颗三态按钮：标准 → 紧凑 → 收纳。收纳后所有面板行都进「更多」，仍然可达。',
        'settings.composer.title': '输入条精简',
        'settings.composer.description':
          '隐藏语音键、把徽章换成图标；行宽不足 560px 时收紧间距，让内容铺满整行。',
        'settings.mobile.title': '手机端密度压缩',
        'settings.mobile.description':
          '只在视口 ≤ 899px 时生效：压缩对话标签栏、操作行与状态行的高度，桌面上完全不动。',
        'settings.width.title': '对话宽度挡位',
        'settings.width.description':
          '页脚加一颗宽度入口：标准 / 中 / 宽 / 超宽 / 满宽 / 自定义六档，拖动对话区两侧手柄也会自动记成自定义。不需要再装宽度插件。',
        'settings.storage':
          '默认全部开启。开关写在本机 profile 的 dsh-ui-fit 配置段；导航三态存 localStorage 的 dsh-ui-fit:nav，宽度挡位存 dsh-ui-fit:width。',
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
        'width.hint': 'Pick a conversation width tier (or drag the handles on both sides)',
        'width.menu': 'Conversation width tiers',
        'width.standard': 'standard',
        'width.medium': 'medium',
        'width.wide': 'wide',
        'width.ultra': 'ultra',
        'width.full': 'full',
        'width.custom': 'custom',
        'settings.title': 'UI Fit',
        'settings.description':
          'Four independent style modules. Turning one off restores the stock UI immediately, no restart.',
        'settings.nav.title': 'Collapsible left navigation',
        'settings.nav.description':
          'Adds a three-state footer button: standard → compact → folded. Folded rows stay reachable inside More.',
        'settings.composer.title': 'Compact composer',
        'settings.composer.description':
          'Hides the voice button, swaps badges for icons, and tightens spacing below 560px of row width.',
        'settings.mobile.title': 'Mobile density',
        'settings.mobile.description':
          'Only applies at viewport ≤ 899px: compresses tabs, action rows and status rows. Desktop is untouched.',
        'settings.width.title': 'Conversation width tiers',
        'settings.width.description':
          'Adds a footer width entry: standard / medium / wide / ultra / full / custom. Dragging the conversation handles records a custom width too. The separate width plugin is no longer needed.',
        'settings.storage':
          'All on by default. Switches live in this profile dsh-ui-fit config; the navigation state also lives in localStorage key dsh-ui-fit:nav, the width tier in dsh-ui-fit:width.',
        'settings.failed': 'Write failed; that change did not apply. Try again.',
        'settings.unavailable': 'The config service is not ready yet. Try again in a moment.',
        'settings.on': 'on',
        'settings.off': 'off',
      },
    }

    /* ================================================================== */
    /* 状态：三个开关 + 导航三态 + 窄行标记                                 */
    /* ================================================================== */

    /** 四个模块开关；Host 配置还没到时先全开，与合并前一致。 */
    const flags = { nav: true, composer: true, mobile: true, width: true }

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
      return { nav: flags.nav, composer: flags.composer, mobile: flags.mobile, width: flags.width, ready: flagsReady, tick: value }
    }

    /**
     * 写一个开关。真正的写入由 `apply` 里装上的 `flagWriter` 完成——它拿得到
     * ConfigFormController 与 `settle`，这里只保留一个可替换的默认实现。
     */
    let flagWriter = () => Promise.resolve(false)

    /** 读三态。 */
    function readMode() {
      try {
        const raw = localStorage.getItem(MODE_KEY)
        return MODES.includes(raw) ? raw : 'standard'
      } catch {
        return 'standard'
      }
    }

    let mode = readMode()
    /** @type {Set<() => void>} */
    const modeListeners = new Set()

    /** 把四个开关与三态写到 `<html>` 上，CSS 据此生效或失效。 */
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
      /* 宽度段自己也是门控属性：关掉就整段失效，宽度退回宿主默认。 */
      if (flags.width) root.setAttribute(ATTR_WIDTH, 'on')
      else root.removeAttribute(ATTR_WIDTH)
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

    /* ================================================================== */
    /* 对话宽度：六档 + 自定义，直接驱动宿主的内容宽度轴                    */
    /* ================================================================== */

    /**
     * 宿主的内容宽度轴（从 asar 里读出来的真实契约）：
     *
     * - `[data-conversation-content]`（`.body`）上声明
     *   `--dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, column*.64, 920px))`；
     * - 它的**父元素**才是宽度变量的落点（`ConversationWidthControls` 里
     *   `container.parentElement ?? container`）；
     * - 宿主自己拖拽时写 localStorage 的 `dsh.conversation.contentWidth`，
     *   再由 `ResizeObserver` 用 `resolveContentWidth(column, preference)` 重新算。
     *
     * 所以本插件只要写同一个 `--dsh-chat-user-width`、同一份 localStorage 偏好，
     * 宿主的拖拽手柄、重排、resize 全部照旧工作——这是「接管」而不是「覆盖」。
     */

    /** 读持久化挡位。 */
    function readTier() {
      try {
        const raw = localStorage.getItem(WIDTH_KEY)
        return TIER_IDS.indexOf(raw) === -1 ? 'standard' : raw
      } catch {
        return 'standard'
      }
    }

    /** 读自定义档记下的像素值。 */
    function readCustomWidth() {
      try {
        const value = Number(localStorage.getItem(WIDTH_CUSTOM_KEY))
        return Number.isFinite(value) && value > 0 ? value : null
      } catch {
        return null
      }
    }

    let tier = readTier()
    /** @type {Set<() => void>} */
    const tierListeners = new Set()

    /** 把最新挡位广播给挂载的控件。 */
    function publishTier() {
      for (const listener of Array.from(tierListeners)) {
        try {
          listener()
        } catch {
          /* 一个坏订阅者不能拖住其它人。 */
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

    /** 主对话区元素：宿主在它上面发布内容宽度。 */
    function findWidthRoot() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null
      for (const el of document.querySelectorAll(WIDTH_ROOT_SELECTOR)) {
        if (el === null || el === undefined) continue
        if (typeof el.closest === 'function' && el.closest(WIDTH_SIDEBAR_SELECTOR) !== null) continue
        return el
      }
      return null
    }

    /** 宽度变量的落点：根元素的父级（与宿主同一约定）。 */
    function widthTargetOf(root) {
      if (root === null || root === undefined) return null
      return root.parentElement === undefined || root.parentElement === null ? root : root.parentElement
    }

    /** 宿主默认宽度：`max(680, min(column × 0.64, 920))`。 */
    function defaultWidthPx(column) {
      return Math.max(680, Math.min(column * 0.64, 920))
    }

    /** 宿主允许的最宽：`max(640, column − 176)`。 */
    function fullWidthPx(column) {
      return Math.max(CONTENT_MIN, column - CONTENT_EDGE_BUDGET)
    }

    /** 挡位的目标宽度；`standard` 交还给宿主默认值。 */
    function tierTargetPx(value, column, customPx) {
      if (value === 'medium' || value === 'wide' || value === 'ultra') return NOMINAL_WIDTH_PX[value]
      if (value === 'full') return fullWidthPx(column)
      if (value === 'custom') return customPx
      return null
    }

    /** 实际落地的宽度：与宿主 `resolveContentWidth` 同一套夹取。 */
    function appliedTierPx(value, column, customPx) {
      const target = tierTargetPx(value, column, customPx)
      if (target === null) return null
      return Math.min(Math.max(target, CONTENT_MIN), fullWidthPx(column))
    }

    /**
     * 宿主的宽度偏好键现在是不是本插件写的。
     *
     * 这个键是宿主 `resolveContentWidth` 的输入，**用户自己拖拽手柄也会写它**。所以不能
     * 无条件清：页面一加载就把它抹掉，等于把用户自己拖出来的宽度也删了。只在确实由本
     * 插件写过（`appPrefOwned`）时才回收。
     */
    let appPrefOwned = false

    /**
     * 把挡位落到宽度轴上。
     *
     * 同时写两处：当前元素的行内变量（立刻生效，不等下一帧）和宿主的偏好键
     * （resize 时宿主自己重算，不会跳回默认）。`standard` 只回收自己写过的部分。
     */
    function applyWidth(value) {
      const root = findWidthRoot()
      if (root === null) return false
      const target = widthTargetOf(root)
      if (target === null || target.style === undefined) return false
      const column = typeof root.offsetWidth === 'number' ? root.offsetWidth : 0
      const custom = readCustomWidth()
      if (value === 'standard') {
        target.style.removeProperty('--dsh-chat-user-width')
        if (appPrefOwned) {
          appPrefOwned = false
          try {
            localStorage.removeItem(APP_WIDTH_KEY)
          } catch {
            /* 隐私模式：本次页面生命周期内仍然生效。 */
          }
        }
        return true
      }
      if (value === 'custom' && custom === null) return false
      if (column <= 0) return false
      const px = appliedTierPx(value, column, custom)
      if (px === null) return false
      target.style.setProperty('--dsh-chat-user-width', Math.round(px) + 'px')
      const nominal = tierTargetPx(value, column, custom)
      if (nominal !== null) {
        try {
          localStorage.setItem(APP_WIDTH_KEY, String(Math.round(nominal)))
          appPrefOwned = true
        } catch {
          /* 同上。 */
        }
      }
      return true
    }

    /** 切换挡位：写持久化、落宽度、广播。 */
    function setTier(next) {
      const value = TIER_IDS.indexOf(next) === -1 ? 'standard' : next
      if (value === tier) return
      tier = value
      try {
        localStorage.setItem(WIDTH_KEY, value)
      } catch {
        /* 隐私模式：本次页面生命周期内仍然生效。 */
      }
      applyWidth(value)
      publishTier()
    }

    /** 交还行内变量：宿主回到自己的默认值或它自己的偏好值。 */
    function clearWidth() {
      const root = findWidthRoot()
      if (root === null) return
      const target = widthTargetOf(root)
      if (target === null || target.style === undefined) return
      target.style.removeProperty('--dsh-chat-user-width')
    }

    /**
     * 交还宽度轴：清掉本插件写的行内变量，以及**它自己写过**的偏好键。
     *
     * 偏好键是宿主 `resolveContentWidth` 的输入，只清行内变量的话，宿主下一次 resize
     * 会把宽度又算回我们设的值，用户会以为开关没生效。但用户自己拖拽也写同一个键，
     * 所以只在 `appPrefOwned` 为真时才回收，绝不误删用户自己的宽度。
     */
    function releaseWidth() {
      clearWidth()
      if (!appPrefOwned) return
      appPrefOwned = false
      try {
        localStorage.removeItem(APP_WIDTH_KEY)
      } catch {
        /* 隐私模式：清不掉也不会报错。 */
      }
    }

    /** 记下自定义档的像素值（拖拽手柄松手时调）。 */
    function rememberCustomWidth(px) {
      if (!Number.isFinite(px) || px <= 0) return
      try {
        localStorage.setItem(WIDTH_CUSTOM_KEY, String(Math.round(px)))
      } catch {
        /* 同上。 */
      }
    }

    /**
     * 挡位读数，给菜单用。
     *
     * 名义值够得着就报名义值；窗口太窄够不着时报「名义 → 实际」，例如 `1280px → 696px`。
     * 只报夹取后的值会让人以为六档没区别（窄窗口下全都是同一个数），只报名义值又是骗人。
     */
    function tierValueText(value) {
      const root = findWidthRoot()
      const column = root === null || typeof root.offsetWidth !== 'number' ? 0 : root.offsetWidth
      const custom = readCustomWidth()
      if (value === 'custom' && custom === null) return ''
      if (column <= 0) {
        /* 还没测出列宽：标准/满宽依赖列宽，只能给破折号。 */
        if (value === 'standard' || value === 'full') return '—'
        if (value === 'custom') return Math.round(custom) + 'px'
        return NOMINAL_WIDTH_PX[value] + 'px'
      }
      if (value === 'standard') return Math.round(defaultWidthPx(column)) + 'px'
      if (value === 'full') return Math.round(fullWidthPx(column)) + 'px'
      if (value === 'custom') {
        const px = appliedTierPx(value, column, custom)
        return px === null ? '—' : Math.round(px) + 'px'
      }
      const nominal = NOMINAL_WIDTH_PX[value]
      const applied = appliedTierPx(value, column, custom)
      if (applied === null) return nominal + 'px'
      const rounded = Math.round(applied)
      return nominal === rounded ? rounded + 'px' : nominal + 'px → ' + rounded + 'px'
    }

    /* ================================================================== */
    /* DOM 标记                                                            */
    /* ================================================================== */

    /**
     * 标记全局面板 `<nav>`：类名里仍带 `panelList` 局部名，且含宿主「更多」那一行。
     * 两个条件都要满足，免得把别的导航区块（设置面板等）一起收进去。
     */
    /**
     * 标记全局面板 `<nav>`。
     *
     * 首选槽位锚点 `[data-slot="sidebar.panellist"]`：`data-slot` 是渲染器写死的槽位名，
     * 属宿主公开契约，改版也不动。拿不到时退回「类名含 `panelList` 且含『更多』行」的
     * 老判据——那是哈希类名，宿主换构建就会变。
     */
    function tagNav() {
      if (typeof document === 'undefined') return
      for (const anchor of document.querySelectorAll(NAV_SLOT_SELECTOR)) {
        const nav = typeof anchor.closest === 'function' ? anchor.closest('nav') : null
        if (nav !== null) nav.setAttribute(ATTR_NAVLIST, '')
      }
      for (const nav of document.querySelectorAll('nav')) {
        if (nav.hasAttribute(ATTR_NAVLIST)) continue
        const className = typeof nav.className === 'string' ? nav.className : ''
        if (!/(?:^|_)panelList(?:_|$)/.test(className)) continue
        if (nav.querySelector('button[aria-haspopup="menu"]') === null) continue
        nav.setAttribute(ATTR_NAVLIST, '')
      }
    }

    /**
     * 主对话区的实际内容宽度。
     *
     * 优先读宿主发布的 CSS 变量。注意自定义属性的计算值是「var() 替换后的 token 串」，
     * 不会把 `clamp()` 求值——标准挡位下这里拿到的是 `clamp(680px, calc(...), 920px)`，
     * 直接 `parseFloat` 是 NaN。所以解析不出来时按宿主的默认公式回算，保证拖拽读数
     * 在第一下拖动时就有数字，而不是空着。
     */
    function currentContentPx() {
      const root = findWidthRoot()
      if (root === null) return null
      const column = typeof root.offsetWidth === 'number' ? root.offsetWidth : 0
      if (typeof getComputedStyle === 'function') {
        try {
          const raw = getComputedStyle(root).getPropertyValue('--dsh-chat-content-width').trim()
          const px = parseFloat(raw)
          if (Number.isFinite(px) && px > 0) return px
        } catch {
          /* 取不到就退回下面的公式。 */
        }
      }
      if (column <= 0) return null
      return Math.min(defaultWidthPx(column), fullWidthPx(column))
    }

    /**
     * 标记页脚那一排动作，让 CSS 把邻居拉齐到同一套图标节奏。
     *
     * 首选槽位锚点 `[data-slot="sidebar.footer.action"]`（宿主契约，改版不动）；
     * 退回「自己按钮的父元素」与「`dsh-mobile` 触发器的父元素」——后者是第三方插件，
     * 没装时自然找不到，不影响主体。
     */
    function tagFoot() {
      if (typeof document === 'undefined') return
      const rows = []
      for (const anchor of document.querySelectorAll(FOOT_SLOT_SELECTOR)) rows.push(anchor)
      const trigger = document.querySelector('.' + TRIGGER_CLASS)
      if (trigger !== null && trigger.parentElement !== null) rows.push(trigger.parentElement)
      const mobile = document.querySelector('.dsh-mobile-control__trigger')
      if (mobile !== null && mobile.parentElement !== null) rows.push(mobile.parentElement)
      for (const row of rows) {
        if (row.hasAttribute(ATTR_FOOT)) continue
        row.setAttribute(ATTR_FOOT, '')
      }
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
     * 挡位菜单的一行。
     *
     * 用 `menuitemradio` 而不是 `menuitem`：这些选项是互斥的单选，读屏软件据此播报
     * 「已选中 / 未选中」，而不是当成一组普通命令。
     */
    function widthItem(key, label, valueText, checked, onSelect) {
      return h(
        'button',
        {
          key,
          type: 'button',
          className: 'dsh-fit-width-item',
          role: 'menuitemradio',
          'aria-checked': checked ? 'true' : 'false',
          'data-tier': key,
          onClick: onSelect,
        },
        h('span', null, label),
        h('span', { className: 'dsh-fit-width-value' }, valueText),
      )
    }

    /**
     * 页脚：对话宽度挡位入口。
     *
     * 菜单由本插件自己渲染——原先转发第三方插件的 `#dsh-wide-toggle`，现在宽度轴直接
     * 由 `applyWidth` 驱动，不再需要那个插件。菜单定在侧栏页脚正上方，和页脚按钮同侧。
     */
    function WidthTrigger(props) {
      const { t } = props
      const value = useTier()
      const [open, setOpen] = useState(false)
      /* 自定义档的读数每次打开菜单时重读一次，拖拽改过之后不会显示旧值。 */
      const [tick, setTick] = useState(0)
      const hint = t('width.hint')
      const Tooltip = primitives.Tooltip
      const withTooltip = typeof Tooltip === 'function'

      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const target = event === null || event === undefined ? null : event.target
          if (target === null || typeof target.closest !== 'function') return
          if (target.closest('.dsh-fit-width-menu') !== null) return
          if (target.closest('[data-dsh-fit-width-trigger]') !== null) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event !== null && event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      const choose = (next) => {
        setTier(next)
        setTick((n) => n + 1)
        setOpen(false)
      }

      const rows = TIER_IDS.map((id) =>
        widthItem(id, t('width.' + id), tierValueText(id), value === id, () => choose(id)),
      )

      const menu = h(
        'div',
        {
          className: 'dsh-fit-width-menu',
          role: 'menu',
          'aria-label': t('width.menu'),
          hidden: !open,
          'data-dsh-fit-width-menu': '',
        },
        rows,
      )

      const button = h(
        'button',
        {
          type: 'button',
          className: 'dsh-fit-trigger dsh-fit-width',
          'data-tier': value,
          'data-dsh-fit-width-trigger': '',
          'aria-label': t('width.aria') + ': ' + t('width.' + value),
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          title: withTooltip ? undefined : hint,
          onClick: () => {
            setTick((n) => n + 1)
            setOpen((current) => !current)
          },
        },
        h('span', { className: 'dsh-fit-glyph' }, tierGlyph(value)),
      )

      const trigger = withTooltip ? h(Tooltip, { label: hint, side: 'top', delayMs: 400 }, button) : button
      return h(React.Fragment, null, trigger, menu)
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
        { field: 'width', title: t('settings.width.title'), description: t('settings.width.description') },
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
              flags.width = value.width !== false
              flagsReady = true
              paint()
              paintMobile()
              /* 输入条开关会改变 tight 的允许条件，立刻重测一次。 */
              settle()
              /* 宽度段被关掉时把宽度轴交还宿主，重开时再落回去。 */
              if (flags.width) applyWidth(tier)
              else releaseWidth()
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

        /* ---------- 标记：导航行 / 页脚 ---------- */
        tagNav()
        tagFoot()
        let tagFrame = 0
        const observer = new MutationObserver(() => {
          if (tagFrame !== 0) return
          tagFrame = requestAnimationFrame(() => {
            tagFrame = 0
            if (document.querySelector('nav[' + ATTR_NAVLIST + ']') === null) tagNav()
            if (document.querySelector('[' + ATTR_FOOT + ']') === null) tagFoot()
            if (findRow() !== seen) schedule()
          })
        })
        observer.observe(document.documentElement, { childList: true, subtree: true })
        push(() => {
          observer.disconnect()
          if (tagFrame !== 0) cancelAnimationFrame(tagFrame)
        })

        /*
         * ---------- 拖拽读数 ----------
         *
         * 宿主自己的拖拽手柄（`[data-width-handle]`）松手时才写 localStorage 并重排。
         * 拖的过程中没有任何读数，用户不知道自己拖到了多宽。这里在拖动期间跟一个浮标
         * 显示当前内容宽度；松手后如果落点不等于当前挡位的目标值，就切到「自定义」并
         * 记住这个宽度——这样拖完再点菜单，高亮的是用户自己拖出来的那一档。
         */
        const guide = typeof document.createElement === 'function' ? document.createElement('div') : null
        if (guide !== null) {
          guide.className = 'dsh-fit-width-guide'
          guide.setAttribute('data-dsh-fit-width-guide', '')
          guide.hidden = true
          if (document.body !== null) document.body.appendChild(guide)
        }

        let dragging = false
        let guideTimer = 0
        const hideGuide = () => {
          if (guide !== null) guide.hidden = true
        }
        const isHandle = (event) => {
          const target = event === null || event === undefined ? null : event.target
          if (target === null || typeof target.closest !== 'function') return false
          return target.closest('[data-width-handle]') !== null
        }
        const onPointerDown = (event) => {
          if (!isHandle(event)) return
          dragging = true
          if (guideTimer !== 0) {
            clearTimeout(guideTimer)
            guideTimer = 0
          }
        }
        const onPointerMove = (event) => {
          if (!dragging || guide === null) return
          const px = currentContentPx()
          if (px === null) return
          guide.textContent = Math.round(px) + 'px'
          guide.hidden = false
          guide.style.left = (typeof event.clientX === 'number' ? event.clientX + 16 : 16) + 'px'
          guide.style.top = (typeof event.clientY === 'number' ? event.clientY : 0) + 'px'
        }
        const onPointerUp = (event) => {
          if (!dragging) return
          dragging = false
          if (guideTimer !== 0) clearTimeout(guideTimer)
          guideTimer = setTimeout(hideGuide, 800)
          const px = currentContentPx()
          if (px === null) return
          const column = (() => {
            const root = findWidthRoot()
            return root === null || typeof root.offsetWidth !== 'number' ? 0 : root.offsetWidth
          })()
          if (column <= 0) return
          /*
           * 落点该和什么比：当前挡位的目标宽度。`standard` 没有「目标值」（`tierTargetPx`
           * 返回 null），但它的落地宽度就是宿主默认公式，所以拿那个当基准——否则标准挡位下
           * 随便点一下手柄就会被记成自定义。
           */
          const expected = appliedTierPx(tier, column, readCustomWidth()) ?? Math.min(defaultWidthPx(column), fullWidthPx(column))
          /* 落点和当前挡位的目标值一致就不改挡位；差 2px 以内视为没动过。 */
          if (Math.abs(px - expected) <= 2) return
          if (event !== null && event !== undefined && event.type === 'pointerup') {
            rememberCustomWidth(px)
            tier = 'custom'
            try {
              localStorage.setItem(WIDTH_KEY, 'custom')
            } catch {
              /* 隐私模式：本次页面生命周期内仍然生效。 */
            }
            publishTier()
          }
        }

        if (typeof document.addEventListener === 'function') {
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('pointermove', onPointerMove, true)
          document.addEventListener('pointerup', onPointerUp, true)
          push(() => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('pointermove', onPointerMove, true)
            document.removeEventListener('pointerup', onPointerUp, true)
            if (guideTimer !== 0) clearTimeout(guideTimer)
            if (guide !== null && guide.parentNode !== null) guide.parentNode.removeChild(guide)
          })
        }

        /*
         * 启动时把持久化的挡位重新落到宽度轴上：宿主的 `ResizeObserver` 只认它自己的
         * 偏好键，用户选了「中 / 宽 / 超宽」这类名义值之后重启，得由本插件补一次。
         */
        if (flags.width) applyWidth(tier)

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
