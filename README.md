# dsh-think-chinese

让 DeepSeek Harness 中模型的**思考链（reasoning / thinking）始终用中文输出**的插件。

它是一个 **bundle 插件**（host 侧，零运行时依赖），只做一件事：
向 DSH 的系统提示词注册一条「思考链语言」段落。

```
## 思考链语言

你的思考链（reasoning / thinking 内部推理过程）必须始终使用中文书写。
不要用英文思考：即使读到的是英文代码、英文报错或英文文档，推理也一律用中文表达。
代码、标识符、命令、文件路径、API 名称、专有名词与必要的原文引用保持原样，不要翻译。
思考链里用中文给出判断与取舍的理由，直接说结论，不要复述这段语言要求。
```

DSH 每一个模型步（step）都会重新组装系统提示词，因此该段落：

- 对**已有会话**的下一次请求即生效，无需重置会话；
- 对**新建会话**、子代理以及 workflow 内的子代理同样生效（全局作用域）；
- 与模型和供应商无关：DeepSeek 的 `reasoning_content` 与 Anthropic 的 extended thinking
  读取的是同一份系统提示词。

## 为什么用系统提示词，而不是改写输出

DSH 的思考链是模型自己生成的推理流（`agent/assistant-stream` 的 reasoning 帧）。
在浏览器侧做「翻译式改写」既不可靠，也会破坏流式增量。唯一能让模型**用中文思考**的位置是
提示词层，因此本插件挂在 `ctx.systemPrompt.section()` 上。

## 安装

三种方式任选一种。`--profile` 后填目标 profile 名（桌面应用为 `desktop`，命令行 web 为 `web`）。

**1) 从 GitHub 安装**

```sh
dsh plugin --profile web add github:Hielo19/dsh-think-chinese

# 也可以锁定到指定 tag 或 commit
dsh plugin --profile web add github:Hielo19/dsh-think-chinese#v1.0.0
```

**2) 从本地目录安装**（适用于开发调试）

```sh
dsh plugin --profile web add link:/绝对路径/dsh-think-chinese
```

也可以直接用 Harness 内置的 `plugin_manager` 工具安装该目录。

**3) 从 tarball 安装**（无需保留源码目录）

```sh
# 直接使用 Releases 中的附件
dsh plugin --profile web add https://github.com/Hielo19/dsh-think-chinese/releases/download/v1.0.0/dsh-think-chinese-1.0.0.tgz

# 或先下载，再安装本地文件
dsh plugin --profile web add /路径/dsh-think-chinese-1.0.0.tgz
```

三种方式的效果一致：`dsh plugin add` 会把包写入 profile 的 `dependencies`，
将带 `dsh.bundle` 声明的包追加到 `dsh.profile.bundles`，再由 bundle 的
`cordis.patch.yml` 把插件行插入组合树。

> **不需要构建步骤**：本包不含 `prepare` / `postinstall`，`lib/index.js` 是手写的纯 ESM，
> 安装后即可运行。因此以 git 方式安装时，无需在 profile 的 `pnpm-workspace.yaml` 中
> 添加 `allowBuilds`。

安装生效后，Harness 的系统提示词中会出现 `## 思考链语言` 这一段。

## 配置

**注意**：本插件刻意不导出 `Config`（原因见「实现要点」），因此它**不会出现在
设置 → 插件页的配置表单**中（`cordis_inspect` 会将其报为 `status: absent`）。
修改配置请编辑 YAML，DSH 会重读 profile 的 patch 层；若未生效，重启应用即可重新装载。

配置可写在 bundle 自带的 `cordis.patch.yml`，也可写在 profile 自己的 `cordis.patch.yml`
（用户层优先级更高，可覆盖 bundle 层）：

```yaml
- id: dsh-think-chinese
  name: dsh-think-chinese
  config:
    enabled: true          # 总开关，false 时完全不注入
    language: 中文          # 目标语言名，会写入提示词文案
    scope: reasoning       # reasoning | reply | all
    extraInstruction: ''   # 追加要求，例如术语表
```

`scope` 的取值含义：

| 取值 | 效果 |
| --- | --- |
| `reasoning` | 只强制思考链使用中文，正文保持原样（默认） |
| `all` | 思考链与正文均使用中文 |
| `reply` | 只强制正文使用中文 |

`extraInstruction` 会作为段落最后一部分追加，适合放置「术语统一译法」这类要求。

## 验证

```sh
npm test          # 等价于 node scripts/verify.mjs
```

离线验证（不启动 DSH、不调用模型）覆盖 11 项：段落名与排序位、配置归一化对畸形输入的
健壮性、三档 `scope` 的文案、`enabled: false` 时不注册、`systemPrompt` 缺失时优雅降级、
以及 disposer 对段落的精确回收。

在线验证：安装到 `desktop` profile 后，实际运行实例的系统提示词中出现了
`## 思考链语言` 段落，随后的推理过程转为中文输出。

验证脚本只使用 Node 内置的 `node:assert/strict`，因此 CI 无需执行 `npm install`。

## 实现要点

- **不 import 任何 `@deepseek-ai/*`**：`Config` 也刻意不导出（Cordis 仅在插件导出
  `Config` 时才调用 `Config['~standard'].validate`），配置归一化自行实现。
  因此本插件在 profile 中零依赖、零 peer，不会被 DSH 的版本兼容检查拦下。
- **段落排序位为 850**：位于 `dsh-system-prompt` 的 `SECTION_ORDERS` 中策略段
  （`PLAN_POLICY` 500 / `TEAM_POLICY` 600 / `PTC_ONLY` 800）与工具段（`TOOL_BASH` 1000 起）
  之间，既紧跟既有行为准则，又排在所有工具文档之前。
- **段落名为 `plugin:think-chinese`**：同一层内段落重名会抛错；带命名空间后，
  agent preset 可以用同名段落整体覆盖措辞。
- **由 `ctx.effect` 回收**：HMR 重载或 `plugin remove` 时段落会被自动摘除，
  不会残留为无效的系统提示词。

## 成本提示

新增系统提示词段落会使**提示词前缀缓存（prefix cache）失效一次**，此后趋于稳定；
每一步会多出该段落的 token（约 100 token 量级）。如需完全关闭，把 `enabled` 设为 `false`。

## 维护

发版流程、打包与 Release 附件上传见 [MAINTAINING.md](MAINTAINING.md)。

## License

MIT
