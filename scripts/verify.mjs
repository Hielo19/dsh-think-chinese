/**
 * 离线冒烟验证：不启动 DSH，也不真的调用模型。
 *
 * 用一个假的 cordis Context 挂载插件，断言：
 *   1. 段落名 / 排序位 / 正文内容符合预期；
 *   2. config 归一化对畸形输入健壮；
 *   3. enabled: false 时完全不注册；
 *   4. systemPrompt 服务缺失时优雅降级而不是抛错；
 *   5. disposer 精确回收段落（HMR / plugin remove 的安全前提）。
 *
 * 用法：node scripts/verify.mjs
 */

import assert from 'node:assert/strict'
import { apply, inject, internals, name } from '../lib/index.js'

const { sectionText, resolveConfig, normalizeScope, SECTION_NAME, SECTION_ORDER } = internals

/** 收集注册结果与 disposer 的假 Context。 */
function fakeContext({ withService = true } = {}) {
  const state = { sections: [], effectDisposers: [], disposed: 0, warnings: [] }

  const ctx = {
    logger: {
      debug() {},
      warn(message) {
        state.warnings.push(String(message))
      }
    },
    get(service) {
      if (service !== 'systemPrompt') return undefined
      if (!withService) return undefined
      return {
        section(section) {
          state.sections.push(section)
          const dispose = () => {
            state.disposed += 1
          }
          return dispose
        }
      }
    },
    effect(setup) {
      // cordis 的 ctx.effect 会把 setup 返回的 disposer 挂到插件 fiber 上，
      // 这里如实转发并记录，便于断言「注册的段落确实被回收」。
      const dispose = setup()
      state.effectDisposers.push(dispose)
      return dispose
    }
  }

  return { ctx, state }
}

let passed = 0
const check = (label, fn) => {
  fn()
  passed += 1
  process.stdout.write(`  ok  ${label}\n`)
}

process.stdout.write(`dsh-think-chinese 离线验证 (plugin name: ${name})\n`)

check('inject 声明了 systemPrompt', () => {
  assert.deepEqual([...inject], ['systemPrompt'])
})

check('默认范围是 reasoning', () => {
  assert.equal(normalizeScope(undefined), 'reasoning')
  assert.equal(normalizeScope('REPLY'), 'reply')
  assert.equal(normalizeScope('  All '), 'all')
  assert.equal(normalizeScope('乱写的'), 'reasoning')
  assert.equal(normalizeScope(42), 'reasoning')
})

check('畸形 config 不会抛错', () => {
  for (const raw of [undefined, null, 0, 'x', [], { enabled: 'yes' }, { language: 7 }]) {
    const config = resolveConfig(raw)
    assert.equal(typeof config.enabled, 'boolean')
    assert.equal(typeof config.language, 'string')
    assert.equal(typeof config.extraInstruction, 'string')
    assert.ok(['reasoning', 'reply', 'all'].includes(config.scope))
  }
  // enabled 只有显式 false 才关闭
  assert.equal(resolveConfig({ enabled: 'yes' }).enabled, true)
  assert.equal(resolveConfig({ enabled: false }).enabled, false)
  assert.equal(resolveConfig({ language: '   ' }).language, '中文')
})

check('reasoning 档的正文覆盖思考链、且不误伤代码', () => {
  const text = sectionText(resolveConfig({ scope: 'reasoning' }))
  assert.match(text, /思考链/)
  assert.match(text, /中文/)
  assert.match(text, /必须始终使用中文书写/)
  assert.match(text, /代码/)
  assert.doesNotMatch(text, /最终回复同样使用/)
})

check('reply 档只约束正文', () => {
  const text = sectionText(resolveConfig({ scope: 'reply' }))
  assert.match(text, /最终回复同样使用中文/)
  assert.doesNotMatch(text, /必须始终使用中文书写/)
})

check('all 档同时约束思考链与正文', () => {
  const text = sectionText(resolveConfig({ scope: 'all' }))
  assert.match(text, /必须始终使用中文书写/)
  assert.match(text, /最终回复同样使用中文/)
})

check('language 与 extraInstruction 会进入正文', () => {
  const text = sectionText(resolveConfig({ language: '简体中文', extraInstruction: '术语表：token 一律译作“令牌”。' }))
  assert.match(text, /简体中文/)
  assert.match(text, /术语表/)
  // 未配置追加要求时不留多余空行
  assert.doesNotMatch(sectionText(resolveConfig({})), /\n\n$/)
})

check('挂载后注册一条段落，名字与排序位稳定', () => {
  const { ctx, state } = fakeContext()
  apply(ctx, { enabled: true, scope: 'reasoning' })
  assert.equal(state.sections.length, 1)
  assert.equal(state.sections[0].name, SECTION_NAME)
  assert.equal(state.sections[0].order, SECTION_ORDER)
  assert.equal(typeof state.sections[0].text, 'string')
  // 850 必须落在策略段(≤800)与工具段(≥1000)之间
  assert.ok(SECTION_ORDER > 800 && SECTION_ORDER < 1000)
})

check('enabled: false 时不注册任何段落', () => {
  const { ctx, state } = fakeContext()
  apply(ctx, { enabled: false })
  assert.equal(state.sections.length, 0)
})

check('未声明 systemPrompt 时优雅降级', () => {
  const { ctx, state } = fakeContext({ withService: false })
  assert.doesNotThrow(() => apply(ctx, {}))
  assert.equal(state.sections.length, 0)
  assert.equal(state.warnings.length, 1)
})

check('disposer 精确回收段落', () => {
  const { ctx, state } = fakeContext()
  apply(ctx, {})
  assert.equal(state.effectDisposers.length, 1)
  assert.equal(state.disposed, 0)
  state.effectDisposers[0]()
  assert.equal(state.disposed, 1)
})

process.stdout.write(`\n全部通过：${passed} 项\n`)
