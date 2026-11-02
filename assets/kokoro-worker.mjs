import {KokoroTTS} from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
// 沿用包内匹配的 Transformers.js WASM 地址，不能混用 ORT 发行版。
let engine=null;
function segments(text){
  const words=text.trim().split(/\s+/),out=[];let part='';
  for(const word of words){if(part.length+word.length>180&&part){out.push(part);part=''}part+=(part?' ':'')+word}
  if(part)out.push(part);return out;
}
self.onmessage=async({data})=>{
  const {id,text,voice,speed}=data;
  try{
    if(!engine){
      self.postMessage({id,phase:'load'});
      self.postMessage({id,status:'正在下载 Kokoro 英语模型，首次使用请稍候…'});
      let lastProgress=-1;
      engine=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'wasm',progress_callback:p=>{
        if(p.status==='progress'&&String(p.file||'').includes('.onnx')){const n=Math.floor(p.progress||0);if(n!==lastProgress){lastProgress=n;self.postMessage({id,status:'正在下载 Kokoro 英语模型：'+n+'%（首次使用）'})}}
      }});
    }
    self.postMessage({id,phase:'generate'});
    self.postMessage({id,status:'正在本机生成英文语音…'});
    const parts=[];let length=0;
    for(const part of segments(text)){const audio=await engine.generate(part,{voice,speed});parts.push(audio.audio);length+=audio.audio.length}
    const pcm=new Float32Array(length);let pos=0;for(const part of parts){pcm.set(part,pos);pos+=part.length}
    self.postMessage({id,pcm,rate:24000},[pcm.buffer]);
  }catch(error){engine=null;self.postMessage({id,error:String(error?.message||error)})}
};
self.postMessage({ready:true});
