# PaddleOCR 浏览器识别依赖

本页面按需加载以下固定版本的官方公开资源，图像在浏览器本机推理，不发送图片至模型服务。

- PaddleOCR.js 0.4.2，PaddlePaddle Authors，Apache-2.0： https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js
- SDK 官方完整模块 Worker： https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/dist/assets/worker-entry-C9UNuyOJ.js
- 该 Worker 包含 ONNX Runtime Web 1.24.3（Microsoft，MIT）、OpenCV.js（Apache-2.0）、js-yaml（MIT）与 clipper-lib（BSL-1.0），具体版权声明保留在远程官方发布包中。
- ONNX Runtime WASM 与模块资源： https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/
- PP-OCRv5_mobile_det / PP-OCRv5_mobile_rec 中英文模型（PaddleOCR，Apache-2.0）： https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/

使用单线程 WASM，无需 COOP/COEP 响应头。首次下载 SDK、ORT 和模型，其后通常使用浏览器 HTTP 缓存。
初次初始化限时 180 秒、单页识别限时 90 秒，取消或超时会终止整个 Worker；下一次识别自动创建新的 Worker。

适配器匹配固定版本的官方 Worker 传输协议及 ResolvedOcrOptions；升级 SDK 时必须重新核实，不应单独修改版本号。
