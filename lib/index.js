/**
 * dsh-think-chinese — DSH host plugin.
 *
 * 强制模型的「思考链」用中文输出。
 *
 * 做法：在组合树里注册一条 system prompt 段落（`ctx.systemPrompt.section`）。
 * DSH 每个模型步（step）都会重新组装系统提示词，因此这条段落对
 * **已有会话** 与 **新建会话** 里的每一次请求都生效，且与具体模型/供应商无关
 * （DeepSeek 的 reasoning_content 与 Anthropic 的 extended thinking 读取的是同一份系统提示词）。
 *
 * 本文件刻意不 import 任何 `@deepseek-ai/*` 包：
 *   - 不导出 Config（Cordis 仅在插件导出 Config 时才校验它），配置归一化由本文件自行完成；
 *   - 不依赖类型声明合并（用 ctx.get('systemPrompt') 做可选服务查找）。
 * 这样插件在 profile 里零依赖、零 peer，不会被版本兼容检查拦下。
 *
 * @module dsh-think-chinese
 */

/** 插件行名，必须与 cordis.patch.yml 里的 `id` 一致。 */
export const name = 'dsh-think-chinese'

/**
 * 段落名。同一层里重名会抛错，所以带命名空间。
 * 作用域内同名段落会遮蔽全局同名段落 —— 也就是说，
 * 某个 agent preset 可以注册同名段落来覆盖本插件的措辞。
 */
const SECTION_NAME = 'plugin:think-chinese'

/**
 * 段落排序位。
 *
 * dsh-system-prompt 的 SECTION_ORDERS 里，500..800 是「策略」段
 * （PLAN_POLICY 500、TEAM_POLICY 600、PTC_ONLY 800），900 起才是工具说明。
 * 850 正好落在策略段与工具段之间：紧跟既有行为准则，又在所有工具文档之前，
 * 模型读工具说明时已经带着「用中文思考」这个前提。
 */
const SECTION_ORDER = 850

/** 每步都会读到的服务；缺了它本插件没有意义。 */
export const inject = ['systemPrompt']

const SCOPE_REASONING = 'reasoning'
const SCOPE_REPLY = 'reply'
const SCOPE_ALL = 'all'

/**
 * 归一化 scope 取值，任何意外输入都退回默认的 `reasoning`。
 * @param {unknown} value - 原始配置值。
 * @returns {'reasoning' | 'reply' | 'all'} 归一化后的范围。
 */
function normalizeScope(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === SCOPE_REPLY) return SCOPE_REPLY
  if (text === SCOPE_ALL) return SCOPE_ALL
  return SCOPE_REASONING
}

/**
 * 组装某一档范围的提示词要求。
 * @param {'reasoning' | 'reply' | 'all'} scope - 生效范围。
 * @param {string} language - 目标语言名（默认「中文」）。
 * @returns {string[]} 逐句要求。
 */
function requirements(scope, language) {
  const think = [
    `你的思考链（reasoning / thinking 内部推理过程）必须始终使用${language}书写。`,
    `不要用英文思考：即使读到的是英文代码、英文报错或英文文档，推理也一律用${language}表达。`,
    '代码、标识符、命令、文件路径、API 名称、专有名词与必要的原文引用保持原样，不要翻译。',
    `思考链里用${language}给出判断与取舍的理由，直接说结论，不要复述这段语言要求。`
  ]
  const reply = [
    `面向用户的最终回复同样使用${language}。`,
    '代码块、命令、路径、日志与专有名词保持原文。'
  ]

  switch (scope) {
    case SCOPE_REPLY:
      return reply
    case SCOPE_ALL:
      return [...think, ...reply]
    default:
      return think
  }
}

/**
 * 渲染段落正文。
 * @param {ReturnType<typeof resolveConfig>} config - 归一化配置。
 * @returns {string} 系统提示词段落正文。
 */
function sectionText(config) {
  const lines = ['## 思考链语言', '', ...requirements(config.scope, config.language)]

  if (config.extraInstruction.length > 0) {
    lines.push('', config.extraInstruction)
  }

  return lines.join('\n')
}

/**
 * 归一化配置，容忍任意 JSON 形状（profile patch、bundle patch、plugin_manager 都能写）。
 * @param {unknown} raw - Loader 解析出的原始配置。
 * @returns {{ enabled: boolean, language: string, scope: 'reasoning' | 'reply' | 'all', extraInstruction: string }}
 */
function resolveConfig(raw) {
  const source = typeof raw === 'object' && raw !== null ? raw : {}
  const language = typeof source.language === 'string' && source.language.trim().length > 0
    ? source.language.trim()
    : '中文'

  return {
    enabled: source.enabled !== false,
    language,
    scope: normalizeScope(source.scope),
    extraInstruction: typeof source.extraInstruction === 'string' ? source.extraInstruction.trim() : ''
  }
}

/**
 * 刻意不导出 `Config`。
 *
 * Cordis 的 `resolveConfig` 只在插件导出 Config 时调用它的
 * `Config['~standard'].validate(raw)`；不导出就原样把组合树里的 config 交给
 * `apply`，由本文件的 {@link resolveConfig} 归一化。这样既不需要引入
 * Schemastery（零运行时依赖），也不会因为 schema 形状不合而让组合树启动失败。
 * 默认值写在 cordis.patch.yml 与本文件的归一化逻辑里。
 */

/**
 * 挂载插件：注册（并在卸载/热更时精确回收）那条语言段落。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件所在作用域。
 * @param {unknown} rawConfig - 组合树里这一行的 config。
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  if (!config.enabled) return

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt === undefined) {
    ctx.logger?.warn?.('dsh-think-chinese: 未找到 systemPrompt 服务，本插件未生效')
    return
  }

  const text = sectionText(config)

  // ctx.effect 让 disposer 跟随插件生命周期：HMR 重载或 plugin remove 时段落自动摘掉，
  // 不会残留成幽灵系统提示词。
  ctx.effect(
    () => systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text }),
    'dsh-think-chinese: reasoning language section'
  )

  ctx.logger?.debug?.('dsh-think-chinese: 已注册思考链语言段落 (%s / %s)', config.language, config.scope)
}

/** 便于离线自检与测试：暴露纯函数。 */
export const internals = { sectionText, resolveConfig, normalizeScope, SECTION_NAME, SECTION_ORDER }
