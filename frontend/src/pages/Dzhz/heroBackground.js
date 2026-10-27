/*
 * /dzhz Hero 背景：从 deepseek.com/harness 的生产包里原样取出的 WebGL2 流体着色器。
 *
 * 原页把这段 GLSL 放在 page chunk 的字符串里（不是独立 .glsl 文件），这里逐字复刻，
 * 驱动逻辑也按原实现还原：30fps 节流、DPR 上限 1.5、分辨率降采样到约 1e6 像素、
 * 不可见/切到后台/上下文丢失时停帧、触摸设备关掉两盏灯。
 *
 * 页面本身是临时复刻件（版权内容待替换），这段着色器同样在替换清单里。
 */

const VERTEX_SHADER = `#version 300 es
in vec4 a_position;
void main() { gl_Position = a_position; }
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_grainResolution;
const vec3 u_c1=vec3(0.);
const vec3 u_c2=vec3(0.);
const vec3 u_c3=vec3(32.,74.,126.)/255.;
const vec3 u_c4=vec3(206.,200.,187.)/255.;
const vec3 u_c5=vec3(0.);
const float u_scale=1.19;
const vec2 u_offset=vec2(-1.24,-.48);
const float u_grain=.005;
const vec2 u_lightPos=vec2(.89,.46);
uniform float u_lightCore;
uniform float u_lightHalo;
const float u_vignette=.38;
const float u_bloomThreshold=.61;
const float u_bloomRange=.18;
const float u_bloomStrength=.4;
out vec4 fragColor;

vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);
  const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289v3(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;
  vec4 s1=floor(b1)*2.+1.;
  vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
  m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float hash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}

float fbm(vec3 p){
  float v=0.,amp=.6;vec3 shift=vec3(100.);
  for(int i=0;i<1;i++){v+=amp*snoise(p);p=p*2.+shift;amp*=.4;}
  return v;
}

float fluidNoise(vec2 uv,float t){
  float n1=fbm(vec3(uv*.6,t*.06));
  float n2=fbm(vec3(uv*.6+5.2,t*.06+1.3));
  vec2 w1=vec2(n1,n2)*.6;
  float n3=fbm(vec3((uv+w1)*.7+1.7,t*.05+3.1));
  float n4=fbm(vec3((uv+w1)*.7+9.2,t*.05+5.7));
  vec2 w2=vec2(n3,n4)*.5;
  return fbm(vec3((uv+w1+w2)*.5,t*.04));
}

vec2 curlish(vec2 uv,float t){
  float eps=.02;
  float n=snoise(vec3(uv*.8,t));
  float nx=snoise(vec3((uv+vec2(eps,0.))*.8,t));
  float ny=snoise(vec3((uv+vec2(0.,eps))*.8,t));
  return vec2(-(ny-n)/eps,(nx-n)/eps)*.003;
}

void main(){
  float aspect=u_resolution.x/u_resolution.y;
  vec2 uv=gl_FragCoord.xy/u_resolution;
  vec2 suv=vec2(uv.x*aspect, uv.y) * u_scale + u_offset;
  float t=u_time;

  vec2 curl=curlish(suv,t*.04);
  vec2 uvD=suv+curl*12.;
  float f=fluidNoise(uvD,t);
  float swirl=snoise(vec3(uvD*.8+f*1.5,t*.035))*.5+.5;
  float n=f*.5+.5;
  vec3 col=mix(u_c1,u_c2,smoothstep(.2,.5,n));
  col=mix(col,u_c3,smoothstep(.35,.65,n+swirl*.25));
  col=mix(col,u_c4,smoothstep(.6,.85,swirl)*.55);
  col=mix(col,u_c5,smoothstep(.5,.8,n*swirl)*.35);

  if(u_grain>0.0){
    vec2 flowOffset = (uvD - suv) * u_grainResolution.y;
    vec2 gp = floor((uv * u_grainResolution + flowOffset) / 5.0);
    float gr=hash(gp)*2.-1.;
    col+=gr*u_grain;
  }

  // Self-luminance bloom: bright fluid regions become their own light spots,
  // so glow follows the flow and mouse disturbance instead of a fixed point
  float luma=dot(col,vec3(.299,.587,.114));
  float bloom=smoothstep(u_bloomThreshold-u_bloomRange,u_bloomThreshold+u_bloomRange,luma);
  col+=(col*.85+vec3(.15,.145,.13))*bloom*u_bloomStrength;

  // Virtual light source: soft warm core (same side as helm lighting)
  float ld=length((uv-u_lightPos)*vec2(aspect,1.));
  float core=exp(-ld*ld*4.5);
  float halo=exp(-ld*1.8);
  col+=vec3(1.,.97,.9)*core*u_lightCore+vec3(.72,.8,1.)*halo*u_lightHalo;

  float vig=1.-smoothstep(.35,.75,length(uv-.5));
  col=mix(col*(1.-u_vignette),col,vig);
  fragColor=vec4(col,1.);
}
`;

const FRAME_MS = 1000 / 30;
const MAX_DPR = 1.5;

export default function initHeroBackground(canvas) {
  if (!canvas) return () => {};
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return () => {};

  const shaders = [];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };

  const dispose = () => {
    shaders.forEach((s) => gl.deleteShader(s));
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
  };

  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) {
    dispose();
    return () => {};
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    dispose();
    return () => {};
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(program, 'u_time');
  const uResolution = gl.getUniformLocation(program, 'u_resolution');
  const uGrainResolution = gl.getUniformLocation(program, 'u_grainResolution');
  const coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  gl.uniform1f(gl.getUniformLocation(program, 'u_lightCore'), coarse ? 0 : 0.14);
  gl.uniform1f(gl.getUniformLocation(program, 'u_lightHalo'), coarse ? 0 : 0.2);

  let raf = 0;
  let inView = false;
  let lost = false;
  let needsDraw = true;
  let lastDraw = 0;
  let lastTime = 0;
  let time = 0;
  let width = 0;
  let height = 0;

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastDraw = 0;
    lastTime = 0;
  };

  const frame = (now) => {
    raf = 0;
    if (lost || !inView || document.hidden || !width || !height) return;
    if (!needsDraw && lastDraw && now - lastDraw < FRAME_MS) {
      raf = requestAnimationFrame(frame);
      return;
    }
    if (lastTime) time += 0.00017 * Math.min(now - lastTime, 100);
    lastDraw = lastDraw ? now - ((now - lastDraw) % FRAME_MS) : now;
    lastTime = now;
    gl.uniform1f(uTime, time);
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (canvas.style.opacity !== '1') canvas.style.opacity = '1';
    needsDraw = false;
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    stop();
    if (lost || !inView || document.hidden) return;
    raf = requestAnimationFrame(frame);
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const pixelWidth = rect.width * dpr;
    const pixelHeight = rect.height * dpr;
    const scale = Math.min(
      1,
      1400 / pixelWidth,
      Math.sqrt(1e6 / (pixelWidth * pixelHeight))
    );
    width = Math.max(1, Math.floor(pixelWidth * scale));
    height = Math.max(1, Math.floor(pixelHeight * scale));
    canvas.width = width;
    canvas.height = height;
    gl.uniform2f(uResolution, width, height);
    gl.uniform2f(uGrainResolution, pixelWidth, pixelHeight);
    needsDraw = true;
    start();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const viewObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    start();
  });
  viewObserver.observe(canvas);

  const onVisibility = () => start();
  const onContextLost = () => {
    lost = true;
    stop();
    canvas.style.opacity = '0';
  };

  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onContextLost);

  return () => {
    stop();
    observer.disconnect();
    viewObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    dispose();
  };
}
