import * as THREE from '../vendor/three.module.js';

/**
 * Minimal single-pass "camcorder tape" post processor.
 * The scene is rendered into a linear HDR-ish target, then a full-screen
 * shader adds barrel distortion, chromatic separation, tape tear, grain,
 * scanlines, vignette and a damage flash before converting to sRGB.
 */
export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      uResolution: { value: new THREE.Vector2(size.x, size.y) },
      uTime: { value: 0 },
      uGlitch: { value: 0 },
      uStatic: { value: 0.15 },
      uFlash: { value: 0 },
      uFade: { value: 0 },
      uScan: { value: 1 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform sampler2D tDiffuse;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform float uGlitch;
        uniform float uStatic;
        uniform float uFlash;
        uniform float uFade;
        uniform float uScan;
        varying vec2 vUv;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 uv = vUv;

          // tape transport wobble
          float wob = sin(uv.y * 12.0 + uTime * 2.1) * 0.0009
                    + sin(uv.y * 47.0 - uTime * 7.3) * 0.00045;
          uv.x += wob * (1.0 + uGlitch * 7.0);

          // intermittent tracking bands
          float row = floor(uv.y * 42.0);
          float bandSeed = hash(vec2(row, floor(uTime * 11.0)));
          float band = step(0.88, bandSeed) * step(hash(vec2(row, 7.0)), 0.75);
          float bandShift = (hash(vec2(row, floor(uTime * 19.0))) - 0.5)
                          * (0.012 + uGlitch * 0.11);
          uv.x += band * bandShift;

          // cheap lens barrel
          vec2 cc = uv - 0.5;
          float r2 = dot(cc, cc);
          uv = 0.5 + cc * (1.0 + 0.062 * r2 + uGlitch * 0.03);

          // chromatic separation grows toward the edges
          float ab = 0.0007 + 0.0032 * r2 + uGlitch * 0.0042;
          vec3 col;
          col.r = texture2D(tDiffuse, uv + vec2(ab, 0.0)).r;
          col.g = texture2D(tDiffuse, uv).g;
          col.b = texture2D(tDiffuse, uv - vec2(ab, 0.0)).b;

          // tape softness + faint horizontal smear
          vec3 smear = texture2D(tDiffuse, uv + vec2(0.0025 + uGlitch * 0.008, 0.0)).rgb;
          col = mix(col, max(col, smear * 0.92), 0.22);

          // vignette
          float vig = smoothstep(1.08, 0.18, sqrt(r2) * 1.42);
          col *= mix(0.46, 1.0, vig);

          // scanlines
          float scan = 0.5 + 0.5 * sin(uv.y * uResolution.y * 1.55 + uTime * 2.0);
          col *= mix(1.0, 0.958, scan * uScan);

          // grain / dropout speckle
          float n = hash(uv * uResolution * 0.7 + fract(uTime * 0.37) * 91.0);
          col += (n - 0.5) * (0.018 + uStatic * 0.12);
          float dropout = step(0.9995 - uStatic * 0.0022, hash(uv * 431.0 + fract(uTime) * 37.0));
          col += dropout * 0.28;

          // warm analogue grade, lifted blacks
          col *= vec3(1.035, 1.0, 0.895);
          col = col * 0.975 + vec3(0.013, 0.011, 0.007);

          col += vec3(0.9, 0.72, 0.42) * uFlash * 0.55;
          col *= (1.0 - clamp(uFade, 0.0, 1.0));

          gl_FragColor = vec4(max(col, 0.0), 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.quadScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._size = new THREE.Vector2();
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(this._size);
    this.target.setSize(Math.max(2, Math.floor(size.x)), Math.max(2, Math.floor(size.y)));
    this.uniforms.uResolution.value.set(
      Math.max(2, Math.floor(size.x)),
      Math.max(2, Math.floor(size.y))
    );
  }

  render() {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
