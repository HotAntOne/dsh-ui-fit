/**
 * `dsh-ui-fit` 的 Host 半边。
 *
 * 这一半只做一件事：导出 `Config`，让 DSH 的设置系统据此自动生成一张中文配置表单
 * （插件页 → 本插件 → 配置）。开关值由 Loader 保存在 profile 的 `cordis.patch.yml`
 * 对应行里，属于账号级偏好，多设备一致。
 *
 * 关键约定（都是踩过的）：
 * 1. 只有 `volatile()` 叶子会被投影成可编辑表单字段；非 volatile 字段在写入时会被
 *    `settings` 拒绝（`Config field "x" is not volatile`）。
 * 2. 设置命名空间等于 `cordis.patch.yml` 里这一行的 `id`，也就是 `dsh-ui-fit`；
 *    浏览器半边用 `ctx.configForms.get('dsh-ui-fit')` 读同一份值。
 * 3. 不调用 `settings.configure({ auto: false })`，表单才会自动生成。Host 半边因此
 *    不需要任何运行时行为，`apply` 是空的——但必须存在，否则 Loader 不会把这一行
 *    当成插件，浏览器半边也就不会被送出。
 */

import z from '@deepseek-ai/schemastery'

/** 插件名，与 cordis.patch.yml 的行 id 一致。 */
export const name = 'dsh-ui-fit'

/** 五个功能开关；默认全开，与合并前的行为完全一致。 */
export const Config = z.object({
  nav: z
    .boolean()
    .default(true)
    .description(
      '左栏导航：把「插件、插件市场、上下文洞察、任务看板、SSH」这些全局行收进「更多」，' +
        '或压矮行高，把竖直空间还给工作区列表。左栏底部会出现一个切换按钮，点一下在' +
        '「标准 → 紧凑 → 收纳」之间循环。',
    )
    .volatile(),
  composer: z
    .boolean()
    .default(true)
    .description(
      '输入条：隐藏一直报错的语音按钮，把模式、计划与 PUA 三个控件收成纯图标；' +
        '输入条本身变窄时自动收紧间距、去掉多余留白，让一行放得下。',
    )
    .volatile(),
  mobile: z
    .boolean()
    .default(true)
    .description(
      '手机端密度：只在窄屏（窗口宽度 ≤ 899 像素）生效。收起每轮费用与底部费用读数，' +
        '压缩消息操作行、顶部工具条、助手状态行和对话标签栏，把竖向空间还给对话本身。' +
        '桌面窗口下这一项不起作用。',
    )
    .volatile(),
  width: z
    .boolean()
    .default(true)
    .description(
      '对话宽度：左栏底部再添一颗宽度入口，提供标准 / 中 / 宽 / 超宽 / 满宽 / 自定义六档，' +
        '直接改对话区的内容宽度；拖动对话区两侧的手柄也会自动记成自定义。' +
        '这一项由本插件自己实现，不再需要第三方宽度插件。',
    )
    .volatile(),
  credits: z
    .boolean()
    .default(true)
    .description(
      '手机端隐藏 WorkBuddy 积分读数：只在窄屏（≤ 899px）藏掉输入框旁一直显示的' +
        '「WB CN · 积分」读数（两处座位共用同一个类，一条规则覆盖），桌面照常显示；' +
        '点开的积分明细面板仍保留。没装 WorkBuddy 时无副作用。',
    )
    .volatile(),
})

/** Host 半边无运行时行为：能力全在浏览器半边。 */
export function apply() {
  /* 故意为空。 */
}

/** 不依赖任何 Host 服务。 */
export const inject = []
