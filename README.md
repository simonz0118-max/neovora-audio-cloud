# NEOVORA Audio Cloud v3.0.3

## 本版本重点

修复 Cloudflare 线上模型资源地址错误。项目使用 `@huggingface/transformers` 3.8.1；该版本的 `remotePathTemplate` 只应提供目录模板，具体文件名由库追加，因此配置为：

```js
env.remoteHost = `${self.location.origin}/hf/`;
env.remotePathTemplate = '{model}/resolve/{revision}/';
```

上一版把 `{file}` 写入模板，最终形成 `.../{file}/preprocessor_config.json`，导致模型必然 404。

同时新增 `/api/model-health`，部署脚本在 Cloudflare 发布完成后会自动检查 Whisper 与 M2M100 的核心资源是否能从 Hugging Face 正常访问。

## 部署

只需要双击：

`一键部署.command`

脚本会一次完成依赖、构建、GitHub 同步、Cloudflare 部署和线上模型自检。
