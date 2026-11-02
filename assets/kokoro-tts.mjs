// 固定官方版本；英文文本只发送给本机 Worker。
let active=null, queue=Promise.resolve(), nextId=1;
function fail(code,msg,detail=''){const e=new Error(msg);Object.assign(e,{code,msg,detail});return e}
function cancelled(){const e=fail('cancelled','已取消英文语音。');e.name='AbortError';return e}
function reset(runtime,error){if(!runtime||runtime.closed)return;runtime.closed=true;runtime.worker.terminate();for(const pending of runtime.pending.values())pending.reject(error);runtime.pending.clear();runtime.readyReject(error);if(active===runtime)active=null}
function create(){
  if(typeof Worker!=='function')throw fail('kokoro_unsupported','当前浏览器不支持 Kokoro，请选择其他英文语音。');
  let resolve,reject;const ready=new Promise((a,b)=>{resolve=a;reject=b});
  const worker=new Worker(new URL('./kokoro-worker.mjs?v=buffer-2',import.meta.url),{type:'module',name:'kokoro-english'});
  const r={worker,ready,readyReject:reject,pending:new Map(),closed:false};
  worker.onmessage=({data})=>{if(data.ready){resolve();return}const p=r.pending.get(data.id);if(!p)return;if(data.phase){try{p.onPhase?.(data.phase)}catch{}return}if(data.status){try{p.onStatus?.(data.status)}catch{}return}r.pending.delete(data.id);if(data.error)p.reject(fail('kokoro_synthesis','Kokoro 生成失败，请重试或选择其他英文语音。',data.error));else p.resolve(data)};
  worker.onerror=e=>{e.preventDefault();reset(r,fail('kokoro_load','Kokoro 加载失败，请检查网络或选择其他英文语音。',e.message))};
  worker.onmessageerror=()=>reset(r,fail('kokoro_runtime','Kokoro 通讯失败，请重新尝试。'));
  return r;
}
function wav(pcm,rate){
  const b=new ArrayBuffer(44+pcm.length*2),v=new DataView(b);const str=(offset,s)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i))};
  str(0,'RIFF');v.setUint32(4,36+pcm.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++){const x=Math.max(-1,Math.min(1,pcm[i]));v.setInt16(44+i*2,x<0?x*32768:x*32767,true)}return new Blob([b],{type:'audio/wav'});
}
async function run(text,{voice='af_heart',speed=1,signal,onStatus,onPhase,loadTimeoutMs=240000,generationTimeoutMs=60000}={}){
  if(signal?.aborted)throw cancelled();
  text=String(text||'').trim();if(!text)return {blob:wav(new Float32Array(0),24000)};
  let r=active;if(!r)r=active=create();
  let abort,timer,currentPhase='',changePhase=()=>{};
  const budget=(value,fallback)=>Number.isFinite(Number(value))?Math.max(1,Math.min(600000,Number(value))):fallback;
  try{
    const job=(async()=>{await r.ready;if(signal?.aborted)throw cancelled();const id=nextId++;return new Promise((resolve,reject)=>{r.pending.set(id,{resolve,reject,onStatus,onPhase:phase=>changePhase(phase)});r.worker.postMessage({id,text,voice,speed:Math.max(0.5,Math.min(2,Number(speed)||1))})})})();
    const data=await new Promise((resolve,reject)=>{
      let finished=false;const finish=(fn,x)=>{if(finished)return;finished=true;fn(x)};
      abort=()=>{const e=cancelled();reset(r,e);finish(reject,e)};
      changePhase=phase=>{if(currentPhase===phase)return;currentPhase=phase;clearTimeout(timer);try{onPhase?.(phase)}catch{}const limit=phase==='generate'?budget(generationTimeoutMs,60000):budget(loadTimeoutMs,240000);timer=setTimeout(()=>{const e=fail('kokoro_timeout',phase==='generate'?'Kokoro 本机生成较慢，本次请使用备选语音。':'Kokoro 模型准备超时，请检查网络或使用备选语音。',phase);e.phase=phase;reset(r,e);finish(reject,e)},limit)};
      changePhase('load');
      signal?.addEventListener('abort',abort,{once:true});job.then(x=>finish(resolve,x),e=>finish(reject,e));if(signal?.aborted)abort();
    });
    if(signal?.aborted)throw cancelled();
    if(!(data.pcm instanceof Float32Array)||!data.pcm.length)throw fail('kokoro_empty','Kokoro 没有生成有效音频，请重试。');
    return {blob:wav(data.pcm,data.rate),sampleRate:data.rate,duration:data.pcm.length/data.rate};
  }catch(e){reset(r,e);throw e?.code?e:fail('kokoro_runtime','Kokoro 生成失败，请重试。',String(e))}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
export function synthesize(text,options={}){
  if(options.signal?.aborted)return Promise.reject(cancelled());
  const job=queue.then(()=>run(text,options));queue=job.catch(()=>{});
  // 排队任务可立即取消，但队列仍等待前一任务退出，避免并行模型。
  if(!options.signal)return job;
  return new Promise((resolve,reject)=>{const abort=()=>reject(cancelled());options.signal.addEventListener('abort',abort,{once:true});job.then(resolve,reject).finally(()=>options.signal.removeEventListener('abort',abort));if(options.signal.aborted)abort()});
}
