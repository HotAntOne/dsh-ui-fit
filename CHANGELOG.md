# 更新记录

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

首个版本：把 `dsh-sidebar-fold`、`dsh-input-tidy`、`dsh-mobile-compact` 三个插件合并为一个。

**新增**

- 三个功能开关（左栏导航 / 输入条 / 手机端密度），默认全开，行为与合并前一致。
  开关落在 profile 的 `cordis.patch.yml` 对应行，账号级、多设备一致。
- 关掉某个开关时，那一段样式真的失效（摘掉对应的 `<html>` 门控属性），不是只藏按钮。
- 导航三态从旧键 `dsh-sidebar-fold:mode` 自动迁移到 `dsh-ui-fit:nav`。
- 地址后加 `#fit-debug` 可在页面底部显示输入条的真实测量值（行宽、是否窄行、三个开关状态）。

**合并与修正**

- 控件直径变量 `--dsh-tidy-ctl` 改名为 `--dsh-fit-ctl`，从「输入条插件定义、导航插件借用」
  改为在样式表首行统一定义，消除跨插件耦合。
- 门控属性统一为 `data-dsh-fit-*`：`nav` / `navmode` / `composer` / `tight` / `mobile`。
- 槽位 id 改为 `dsh-ui-fit-nav` / `dsh-ui-fit-width` / `dsh-ui-fit-panels`。
- 样式表仍是一张，顺序固定为「变量 → 导航 → 输入条 → 手机密度」，保持窄屏规则压过前两段。
