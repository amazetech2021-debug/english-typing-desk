# Kokoro 英语语音依赖

- Kokoro.js 1.2.1：<https://github.com/hexgrad/kokoro/tree/main/kokoro.js>，Apache-2.0。
- Kokoro-82M-v1.0-ONNX（q8）与官方英语音色：<https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX>，模型卡标注 Apache-2.0。
- 浏览器包内含 Transformers.js 3.5.1 及其匹配的 ONNX Runtime Web；WASM 从该固定 Transformers.js 版本的 CDN 按需加载，避免混用不兼容的 ORT 发行版。
- 语音前处理来自包内 phonemizer 1.2.1：<https://github.com/xenova/phonemizer.js>，npm 包标注 Apache-2.0；相关第三方组成及许可请参照上游项目。
- 模型与音色按需从 Hugging Face 下载；英文文本仅在浏览器 Worker 中推理，不调用云端 TTS API。

本适配器使用官方固定版浏览器包公开 API。升级依赖时应重新核对语音参数、运行资源及浏览器兼容性。
