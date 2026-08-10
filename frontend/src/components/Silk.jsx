/* eslint-disable react/no-unknown-property */
import { useEffect, useRef } from 'react';
import {
  Color,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';

/**
 * Silk — animated silk-texture background (React Bits "Silk", vanilla three.js).
 *
 * Implemented with plain three.js instead of @react-three/fiber: the fiber
 * render loop can stall (root stays inactive) in some embedding environments,
 * which froze the canvas blank even though the shader itself compiled and
 * rendered fine. Direct three gives us full control over the animation loop.
 *
 * Props (unchanged from the original component):
 *   speed, scale, color, noiseIntensity, rotation
 */

const hexToNormalizedRGB = (hex) => {
  hex = hex.replace('#', '');
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
};

const vertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  vPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
varying vec2 vUv;
varying vec3 vPosition;

uniform float uTime;
uniform vec3  uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2  r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2  rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  float rnd        = noise(gl_FragCoord.xy);
  vec2  uv         = rotateUvs(vUv * uScale, uRotation);
  vec2  tex        = uv * uScale;
  float tOffset    = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
                  0.4 * sin(5.0 * (tex.x + tex.y +
                                   cos(3.0 * tex.x + 5.0 * tex.y) +
                                   0.02 * tOffset) +
                           sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  vec4 col = vec4(uColor, 1.0) * vec4(pattern) - rnd / 15.0 * uNoiseIntensity;
  col.a = 1.0;
  gl_FragColor = col;
}
`;

const Silk = ({ speed = 5, scale = 1, color = '#7B7481', noiseIntensity = 1.5, rotation = 0 }) => {
  const hostRef = useRef(null);
  const rafRef = useRef(0);
  const uniformsRef = useRef(null);

  // Mount the three.js scene once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const uniforms = {
      uTime: { value: 0 },
      uColor: { value: new Color(...hexToNormalizedRGB(color)) },
      uSpeed: { value: speed },
      uScale: { value: scale },
      uRotation: { value: rotation },
      uNoiseIntensity: { value: noiseIntensity },
    };
    uniformsRef.current = uniforms;

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 1;

    const geometry = new PlaneGeometry(1, 1, 1, 1);
    const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader });
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    // Fit the plane to the visible area.
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      // Update the canvas CSS size too (setSize's 2nd arg, default true), so
      // the buffer fills the host instead of staying at the browser default
      // 300x150 while the buffer is 588x640 — that mismatch showed only a
      // tiny corner of the silk, i.e. a blank panel.
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const dist = camera.position.z;
      const vFov = (camera.fov * Math.PI) / 180;
      const viewH = 2 * Math.tan(vFov / 2) * dist;
      const viewW = viewH * camera.aspect;
      mesh.scale.set(viewW, viewH, 1);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const clock = { last: performance.now() };
    const tick = (now) => {
      const delta = Math.min(0.05, (now - clock.last) / 1000);
      clock.last = now;
      uniforms.uTime.value += delta;
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      renderer.dispose();
      material.dispose();
      geometry.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      uniformsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Propagate prop changes into the (single) uniforms object.
  useEffect(() => {
    const u = uniformsRef.current;
    if (!u) return;
    u.uSpeed.value = speed;
    u.uScale.value = scale;
    u.uNoiseIntensity.value = noiseIntensity;
    u.uRotation.value = rotation;
    u.uColor.value.setRGB(...hexToNormalizedRGB(color));
  }, [speed, scale, noiseIntensity, color, rotation]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
};

export default Silk;
