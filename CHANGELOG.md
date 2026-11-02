# 更新记录

## 1.2.3

**手机端：「专家」按钮从 74px 文字按钮压成 28px 纯图标**

输入条左下角多了宿主自带的「召唤专家」按钮，默认是「图标 + 专家 + 下拉箭头」共 74px。
桌面宽度下不碍事，窄屏下这一颗就吃掉三颗图标的宽度。这一版只在手机密度生效时改它：

- 按钮固定成 `28px` 见方、圆角、无内边距，尺寸读 `--dsh-fit-btn`，与旁边的 PUA、
  访问模式读同一套变量，排在一起不会一大一小。
- `.aag-btn-label`（「专家」文字）与 `.aag-btn-chevron`（下拉箭头）在窄屏隐藏，
  图标 `span[class*="_icon"]` 收到 `14px`，与邻居图标同尺寸。
- 所有规则都挂在 `html[data-dsh-fit-mobile="on"]` 下——**桌面完全不受影响**，
  仍是 74×28 带文字。测试里有一条反向守卫断言，防止有人把门控去掉。

真机实测（端口 8638）：窄屏 520px 下按钮 28×28、文字与箭头 `display:none`、图标 14×14，
邻居 PUA 同为 28×28；切回 1152px 恢复 74×28 带文字、图标 16×16。

## 1.2.2

**健壮性：第三方插件不在时不再报错，导航/页脚改走宿主公开锚点**

这一版没有改视觉效果，改的是「换一台机器还能不能用」。

1. `check-hooks.mjs` 以前把 `dsh-mobile`、`dsh-better-input`、`@michengai/dsh-pua`、
   `dsh-cost-meter` 提供的选择器也当成本插件必需的钩子。那台机器没装某个插件时，
   选择器当然找不到，脚本判定失配并 exit 1——**全新机器上 `npm test` 直接失败**。
   现在这 13 个钩子带 `owner` 标记：该 owner 没装就跳过，并单独统计行数，不再算失配。
2. `check-hooks.mjs` 的 asar 路径改为按常见安装位置依次探测（Windows 两个盘、
   `%LOCALAPPDATA%`、macOS、Linux），都找不到时仍可用 `--asar` 指定；同时删掉了
   源码里 `corpus.join('\\n')` 的双反斜杠（拼出来是字面 `\n` 两个字符）。
3. `test-client.mjs` 的 `client.js` 路径改成相对本文件解析，换 clone 目录、换机器都不用改。
4. 导航与页脚的 DOM 标记改走**宿主公开契约** `[data-slot="sidebar.panellist"]` 与
   `[data-slot="sidebar.footer.action"]`（渲染器写死的槽位名），哈希类名
   `wtg9ga_panelList` 降级为兜底。宿主换构建导致类名变化时，本插件不再失效。
5. `check-hooks.mjs` 新增三条槽位锚点钩子，`_panelList` / `aria-haspopup` 标为 `optional`。

真实 GUI（端口 7711）复验：6 个 `[data-slot="sidebar.panellist"]` 锚点的 `closest('nav')`
全部指向同一个面板 `nav`（`uniqueNavsFromSlot: 1`），标记成功——锚点在 `nav` 内部，
所以方向是「锚点向上找 nav」，不是「nav 向下找锚点」。页脚标记落在
`[data-slot="sidebar.footer.action"]` 本身（`display:contents`，5 个子节点），
两颗按钮 `aria-label` 与四个门控属性都正常，样式表 17244 字符。

## 1.2.1

**修复：拖拽读数在标准挡位下是空的，且原地松手会被误记成「自定义」**

1.2.0 的读数直接 `parseFloat` 宿主发布的 `--dsh-chat-content-width`。但自定义属性的计算值是
`var()` 替换后的 token 串，`clamp(680px, calc(...), 920px)` 不会被求值，`parseFloat` 得到 `NaN`
——于是标准挡位下拖动手柄，浮标一直是空的。现在解析不出数字时按宿主的默认公式
`max(680, min(列宽 × 0.64, 920))` 回算，第一下拖动就有读数。

