# 维护说明

面向本仓库维护者：打包、发版与 Release 附件上传流程。使用者请看 [README.md](README.md)。

## 仓库结构

```
dsh-think-chinese/
├── package.json            # dsh.bundle.patch 声明；files 白名单决定 npm pack 的内容
├── cordis.patch.yml        # bundle 挂载声明 + 默认配置
├── lib/
│   └── index.js            # 唯一的运行时文件（手写纯 ESM，零依赖）
├── scripts/
│   └── verify.mjs          # 离线冒烟验证，CI 直接调用
├── .github/workflows/
│   └── verify.yml          # push / PR 时在 Node 20 / 22 / 24 上运行验证
├── .gitattributes          # 仓库内一律存 LF，避免 autocrlf 改写插件资产
├── .gitignore
├── LICENSE
├── README.md
└── MAINTAINING.md
```

## 本地验证

```sh
npm test              # 等价于 node scripts/verify.mjs
npm pack --dry-run    # 查看打包清单，不产出文件
```

验证脚本只依赖 Node 内置模块，无需安装任何依赖。

## 打包 tarball

```sh
npm pack
```

`files` 白名单为 `lib` / `cordis.patch.yml` / `README.md` / `MAINTAINING.md` / `LICENSE`，
因此 `scripts/`、`.github/`、`.gitignore` 及任何本地文件都不会进入 tarball。
当前产物为 6 个文件、约 20 kB（压缩后约 8.9 kB）。

`node_modules/` 与 `*.tgz` 已在 `.gitignore` 中排除，tarball 不会也不能提交进仓库，
它以 Release 附件的形式分发。

## 发布新版本

1. 确认 `package.json` 中的 `version` 已更新。
2. 在 GitHub 上创建空仓库（不要勾选初始化 README），随后：

   ```sh
   git remote add origin https://github.com/Hielo19/dsh-think-chinese.git
   git push -u origin main
   ```

3. 打 tag 并推送：

   ```sh
   git tag -a v1.0.1 -m "dsh-think-chinese v1.0.1"
   git push origin v1.0.1
   ```

   带上 `v*` 标签后，使用者即可用
   `dsh plugin --profile web add github:Hielo19/dsh-think-chinese#v1.0.1` 锁定版本。

4. 记录校验值：

   ```sh
   npm pack
   sha256sum dsh-think-chinese-1.0.1.tgz
   ```

## 发布 Release 并上传附件

在 GitHub 的 *Releases → Draft a new release* 中选择 tag，把 `npm pack` 产出的 `.tgz`
添加到附件区即可。

也可以使用 API 完成（凭据只需 `repo` scope）：

```sh
curl -X POST -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/Hielo19/dsh-think-chinese/releases \
  -d '{"tag_name":"v1.0.1","name":"v1.0.1","draft":false,"prerelease":false}'

curl -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: application/octet-stream" \
  --data-binary @dsh-think-chinese-1.0.1.tgz \
  "https://uploads.github.com/repos/Hielo19/dsh-think-chinese/releases/<release-id>/assets?name=dsh-think-chinese-1.0.1.tgz"
```

`<release-id>` 取自第一步响应中的 `id` 字段，而非 `node_id`。

上传完成后建议核对附件大小与本地一致：

```sh
curl -sSL -o /tmp/asset.tgz \
  https://github.com/Hielo19/dsh-think-chinese/releases/download/v1.0.1/dsh-think-chinese-1.0.1.tgz
sha256sum /tmp/asset.tgz
```

## 本机安装记录

以下为开发机上的一次真实安装，确认 `dsh plugin add` 的实际行为，供排查参考。

- profile：`desktop`（桌面应用）
- profile 的 `package.json` 中，`dependencies` 写入
  `"dsh-think-chinese": "link:<本仓库绝对路径>"`，`dsh.profile.bundles` 追加 `dsh-think-chinese`
- profile 的 `node_modules/dsh-think-chinese` 是指向本仓库的符号链接
- 安装后立即生效（live profile 会重读 patch 层），无需重启

`link:` 是本地调试采用的方式。使用者按 README 的三种方式安装即可，不必使用 `link:`。
