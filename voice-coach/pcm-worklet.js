/* 마이크 소리를 16kHz 16비트 PCM 조각(약 0.1초)으로 묶어 메인 스레드로 보냄 */
class PcmCapture extends AudioWorkletProcessor{
  constructor(){super();this.buf=new Int16Array(1600);this.n=0}
  process(inputs){
    const ch=inputs[0]&&inputs[0][0];if(!ch)return true;
    for(let i=0;i<ch.length;i++){
      const s=Math.max(-1,Math.min(1,ch[i]));this.buf[this.n++]=s<0?s*0x8000:s*0x7fff;
      if(this.n===this.buf.length){this.port.postMessage(this.buf.buffer.slice(0));this.n=0}
    }
    return true;
  }
}
registerProcessor('pcm-capture',PcmCapture);