同一处还有第二个问题：松手时的「落点是否变化」判断拿 `appliedTierPx(当前挡位)` 当基准，
而标准挡位没有目标值（返回 `null`），判断被跳过——结果只要碰一下手柄就会被记成自定义。
现在标准挡位改用宿主默认宽度作基准，差 2px 以内视为没动过。

两处都在真实 GUI 里验证过：标准挡位原地点击 → 仍是 `standard`、不写自定义键；
拖到 700px → 读数显示 `700px`、松手记 `custom: 700`。

另外把 `check-hooks.mjs` 里三条指向已卸载的 `dsh-width-tiers` 的钩子，换成本插件真正依赖的
宿主钩子：`data-conversation-content`、`data-sidebar-chat`、`dsh-chat-content-width`、
`dsh.conversation.contentWidth`、`data-width-handle`。

## 1.2.0

**新增：对话宽度挡位由本插件自己实现，不再需要第三方插件**

原先页脚那颗宽度按钮只是**转发**给第三方插件 `dsh-width-tiers`（作者 aaronlei）的触发器，
宽度逻辑、菜单、拖拽读数全在别人那里。现在这四样都由本插件实现，装了本插件就可以卸掉它。

- 页脚新增「对话宽度」入口（`sidebar.footer.action`，id `dsh-ui-fit-width`、order 51），
  点开是自己的六档菜单：标准 / 中 / 宽 / 超宽 / 满宽 / 自定义。
- **接管宿主的宽度轴**，不是覆盖：写 `[data-conversation-content]` 父元素的
  `--dsh-chat-user-width`（立即生效），同时写 `localStorage` 的
  `dsh.conversation.contentWidth`（宿主 resize 时用 `resolveContentWidth` 重算，不会跳回默认）。
  宿主自己的拖拽手柄照常可用。
- 夹取规则与宿主完全一致：`max(640, 列宽 − 176)` 上限、`640` 下限；标准档是
  `clamp(680, 列宽 × 0.64, 920)`。
- 菜单里的读数是**实际落地值**；名义值够不着时写成 `1280px → 696px`，不假装能到。
- **拖拽读数**：拖动 `[data-width-handle]` 期间跟一个浮标显示当前内容宽度，松手 800ms 后消失；
  落点与当前挡位差超过 2px 时自动切到「自定义」并记住这个宽度。
- **不误删用户偏好**：宿主那个偏好键用户拖拽时也会写，所以只在确实由本插件写过
  （`appPrefOwned` 标记）时才回收。
- 设置页新增第四个开关「对话宽度挡位」；关掉时入口、菜单、读数一起消失，宽度轴交还宿主。
- 与 `dsh-width-tiers` 共存时，它的浮动按钮被压成不可见不可点，避免两个按钮打同一个宽度轴。
- 导航开关不再牵连宽度按钮：关掉导航只藏三态按钮（选择器从 `.dsh-fit-trigger` 收窄到
  `.dsh-fit-trigger[data-mode]`）。

**测试**

- 新增宽度断言：六档菜单结构（`role=menuitemradio` / `aria-checked`）、读数文案（含
  `名义 → 实际` 形式）、选档后行内变量与偏好键的写入、标准档回收自己写过的键。
- 测试沙箱补齐 `createElement` 的完整假元素、`[data-conversation-content]` 假根节点、
  `localStorage.removeItem`、`document.addEventListener`。
- 设置页断言从三行改为四行，并校验第四行就是 `width` 字段（顺序与 Config 一致，避免串位）。

## 1.1.3

**清理：旧插件的痕迹全部移除**

- 三个被合并的旧插件已从本机彻底卸载（profile 的 `dependencies`、`node_modules`、工作区源码、
  源码备份全部删除），`dsh-ui-fit` 成为唯一实现。
- 删掉 `client.js` 里的一次性迁移逻辑：早期版本会读旧插件的 localStorage 键把导航三态搬过来，
  现在迁移窗口已关闭，这段代码和那个键名一并移除。
