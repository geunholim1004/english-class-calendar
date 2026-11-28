/* TalkingFace — 사진 한 장으로 말하는 얼굴 만들기 (외부 서비스 없이 브라우저에서)
   - 입·턱: 윗입술 선 아래를 소리 크기만큼 아래로 당기고, 벌어진 틈은 입 안쪽 색으로 채움
   - 눈: 3~6초마다 깜빡임 (눈 위 피부색으로 눈꺼풀을 그림)
   - 고개: 말할 때 살짝 흔들림, 들을 때 끄덕임, 쉴 때 숨쉬기
   - 소리 입력: (1) 브라우저 음성의 단어 신호 (2) 공유한 탭 소리(ChatGPT·Claude 음성)의 크기 */
(function(){
"use strict";
// 480×480 사진 기준 좌표: 입 중심(mx,my=윗입술과 아랫입술 사이), 입 반폭 mh, 턱 끝 chin, 눈 높이 ey, 눈 x 위치 ex
const LM={
  emma:{mx:240,my:249,mh:46,chin:322,ey:150,ex:[180,296]},
  sophie:{mx:237,my:293,mh:40,chin:349,ey:187,ex:[183,297]},
  clara:{mx:241,my:267,mh:38,chin:327,ey:167,ex:[183,293]},
  luna:{mx:239,my:322,mh:48,chin:387,ey:204,ex:[173,300]},
  james:{mx:237,my:291,mh:36,chin:349,ey:200,ex:[187,280]},
  noah:{mx:240,my:307,mh:38,chin:357,ey:203,ex:[180,287]},
  ryan:{mx:237,my:336,mh:50,chin:400,ey:217,ex:[177,293]},
  leo:{mx:243,my:365,mh:42,chin:424,ey:253,ex:[180,303]}
};
const S=480;
class TalkingFace{
  constructor(canvas){
    this.c=canvas;canvas.width=canvas.height=S;
    this.x=canvas.getContext('2d',{willReadFrequently:true});
    this.open=0;this.target=0;this.mode='idle';this.level=null;this.onLevel=null;
    this.blinkAt=performance.now()+2000;this.blinkT=-1e9;this.raf=null;this.lm=null;this.base=null;
    this.reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.still=true;   // 사진은 그대로 두고, 말할 때 테두리만 빛나게 (움직이려면 false)
    this.loop=this.loop.bind(this);
  }
  load(key,src){
    return new Promise(res=>{const im=new Image();
      im.onload=()=>{const o=document.createElement('canvas');o.width=o.height=S;const ox=o.getContext('2d');ox.drawImage(im,0,0,S,S);
        this.base=ox.getImageData(0,0,S,S);this.lm=LM[key]||null;this.x.putImageData(this.base,0,0);this.start();res(true)};
      im.onerror=()=>res(false);im.src=src});
  }
  setMode(m){this.mode=m}
  pulse(v){this.target=Math.max(this.target,v)}
  setLevelSource(fn,onLevel){this.level=fn;this.onLevel=onLevel||null}
  start(){if(!this.raf)this.raf=requestAnimationFrame(this.loop)}
  stop(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=null}
  loop(now){
    this.raf=requestAnimationFrame(this.loop);
    if(!this.base||!this.c.isConnected)return;
    // 1) 목표 입 벌림
    let tgt=0;
    if(this.level){const lv=this.level();tgt=lv;if(this.onLevel)this.onLevel(lv)}
    else if(this.mode==='speak'){
      this.target*=0.86;
      const chatter=0.22+0.5*Math.abs(Math.sin(now/88)*Math.sin(now/57+1.3));
      tgt=Math.max(this.target,chatter);
    }
    this.open+=(tgt-this.open)*(tgt>this.open?0.45:0.28);
    if(this.open<0.01)this.open=0;
    // 2) 그리기
    const host=this.c.parentElement;if(host)host.style.setProperty('--lv',this.open.toFixed(3));
    if(this.still){if(!this.drawn){this.x.putImageData(this.base,0,0);this.drawn=true;this.c.style.transform=''}return}
    this.x.putImageData(this.base,0,0);
    if(this.lm&&this.open>0.02)this.drawMouth();
    if(this.lm)this.drawBlink(now);
    // 3) 고개 움직임 (CSS)
    if(!this.reduce){
      let r=0,ty=0,sc=1;const speaking=this.mode==='speak'||(this.level&&this.open>0.1);
      if(speaking){r=Math.sin(now/760)*1.3+this.open*0.6;ty=Math.sin(now/430)*1.6-this.open*1.5}
      else if(this.mode==='listen'){r=-1;ty=2.2*Math.sin(now/520)}
      else{sc=1+0.007*Math.sin(now/1300);ty=0.8*Math.sin(now/1300)}
      this.c.style.transform=`translateY(${ty.toFixed(2)}px) rotate(${r.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
    }
  }
  drawMouth(){
    const L=this.lm,D=this.open*L.mh*0.33,W=Math.round(L.mh*1.75);
    const x0=Math.max(0,L.mx-W),x1=Math.min(S-1,L.mx+W),y0=L.my,y1=Math.min(S-1,Math.round(L.chin+(L.chin-L.my)*0.55)),span=y1-y0;
    const w=x1-x0+1,h=y1-y0+1,out=this.x.createImageData(w,h),od=out.data,src=this.base.data;
    for(let x=x0;x<=x1;x++){
      const dx=(x-L.mx)/W,g=Math.abs(dx)<1?0.5*(1+Math.cos(Math.PI*dx)):0;
      const mdx=(x-L.mx)/(L.mh*0.92),gm=Math.abs(mdx)<1?Math.sqrt(1-mdx*mdx):0;
      const Dx=D*g,gap=D*g*gm;
      for(let y=y0;y<=y1;y++){
        const o=((y-y0)*w+(x-x0))*4;
        const ys=(y-Dx-Dx*y0/span)/(1-Dx/span);
        if(ys>=y0){const sy=Math.min(S-1,Math.round(ys)),so=(sy*S+x)*4;od[o]=src[so];od[o+1]=src[so+1];od[o+2]=src[so+2];od[o+3]=255}
        else{
          const yy=y-y0;
          if(yy<gap){
            const t=yy/Math.max(1,gap);let r=72-38*Math.sin(Math.PI*t),gg=26-14*Math.sin(Math.PI*t),b=30-14*Math.sin(Math.PI*t);
            if(t<0.18&&this.open>0.45&&gm>0.4){const k=(0.18-t)/0.18;r+=(220-r)*k*0.6;gg+=(212-gg)*k*0.6;b+=(204-b)*k*0.6}
            if(t>0.8){const lo=(y0*S+x)*4,k=(t-0.8)/0.2;r+=(src[lo]-r)*k*0.6;gg+=(src[lo+1]-gg)*k*0.6;b+=(src[lo+2]-b)*k*0.6}
            od[o]=r;od[o+1]=gg;od[o+2]=b;od[o+3]=255;
          }else{const so=(y0*S+x)*4;od[o]=src[so];od[o+1]=src[so+1];od[o+2]=src[so+2];od[o+3]=255}
        }
      }
    }
    this.x.putImageData(out,x0,y0);
  }
  drawBlink(now,force){
    if(force===undefined){if(now>this.blinkAt){this.blinkT=now;this.blinkAt=now+2600+Math.random()*3600}}
    const p=force!==undefined?0.5:(now-this.blinkT)/160;if(p<0||p>1)return;
    const L=this.lm,close=Math.sin(Math.PI*p),rx=Math.round((L.ex[1]-L.ex[0])*0.19),ry=Math.round(rx*0.5),d=this.base.data;
    for(const ex of L.ex){
      const x0=ex-rx-2,y0=L.ey-ry-2,w=rx*2+5,h=ry*2+5,top=L.ey-ry,H=ry*2*close;
      const img=this.x.getImageData(x0,y0,w,h),od=img.data;
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        const X=x0+xx,Y=y0+yy,nx=(X-ex)/(rx+1),ny=(Y-L.ey)/(ry+1),m=1-(nx*nx+ny*ny);if(m<=0)continue;
        const a=Math.min(1,m*3);if(Y>top+H)continue;
        const sy=Math.max(0,Math.round(top-1-(top+H-Y)*0.22)),so=(sy*S+X)*4,o=(yy*w+xx)*4;
        let r=d[so],g=d[so+1],b=d[so+2];if(Y>top+H-2&&close>0.4){r*=0.55;g*=0.5;b*=0.5}
        od[o]+=(r-od[o])*a;od[o+1]+=(g-od[o+1])*a;od[o+2]+=(b-od[o+2])*a;
      }
      this.x.putImageData(img,x0,y0);
    }
  }
}
/* 탭 소리(ChatGPT·Claude 음성) 연결: 크롬·엣지 데스크톱 */
async function linkTabAudio(face,onState){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia)throw new Error('unsupported');
  const st=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},selfBrowserSurface:'exclude',systemAudio:'include',surfaceSwitching:'include'});
  const at=st.getAudioTracks();
  if(!at.length){st.getTracks().forEach(t=>t.stop());const e=new Error('noaudio');throw e}
  const ac=new (window.AudioContext||window.webkitAudioContext)();
  const an=ac.createAnalyser();an.fftSize=1024;ac.createMediaStreamSource(new MediaStream(at)).connect(an);
  const buf=new Float32Array(an.fftSize);let hold=0;
  face.setLevelSource(()=>{an.getFloatTimeDomainData(buf);let s=0;for(let i=0;i<buf.length;i++)s+=buf[i]*buf[i];
    const rms=Math.sqrt(s/buf.length);return Math.min(1,Math.max(0,(rms-0.008)*10))},
    lv=>{if(lv>0.06)hold=performance.now();onState&&onState(performance.now()-hold<350?'speak':'listen')});
  const stop=()=>{face.setLevelSource(null);try{ac.close()}catch(e){}st.getTracks().forEach(t=>t.stop());onState&&onState('ended')};
  at[0].addEventListener('ended',stop);st.getVideoTracks().forEach(t=>t.addEventListener('ended',stop));
  return stop;
}
/* 선생님 창을 항상 위에 띄우기 (Document Picture-in-Picture) */
async function popOut(el,opts){
  if(!('documentPictureInPicture' in window))throw new Error('unsupported');
  const pip=await window.documentPictureInPicture.requestWindow({width:(opts&&opts.width)||360,height:(opts&&opts.height)||460});
  for(const ss of document.styleSheets){
    try{const st=pip.document.createElement('style');st.textContent=[...ss.cssRules].map(r=>r.cssText).join('\n');pip.document.head.appendChild(st)}
    catch(e){if(ss.href){const l=pip.document.createElement('link');l.rel='stylesheet';l.href=ss.href;pip.document.head.appendChild(l)}}
  }
  pip.document.documentElement.dataset.theme=document.documentElement.dataset.theme||'';
  const ph=document.createElement('div');ph.className='pip-placeholder';ph.textContent='선생님 화면이 작은 창으로 떠 있어요. 창을 닫으면 여기로 돌아와요.';
  el.before(ph);pip.document.body.className='pipbody';pip.document.body.append(el);
  pip.addEventListener('pagehide',()=>{ph.replaceWith(el);opts&&opts.onClose&&opts.onClose()});
  return pip;
}
window.TalkingFace=TalkingFace;window.linkTabAudio=linkTabAudio;window.popOut=popOut;
})();
