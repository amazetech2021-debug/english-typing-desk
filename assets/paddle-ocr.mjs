// 使用固定版本官方 Worker 协议；模型只在当前浏览器中推理。
const SDK_VERSION = '0.4.2';
const MODEL_BASE = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
let active = null;
let queue = Promise.resolve();
let nextId = 1;

function failure(code, msg, detail, fatal = true) {
  const error = new Error(msg);
  Object.assign(error, {code, msg, detail: String(detail || ''), fatal});
  return error;
}
function cancelled() {
  const error = failure('cancelled', '已取消本次识别。', '', false);
  error.name = 'AbortError';
  return error;
}
function check(signal) {
  if (signal?.aborted) throw cancelled();
}
function notify(onStatus, text) {
  try { onStatus?.(text); } catch { /* 状态回调不影响推理。 */ }
}
function reset(runtime, error) {
  if (!runtime || runtime.closed) return;
  runtime.closed = true;
  runtime.readyReject(error);
  runtime.worker.terminate();
  for (const pending of runtime.pending.values()) pending.reject(error);
  runtime.pending.clear();
  if (active === runtime) active = null;
}
function request(runtime, type, payload = {}, transfer = []) {
  if (runtime.closed) return Promise.reject(failure('paddle_runtime', '识别引擎已退出，请重试。'));
  const requestId = nextId++;
  return new Promise((resolve, reject) => {
    runtime.pending.set(requestId, {resolve, reject});
    try {
      runtime.worker.postMessage({kind:'worker-transport-request', requestId, type, payload}, transfer);
    } catch (error) {
      runtime.pending.delete(requestId);
      reject(error);
    }
  });
}
function guarded(runtime, promise, milliseconds, signal, phase) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => {
      const error = cancelled();
      reset(runtime, error);
      finish(reject, error);
    };
    const timer = setTimeout(() => {
      const error = failure('paddle_timeout', phase === 'load' ? 'PaddleOCR 加载超时，请检查网络后重试。' : '本页识别超时，请重试或使用更清晰的图片。');
      reset(runtime, error);
      finish(reject, error);
    }, milliseconds);
    promise.then(value => finish(resolve, value), error => finish(reject, error));
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
  });
}
function createRuntime() {
  if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw failure('paddle_unsupported', '当前浏览器不支持绘本识别，请使用最新版 Chrome、Edge 或 Safari。');
  }
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const worker = new Worker(new URL('./paddle-worker.mjs', import.meta.url), {type:'module', name:`paddleocr-${SDK_VERSION}`});
  const runtime = {worker, ready, readyReject, pending:new Map(), closed:false, initialized:false};
  worker.onmessage = event => {
    const message = event.data;
    if (message?.kind === 'typing-desk-paddle-ready') { readyResolve(); return; }
    if (message?.kind !== 'worker-transport-response') return;
    const pending = runtime.pending.get(message.requestId);
    if (!pending) return;
    runtime.pending.delete(message.requestId);
    if (message.status === 'success') pending.resolve(message.payload);
    else pending.reject(failure('paddle_runtime', 'PaddleOCR 识别失败，请重试。', message.error?.message));
  };
  worker.onerror = event => {
    event.preventDefault();
    const error = failure('paddle_load', 'PaddleOCR 引擎加载失败，请检查网络后重试。', event.message);
    readyReject(error);
    reset(runtime, error);
  };
  worker.onmessageerror = () => {
    const error = failure('paddle_runtime', '识别引擎通讯失败，请重试。');
    readyReject(error);
    reset(runtime, error);
  };
  return runtime;
}
function options() {
  // 此结构来自固定版 SDK 的 ResolvedOcrOptions，供其官方 Worker 初始化。
  return {
    pipelineConfig:{
      pipelineName:'OCR', raw:{}, warnings:[], unsupportedFeatures:[],
      modelSelection:{textDetectionModelName:'PP-OCRv5_mobile_det',textRecognitionModelName:'PP-OCRv5_mobile_rec'},
      assets:{
        det:{url:`${MODEL_BASE}PP-OCRv5_mobile_det_onnx_infer.tar`},
        rec:{url:`${MODEL_BASE}PP-OCRv5_mobile_rec_onnx_infer.tar`}
      },
      runtimeDefaults:{text_det_limit_side_len:960,text_det_limit_type:'max',text_det_max_side_limit:1600,text_det_thresh:0.3,text_det_box_thresh:0.6,text_det_unclip_ratio:1.5,text_rec_score_thresh:0.3},
      pipelineBatchSize:1,textDetectionBatchSize:1,textRecognitionBatchSize:6
    },
    ortOptions:{backend:'wasm',wasmPaths:WASM_BASE,numThreads:1,simd:true,proxy:false,disableWasmProxy:true}
  };
}
async function run(blob, {signal, onStatus} = {}) {
  check(signal);
  if (!(blob instanceof Blob) || !blob.size) throw failure('paddle_input', '本页图片为空，请重新打开绘本。', '', false);
  let runtime = active;
  if (!runtime) {
    try { runtime = active = createRuntime(); }
    catch(error) { throw error?.code ? error : failure('paddle_load', '无法启动绘本识别引擎，请刷新页面后重试。', error); }
  }
  try {
    if (!runtime.initialized) {
      notify(onStatus, '首次使用正在加载 PaddleOCR 和中英文模型，请稍候…');
      const initialize = async () => {
        await runtime.ready;
        return request(runtime, 'init', {options:options()});
      };
      await guarded(runtime, initialize(), 180000, signal, 'load');
      runtime.initialized = true;
    }
    check(signal);
    notify(onStatus, '正在本机识别本页文字…');
    const predict = async () => {
      const imageBitmap = await createImageBitmap(blob);
      if (signal?.aborted || runtime.closed) { imageBitmap.close(); throw cancelled(); }
      try {
        return await request(runtime, 'predict', {sources:[{kind:'imageBitmap',imageBitmap}],params:{}}, [imageBitmap]);
      } catch(error) {
        imageBitmap.close();
        throw error;
      }
    };
    const results = await guarded(runtime, predict(), 90000, signal, 'predict');
    check(signal);
    const items = (results?.[0]?.items || []).filter(item => typeof item?.text === 'string' && item.text.trim());
    return {text:items.map(item => item.text.trim()).join('\n'),items};
  } catch(error) {
    reset(runtime, error);
    throw error?.code ? error : failure('paddle_runtime', 'PaddleOCR 识别失败，请检查网络后重试。', error);
  }
}
export function recognize(blob, options = {}) {
  // 页面前台与后台共用一条队列，取消和超时会终止 Worker 再释放锁。
  const job = queue.then(() => run(blob, options));
  queue = job.catch(() => {});
  return job;
}