- `lint-identifiers.mjs` 去掉「允许旧键名出现一次」的例外，旧插件的包名与属性名一个都不许留。
- `test-client.mjs` 删掉重复的旧属性名守卫（`lint-identifiers.mjs` 已覆盖同一件事）。
- README / CHANGELOG 里对旧插件包名的引用改成描述性表述。

## 1.1.2

**修复：重启 DSH 后插件整个消失**

- 根因：`index.js` 里 `import z from '@deepseek-ai/schemastery'`，而本插件是用 `link:` 装进
  profile 的。Node 会把入口解析成**真实路径**（源码目录），再从源码目录向上找 `node_modules`；
  源码目录那条链上没有 `node_modules`，于是抛 `ERR_MODULE_NOT_FOUND`，Loader 把这一行标成
  `inactive`。配置、`bundles`、`cordis.patch.yml` 全都正常，所以界面上看不出是缺依赖。
- 修法：`package.json` 增加 `dependencies`（原来只在 `peerDependencies` 里声明），并新增
  `npm run setup`（`ensure-deps.mjs`）自检脚本——解析不到时先尝试指向本机已装好的 profile，
  仍不行就退出码 1 打印该跑的命令，不静默通过。
- 顺带补了 README 的排查小节：装完发现插件消失，先跑 `npm run setup`。

## 1.1.1

**输入条图标对齐宿主**

- 左下角的 PUA 与权限模式按钮原来是 36px（PUA 图标 18px），与宿主自己的「+」（28px + 14px 图标）
  并排明显大一截。统一为 **28px 按钮 + 14px 图标**，抽成 `--dsh-fit-btn` / `--dsh-fit-icon`
  两个变量挂在 `[data-composer-card]` 上。
- 窄行（实测 < 560px）**只收间距、不再改按钮尺寸**——原来窄行把按钮抬到 34px，导致同一排里
  34px 与 28px 混排。

## 1.1.0

**新增设置页**

- 设置（左下角账号菜单 → 设置）左列出现「界面精简」一节（`settings.section`，id `dsh-ui-fit`、
  order 18），三个开关带中文说明，点一下立刻生效、不用重启。
- 宿主只按 `Config` schema 生成表单定义、不会自动生成设置页（`@deepseek-ai/dsh-settings`
  README 明写没有自带客户端这么做），所以这一节是自己注册的。
- 开关写入本插件配置命名空间，落在 profile 的 `cordis.patch.yml` 对应行；写成功后宿主广播，
  样式与页面同步刷新。写入失败时页面显示错误、不改本地状态，避免「界面变了但配置没落」。
- 这一节不受任何开关管辖——否则关掉之后再也开不回来。

**测试**

- 补上设置页断言：注册项、渲染结构（标题 / 说明 / 三行 / 存储说明）、`role=switch` /
  `aria-checked` / `data-on` / `aria-label` 随状态翻转、点击写入本插件命名空间。
- 补一条守卫断言：设置页样式不允许出现在任何开关的门控选择器下。

## 1.0.0

首个版本：把原本分散在三个独立插件里的界面调整合并为一个。

**新增**

- 三个功能开关（左栏导航 / 输入条 / 手机端密度），默认全开，行为与合并前一致。
  开关落在 profile 的 `cordis.patch.yml` 对应行，账号级、多设备一致。
- 关掉某个开关时，那一段样式真的失效（摘掉对应的 `<html>` 门控属性），不是只藏按钮。
- 地址后加 `#fit-debug` 可在页面底部显示输入条的真实测量值（行宽、是否窄行、三个开关状态）。

**合并与修正**

- 控件直径变量统一为 `--dsh-fit-ctl`，在样式表首行定义，消除原本的跨插件耦合。
- 门控属性统一为 `data-dsh-fit-*`：`nav` / `navmode` / `composer` / `tight` / `mobile`。
- 槽位 id 改为 `dsh-ui-fit-nav` / `dsh-ui-fit-width` / `dsh-ui-fit-panels`。
- 样式表仍是一张，顺序固定为「变量 → 导航 → 输入条 → 手机密度」，保持窄屏规则压过前两段。
