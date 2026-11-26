/* 3Dway 3D layer
   - Hero: a faceted spiral vase prints layer by layer under a moving hot end; the slider scrubs the layers.
   - Story: scrolling turns the same model into its mesh, then exploded slices, then the finished print.
   - Shop: every product gets a rendered 3D thumbnail and a live viewer in its detail dialog. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = s => document.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x) };
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOT = new THREE.Color('#ff7a2e');
const TEAL = new THREE.Color('#00A5B8');
const ORANGE = new THREE.Color('#E8743B');

/* ---------------------------------------------------------------
   Print material: standard PBR + layer lines, a cut height (uPrint),
   a glowing freshly-extruded band and hot cut faces.
---------------------------------------------------------------- */
function printMaterial(o = {}, shared = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: o.color ?? TEAL, roughness: o.rough ?? 0.5, metalness: o.metal ?? 0,
    clearcoat: o.clear ?? 0, clearcoatRoughness: 0.4, side: THREE.DoubleSide,
    flatShading: !!o.flat, envMapIntensity: o.env ?? 1
  });
  const u = {
    uMin: { value: o.min ?? -1e4 }, uMax: { value: o.max ?? 1e4 },
    uPrint: shared.uPrint || { value: 1e4 }, uHot: shared.uHot || { value: 0 },
    uLayer: { value: o.layer ?? 0.02 }, uLines: { value: o.lines ?? 1 }, uHotColor: { value: HOT }
  };
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj;
        uniform float uMin, uMax, uPrint, uHot, uLayer, uLines;
        uniform vec3 uHotColor;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vObj.y > min(uMax, uPrint) || vObj.y < uMin) discard;
        float lq = vObj.y / uLayer;
        float lp = fract(lq);
        float lfade = uLines * (1.0 - smoothstep(0.25, 0.7, fwidth(lq)));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - lfade * 0.22 * pow(abs(lp - 0.5) * 2.0, 3.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float hh = lfade * uLayer * 0.45 * (1.0 - pow(abs(lp - 0.5) * 2.0, 2.0));
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float hx = dFdx(hh), hy = dFdy(hh);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 g = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - g);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float band = smoothstep(uPrint - uLayer * 5.0, uPrint, vObj.y) * uHot;
        totalEmissiveRadiance += uHotColor * band * 2.2;
        if (!gl_FrontFacing) {
          diffuseColor.rgb = mix(diffuseColor.rgb * 0.55, uHotColor, uHot);
          totalEmissiveRadiance += uHotColor * uHot * 1.1;
        }`);
  };
  return m;
}

/* ---------------------------------------------------------------
   Geometry builders (all baked so the model's base sits at y = 0)
---------------------------------------------------------------- */
function bake(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1 } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
  return g.applyMatrix4(m);
}
function lathe(points, segs, { twist = 0, h = 1 } = {}) {
  const g = new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segs);
  if (twist) {
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const a = twist * v.y / h, c = Math.cos(a), s = Math.sin(a);
      p.setXYZ(i, v.x * c - v.z * s, v.y, v.x * s + v.z * c);
    }
  }
  g.computeVertexNormals();
  return g;
}
// thick-walled vase: outside up, across the rim, inside down
function vase({ h = 2.4, r = 0.8, segs = 10, twist = 1.4, wall = 0.05,
  ctrl = [[0.52, 0], [0.74, 0.15], [0.9, 0.38], [0.74, 0.64], [0.46, 0.84], [0.58, 1]] } = {}) {
  const curve = new THREE.SplineCurve(ctrl.map(([x, y]) => new THREE.Vector2(x * r, y * h)));
  const outer = curve.getSpacedPoints(80).map(p => [p.x, p.y]);
  outer[0][1] = 0; outer[outer.length - 1][1] = h;
  const inner = outer.slice().reverse().filter(p => p[1] > wall * 1.6).map(([x, y]) => [Math.max(x - wall, 0.002), y]);
  const pts = [[0, 0], ...outer, ...inner, [0, wall * 1.6]];
  const geo = lathe(pts, segs, { twist, h });
  const radius = y => {
    for (let i = 1; i < outer.length; i++) if (outer[i][1] >= y) {
      const [x0, y0] = outer[i - 1], [x1, y1] = outer[i];
      return lerp(x0, x1, (y - y0) / Math.max(1e-6, y1 - y0));
    }
    return outer[outer.length - 1][0];
  };
  return { geo, radius, h, twist };
}
function roundedRect(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function extrudeUp(shape, depth, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 10, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2); g.translate(0, bevel, 0);
  return g;
}
function tray(w, d, h, t = 0.05, r = 0.12) {
  const s = roundedRect(w, d, r);
  const hole = roundedRect(w - 2 * t, d - 2 * t, Math.max(0.02, r - t));
  s.holes.push(new THREE.Path(hole.getPoints(12)));
  return [extrudeUp(s, h), extrudeUp(roundedRect(w, d, r), t)];
}
function gearShape(teeth, rOut, rIn, hole) {
  const s = new THREE.Shape(), step = Math.PI * 2 / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    [[rIn, a], [rOut, a + step * 0.18], [rOut, a + step * 0.42], [rIn, a + step * 0.6]].forEach(([r, t], j) => {
      const x = Math.cos(t) * r, y = Math.sin(t) * r;
      i === 0 && j === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
    });
  }
  s.closePath();
  const hp = new THREE.Path(); hp.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(hp);
  return s;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const peiTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#B98A2E'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,220,150' : '90,55,10'},${Math.random() * .25})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2) }
});
const glowTex = () => canvasTex(128, 128, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(255,220,180,1)'); r.addColorStop(.25, 'rgba(255,130,50,.6)'); r.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});
const shadowTex = () => canvasTex(256, 256, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.6)'); r.addColorStop(.5, 'rgba(0,0,0,.25)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});
const bedTex = () => canvasTex(1024, 1024, (g, w) => {
  g.fillStyle = '#18242f'; g.fillRect(0, 0, w, w);
  for (let i = 0; i < 14000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * .035})`; g.fillRect(Math.random() * w, Math.random() * w, 2, 2) }
  g.strokeStyle = 'rgba(120,170,200,.12)'; g.lineWidth = 2;
  for (let x = 64; x < w; x += 64) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, w - 40); g.stroke(); g.beginPath(); g.moveTo(40, x); g.lineTo(w - 40, x); g.stroke() }
  g.strokeStyle = 'rgba(0,165,184,.45)'; g.lineWidth = 4; g.strokeRect(40, 40, w - 80, w - 80);
  g.fillStyle = 'rgba(234,240,244,.28)'; g.font = '600 46px Unbounded, sans-serif'; g.fillText('3Dway', 64, w - 70);
});

/* ---------------------------------------------------------------
   Product models for thumbnails and the viewer
---------------------------------------------------------------- */
function buildProduct(p) {
  const shared = { uPrint: { value: 1e4 }, uHot: { value: 0 } };
  const group = new THREE.Group(), mats = [];
  const digital = p.type === 'digital';
  const col = new THREE.Color(p.color || '#00A5B8');
  const mk = (o = {}) => { const m = printMaterial({ color: col, lines: digital ? 1 : 0, layer: 0.016, rough: digital ? 0.48 : 0.32, clear: digital ? 0.25 : 0, metal: digital ? 0 : 0.6, ...o }, shared); mats.push(m); return m };
  const add = (geo, mat) => { group.add(new THREE.Mesh(geo, mat)); };
  const name = (p.name || '').toLowerCase();
  const shape = p.shape || 'cube';

  if (/dragon|articulated/.test(name)) {
    // articulated, print-in-place body: chain of linked segments on an S curve
    const m = mk(), m2 = mk({ color: col.clone().offsetHSL(0, 0, 0.12) });
    const curve = new THREE.CatmullRomCurve3([[-1.3, 0, .6], [-.6, 0, .9], [.1, 0, .3], [-.1, 0, -.4], [.6, 0, -.8], [1.3, 0, -.3]].map(a => new THREE.Vector3(...a)));
    const n = 24;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), pt = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const sc = lerp(.55, 1.2, Math.pow(t, 1.3));
      const ang = Math.atan2(-tg.z, tg.x);
      add(bake(new RoundedBoxGeometry(.24 * sc, .3 * sc, .42 * sc, 2, .06 * sc), { x: pt.x, y: .15 * sc, z: pt.z, ry: ang }), i % 2 ? m2 : m);
      if (i % 2 === 0) add(bake(new THREE.ConeGeometry(.06 * sc, .16 * sc, 4), { x: pt.x, y: .3 * sc + .08 * sc, z: pt.z, ry: ang + .78 }), m2);
    }
    const end = curve.getPointAt(1), tg = curve.getTangentAt(1), ang = Math.atan2(-tg.z, tg.x);
    const hx = end.x + tg.x * .3, hz = end.z + tg.z * .3;
    add(bake(new RoundedBoxGeometry(.52, .4, .5, 3, .12), { x: hx, y: .22, z: hz, ry: ang }), m);
    add(bake(new RoundedBoxGeometry(.36, .22, .34, 3, .08), { x: hx + tg.x * .36, y: .16, z: hz + tg.z * .36, ry: ang }), m2);
    for (const side of [-1, 1]) {
      const nx = -tg.z * side * .15, nz = tg.x * side * .15;
      add(bake(new THREE.ConeGeometry(.07, .38, 6), { x: hx + nx - tg.x * .12, y: .55, z: hz + nz - tg.z * .12, rx: -tg.z * side * .5, rz: tg.x * side * .5 - .3 }), m2);
    }
  } else if (/chess/.test(name)) {
    const m = mk(), dark = mk({ color: new THREE.Color('#E8EEF2') });
    const king = [[0, 0], [.42, 0], [.42, .08], [.34, .14], [.36, .2], [.24, .28], [.17, .7], [.28, .78], [.28, .84], [.15, .9], [.2, 1.12], [.12, 1.22], [.04, 1.26], [0, 1.26]];
    const pawn = [[0, 0], [.34, 0], [.34, .07], [.27, .12], [.28, .17], [.17, .24], [.12, .5], [.22, .56], [.1, .6], [.17, .66], [.2, .76], [.16, .88], [.06, .94], [0, .95]];
    add(lathe(king, 40), m);
    add(bake(new THREE.BoxGeometry(.05, .22, .05), { y: 1.32 }), m);
    add(bake(new THREE.BoxGeometry(.18, .05, .05), { y: 1.34 }), m);
    add(bake(lathe(pawn, 40), { x: .85, z: .25 }), dark);
    add(bake(lathe(pawn, 40), { x: -.7, z: .55, s: .9 }), m);
  } else if (shape === 'vase') {
    const v = vase({ h: 1.7, r: .62, segs: 9, twist: 1.6, wall: .04 });
    add(v.geo, mk({ flat: true }));
    const v2 = vase({ h: 1.05, r: .42, segs: 48, twist: 0, wall: .03, ctrl: [[.6, 0], [.95, .3], [.85, .6], [.5, .85], [.62, 1]] });
    add(bake(v2.geo, { x: .9, z: .45 }), mk({ color: col.clone().offsetHSL(.04, 0, .1) }));
  } else if (shape === 'nozzle') {
    const brass = mk({ metal: .95, rough: .28, lines: 0 });
    const one = (x, z, s) => {
      add(bake(lathe([[0, 0], [.04, 0], [.07, .05], [.26, .32], [.26, .36], [0, .36]], 36), { x, z, s }), brass);
      add(bake(new THREE.CylinderGeometry(.33, .33, .28, 6), { x, z, y: .5 * s, s }), brass);
      const th = []; for (let i = 0; i <= 14; i++) th.push([i % 2 ? .2 : .23, .64 + i * .035]);
      add(bake(lathe([[0, .64], ...th, [0, .64 + 14 * .035]], 36), { x, z, s }), brass);
    };
    one(-.75, .2, 1); one(0, -.3, 1.15); one(.75, .25, .9);
  } else if (shape === 'gear' && /driver|tmc|stepper/.test(name)) {
    const board = mk({ color: col, metal: .1, rough: .6 }), chip = mk({ color: new THREE.Color('#151a20'), metal: .1, rough: .5 });
    const sink = mk({ color: new THREE.Color('#c9d2dc'), metal: .9, rough: .3 }), gold = mk({ color: new THREE.Color('#d9a83a'), metal: 1, rough: .3 });
    const unit = (x, z) => {
      add(bake(new RoundedBoxGeometry(.8, .06, 1.2, 2, .02), { x, y: .03, z }), board);
      add(bake(new THREE.BoxGeometry(.32, .06, .32), { x, y: .09, z }), chip);
      for (let i = 0; i < 6; i++) add(bake(new THREE.BoxGeometry(.04, .36, .4), { x: x - .15 + i * .06, y: .3, z }), sink);
      add(bake(new THREE.BoxGeometry(.42, .02, .44), { x, y: .13, z }), sink);
      for (let i = 0; i < 8; i++) for (const sx of [-.34, .34]) add(bake(new THREE.CylinderGeometry(.02, .02, .22, 6), { x: x + sx, y: -.05 + .11, z: z - .49 + i * .14 }), gold);
    };
    unit(-.5, 0); unit(.55, .3);
  } else if (shape === 'gear') {
    const m = mk({ metal: .55, rough: .3 }), steel = mk({ color: new THREE.Color('#c9d2dc'), metal: .95, rough: .25 });
    add(extrudeUp(gearShape(22, .95, .82, .22), .28, .02), m);
    add(lathe([[.22, 0], [.34, 0], [.34, .5], [.22, .5]], 40), steel);
    add(bake(extrudeUp(gearShape(12, .52, .4, .12), .28, .02), { x: 1.38, z: .1, ry: .13 }), m);
    add(bake(new THREE.CylinderGeometry(.12, .12, .8, 24), { x: 1.38, y: .4, z: .1 }), steel);
  } else if (shape === 'plate') {
    const pei = printMaterial({ color: new THREE.Color('#ffffff'), lines: 0, rough: .55, metal: .4 }, shared);
    pei.map = peiTex(); mats.push(pei);
    add(new RoundedBoxGeometry(2.4, .06, 2.4, 3, .025), mk({ metal: .2, rough: .6 }));
    add(bake(new RoundedBoxGeometry(2.36, .05, 2.36, 3, .02), { y: .07 }), pei);
    const v = vase({ h: .8, r: .3, segs: 8, twist: 1.2, wall: .03 });
    add(bake(v.geo, { x: .3, y: .095, z: .2 }), printMaterial({ color: TEAL, layer: .014, flat: true, rough: .45, clear: .2 }, shared));
  } else {
    // modular organizer: a tray and a tall cup
    const m = mk(), m2 = mk({ color: col.clone().offsetHSL(0, -.05, .14) });
    tray(1.5, 1.0, .5).forEach(g => add(bake(g, { x: -.3, z: .25 }), m));
    tray(.6, .6, 1.15, .05, .1).forEach(g => add(bake(g, { x: .82, z: -.25 }), m2));
    tray(.7, .45, .28, .04, .08).forEach(g => add(bake(g, { x: -.35, z: -.6 }), m2));
  }
  const box = new THREE.Box3().setFromObject(group);
  return { group, mats, shared, box, height: box.max.y, digital };
}
function fitCamera(cam, box, az = .7, el = .55, pad = 1.08) {
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const d = sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov) / 2) * pad;
  const c = sphere.center;
  cam.position.set(c.x + d * Math.cos(el) * Math.sin(az), c.y + d * Math.sin(el), c.z + d * Math.cos(el) * Math.cos(az));
  cam.lookAt(c); cam.near = d / 20; cam.far = d * 6; cam.updateProjectionMatrix();
  return c;
}
function lights(scene) {
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x3fd3e4, 1.4); rim.position.set(4, 2.5, -4); scene.add(rim);
  const warm = new THREE.DirectionalLight(0xffb27a, .5); warm.position.set(3, -1, 3); scene.add(warm);
}

/* ---------------------------------------------------------------
   Boot
---------------------------------------------------------------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { console.warn('WebGL unavailable, using flat illustrations.', e); }

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const stage = $('#stage');
  stage.appendChild(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), .04).texture;

  /* ---------- Hero scene ---------- */
  const scene = new THREE.Scene();
  scene.environment = envTex;
  scene.fog = new THREE.Fog(0x0E1B28, 10, 24);
  lights(scene);
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  const printer = new THREE.Group(), table = new THREE.Group();
  printer.add(table); scene.add(printer);

  // floor grid
  const grid = new THREE.GridHelper(40, 80, 0x2b4a66, 0x1d3348);
  grid.material.transparent = true; grid.material.opacity = .5; grid.position.y = -.12; scene.add(grid);
  // build plate + volume
  const bed = new THREE.Mesh(new RoundedBoxGeometry(3, .12, 3, 3, .04),
    new THREE.MeshStandardMaterial({ map: bedTex(), roughness: .8, metalness: .1, envMapIntensity: .25 }));
  bed.position.y = -.06; table.add(bed);
  const vol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3, 3.3, 3)),
    new THREE.LineBasicMaterial({ color: 0x3fd3e4, transparent: true, opacity: .14 }));
  vol.position.y = 1.65; table.add(vol);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .002; table.add(shadow);

  // the model: faceted spiral vase, cut into slabs so the story can explode it
  const V = vase({ h: 2.4, r: .82, segs: 10, twist: 1.5, wall: .055 });
  const heroShared = { uPrint: { value: 0 }, uHot: { value: 0 } };
  const N = 16, slabs = [], heroMats = [];
  for (let i = 0; i < N; i++) {
    const m = printMaterial({ color: TEAL.clone(), flat: true, rough: .5, clear: .12, layer: .02, env: .7,
      min: i === 0 ? -1e4 : i * V.h / N, max: i === N - 1 ? 1e4 : (i + 1) * V.h / N }, heroShared);
    const mesh = new THREE.Mesh(V.geo, m);
    slabs.push(mesh); heroMats.push(m); table.add(mesh);
  }
  // the mesh, as the STL file would show it
  const wireMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScan: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#3FD3E4') } },
    vertexShader: 'varying float vy; void main(){ vy = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uScan, uOpacity; uniform vec3 uColor; varying float vy;
      void main(){ if (vy > uScan) discard; float e = smoothstep(uScan - .18, uScan, vy);
      gl_FragColor = vec4(mix(uColor, vec3(1.0), e), uOpacity * (.45 + .55 * e)); }`
  });
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(V.geo), wireMat);
  table.add(wire);

  // hot end
  const hotend = new THREE.Group();
  const alu = new THREE.MeshStandardMaterial({ color: 0xc3ccd6, metalness: 1, roughness: .32 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd2a23c, metalness: 1, roughness: .25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2733, metalness: .2, roughness: .55 });
  const he = (g, m, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(0, y, z); hotend.add(o); return o };
  he(lathe([[0, 0], [.025, 0], [.04, .03], [.1, .12], [.1, .16], [0, .16]], 24), brass);
  he(new THREE.CylinderGeometry(.12, .12, .06, 6), brass, .19);
  he(new RoundedBoxGeometry(.44, .22, .32, 2, .03), alu, .33);
  he(new THREE.CylinderGeometry(.035, .035, .16, 12), alu, .5);
  for (let i = 0; i < 7; i++) he(new THREE.CylinderGeometry(.17, .17, .025, 28), alu, .56 + i * .055);
  he(new RoundedBoxGeometry(.56, .56, .14, 3, .05), dark, .78, .26);
  const fanRing = he(new THREE.RingGeometry(.15, .2, 40), new THREE.MeshBasicMaterial({ color: 0x00a5b8 }), .78, .335);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(.55); hotend.add(glow);
  const hotLight = new THREE.PointLight(0xff7a2e, 0, 3.2, 1.6); hotLight.position.y = .02; hotend.add(hotLight);
  printer.add(hotend);
  fanRing.material.toneMapped = false;

  /* ---------- State ---------- */
  const base = { print: 0, hot: 0, wire: 0, scan: 0, park: 1, spin: 0 };
  let intro = null, storyP = 0, theta = 0, mobile = false;
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  const scrubUI = { root: $('#scrub'), track: $('#track'), fill: $('#fill'), thumb: $('#sthumb'), n: $('#layerN'), h: $('#layerH'), t: $('#layerT') };
  const LAYERS = 240, MODEL_MM = 48;

  function endIntro(finish) { if (intro) { finish ? intro.progress(1) : intro.kill(); intro = null } }
  if (REDUCE || !window.gsap) Object.assign(base, { print: 1, hot: 0, wire: 0, scan: 1, park: 1, spin: 0 });
  else {
    intro = gsap.timeline({ delay: .25, onComplete: () => { intro = null } })
      .to(base, { wire: 1, duration: .5 }, 0)
      .to(base, { scan: 1, duration: 1.5, ease: 'power2.inOut' }, 0)
      .to(base, { park: 0, duration: .9, ease: 'power3.inOut' }, .9)
      .to(base, { hot: 1, duration: .5 }, 1.2)
      .to(base, { print: 1, duration: 5.4, ease: 'power1.inOut' }, 1.5)
      .to(base, { wire: 0, duration: 3.6, ease: 'power1.in' }, 2.6)
      .to(base, { hot: 0, duration: 1.6 }, 6.9)
      .to(base, { park: 1, duration: 1.3, ease: 'power2.inOut' }, 7)
      .to(base, { spin: .14, duration: 2.5 }, 7.2);
  }

  /* ---------- Layer scrubber ---------- */
  let idle, dragging = false;
  function userScrub(v) {
    v = clamp(v);
    if (intro) { endIntro(); base.scan = 1 }
    const g = window.gsap;
    if (g) { g.killTweensOf(base); g.to(base, { wire: 0, park: 0, hot: 1, spin: 0, duration: .35, overwrite: 'auto' }) }
    else Object.assign(base, { wire: 0, park: 0, hot: 1, spin: 0 });
    base.print = v;
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (dragging) return;
      const done = base.print > .995;
      if (g) g.to(base, { hot: 0, duration: 1.3, park: done ? 1 : 0, spin: done && !REDUCE ? .14 : 0 });
      else Object.assign(base, { hot: 0, park: done ? 1 : 0 });
    }, 900);
  }
  const fromPointer = e => { const r = scrubUI.track.getBoundingClientRect(); userScrub(1 - (e.clientY - r.top) / r.height) };
  scrubUI.track.addEventListener('pointerdown', e => { dragging = true; scrubUI.track.setPointerCapture(e.pointerId); fromPointer(e) });
  scrubUI.track.addEventListener('pointermove', e => { if (dragging) fromPointer(e) });
  const up = () => { if (dragging) { dragging = false; userScrub(base.print) } };
  scrubUI.track.addEventListener('pointerup', up); scrubUI.track.addEventListener('pointercancel', up);
  scrubUI.track.addEventListener('keydown', e => {
    const step = { ArrowUp: 4, ArrowRight: 4, ArrowDown: -4, ArrowLeft: -4, PageUp: 24, PageDown: -24 }[e.key];
    if (step) { e.preventDefault(); userScrub(base.print + step / LAYERS) }
    else if (e.key === 'Home') { e.preventDefault(); userScrub(0) }
    else if (e.key === 'End') { e.preventDefault(); userScrub(1) }
  });
  scrubUI.t.textContent = LAYERS;
  scrubUI.root.hidden = false;

  addEventListener('pointermove', e => { ptr.x = e.clientX / innerWidth - .5; ptr.y = e.clientY / innerHeight - .5 }, { passive: true });

  /* ---------- Layout ---------- */
  const how = $('#how'), sheet = $('.sheet');
  let tableX = 1.5, dist = 8.6, targetY = 1.15;
  function layout() {
    const w = innerWidth, h = innerHeight;
    mobile = w < 720;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    tableX = mobile ? 0 : w < 1100 ? 1.2 : 1.75;
    dist = mobile ? 14 : w / h < 1.3 ? 10.5 : 9.2;
    targetY = mobile ? -.35 : 1.1;
  }
  addEventListener('resize', layout); layout();

  /* ---------- Frame ---------- */
  const clock = new THREE.Clock(), tmp = new THREE.Vector3(), park = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), .05);

    // scroll progress through the story section
    const vh = innerHeight, r = how.getBoundingClientRect();
    const target = clamp((vh * .6 - r.top) / (r.height - vh * .4));
    storyP += (target - storyP) * Math.min(1, dt * 5);
    if (storyP > .002 && intro) endIntro(true);
    const covered = sheet.getBoundingClientRect().top <= 0;
    stage.classList.toggle('off', covered);
    if (covered) return;

    // effective state = hero state blended into the story
    const p = storyP;
    const a = smooth(.02, .3, p), b = smooth(.36, .6, p), c = smooth(.68, .92, p), e0 = smooth(0, .06, p);
    const S = {
      print: clamp(lerp(base.print, 0, a) + b),
      wire: lerp(base.wire, 1, a) * (1 - b),
      scan: lerp(base.scan, 1, e0),
      hot: clamp(lerp(base.hot, 0, e0) + Math.sin(a * Math.PI) * .9 * (1 - b) + Math.sin(c * Math.PI) * .75),
      park: lerp(base.park, 1, e0),
      explode: b * (1 - c),
      tint: c
    };

    // model
    heroShared.uPrint.value = S.print * V.h + (S.print >= .999 ? 1 : 0);
    heroShared.uHot.value = S.hot;
    tint.copy(TEAL).lerp(ORANGE, S.tint);
    slabs.forEach((s, i) => {
      s.position.y = i * .17 * S.explode;
      s.rotation.y = (i - N / 2) * .06 * S.explode;
      heroMats[i].color.copy(tint);
    });
    wireMat.uniforms.uScan.value = S.scan * (V.h + .2) - .1;
    wireMat.uniforms.uOpacity.value = S.wire * .8;
    wire.visible = S.wire > .01;
    shadow.material.opacity = .5 + .5 * S.print;
    table.rotation.y += base.spin * dt;

    // hot end follows the perimeter at the current layer
    const H = S.print * V.h;
    if (S.hot > .02 && S.park < .98) theta += dt * 9;
    const rr = V.radius(Math.min(H, V.h)) + .02, tw = V.twist * H / V.h;
    tmp.set(Math.cos(theta + tw) * rr, H + .01, Math.sin(theta + tw) * rr).applyAxisAngle(Y, table.rotation.y);
    park.set(.2, V.h + 1.5 + S.explode * 1.2, -.5);
    const k = S.park * S.park * (3 - 2 * S.park);
    hotend.position.lerpVectors(tmp, park, k);
    hotLight.intensity = S.hot * 4 * (1 - k);
    glow.material.opacity = S.hot * (1 - k);
    glow.scale.setScalar(.45 + Math.sin(performance.now() / 70) * .04);

    // scrubber readout
    if (p < .05) {
      const pr = S.print, n = Math.round(pr * LAYERS);
      scrubUI.fill.style.height = pr * 100 + '%';
      scrubUI.thumb.style.bottom = pr * 100 + '%';
      scrubUI.n.textContent = n; scrubUI.h.textContent = (pr * MODEL_MM).toFixed(1);
      scrubUI.track.setAttribute('aria-valuenow', n);
      scrubUI.track.setAttribute('aria-valuetext', `Layer ${n} of ${LAYERS}`);
    }

    // camera: slow orbit per story step + pointer parallax
    ptr.sx += (ptr.x - ptr.sx) * Math.min(1, dt * 3); ptr.sy += (ptr.y - ptr.sy) * Math.min(1, dt * 3);
    const az = -.42 + a * .55 + b * .55 - c * 1.05 + ptr.sx * .25;
    const el = .2 + b * .2 - c * .1 + ptr.sy * .12;
    const d = dist * (1 + b * .1 - c * .1);
    printer.position.x = tableX;
    const ty = targetY + S.explode * 1.1;
    camera.position.set(d * Math.cos(el) * Math.sin(az), ty + d * Math.sin(el), d * Math.cos(el) * Math.cos(az));
    camera.lookAt(0, ty, 0);

    renderer.render(scene, camera);
  }
  frame();

  /* ---------- Thumbnails + product viewer ---------- */
  const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  tr.setPixelRatio(1); tr.setSize(640, 640, false);
  tr.toneMapping = THREE.ACESFilmicToneMapping; tr.toneMappingExposure = 1.1;
  const tScene = new THREE.Scene(); tScene.environment = new THREE.PMREMGenerator(tr).fromScene(new RoomEnvironment(tr), .04).texture; lights(tScene);
  const tCam = new THREE.PerspectiveCamera(28, 1, .1, 100);
  const tShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }));
  tShadow.rotation.x = -Math.PI / 2;
  const cache = new Map();
  const keyOf = p => `${p.id}|${p.shape}|${p.color}|${p.type}|${p.name}`;
  function thumb(p) {
    const k = keyOf(p);
    if (cache.has(k)) return cache.get(k);
    let url = null;
    try {
      const M = buildProduct(p);
      tScene.add(M.group);
      const size = M.box.getSize(tmp); tShadow.scale.set(size.x * 1.6, size.z * 1.6, 1); tShadow.position.set(...M.box.getCenter(new THREE.Vector3()).toArray()); tShadow.position.y = .001;
      tScene.add(tShadow);
      fitCamera(tCam, M.box, .75, .52, 1.02);
      tr.render(tScene, tCam);
      url = tr.domElement.toDataURL('image/webp', .9);
      if (!url.startsWith('data:image/webp')) url = tr.domElement.toDataURL('image/png');
      tScene.remove(M.group, tShadow);
      M.group.traverse(o => { if (o.geometry) o.geometry.dispose() }); M.mats.forEach(m => m.dispose());
    } catch (err) { console.warn('3D thumbnail failed', err) }
    cache.set(k, url);
    return url;
  }

  // one shared viewer renderer, moved into whichever dialog is open
  let VW = null;
  function mountViewer(el, p) {
    unmountViewer();
    if (!VW) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
      const s = new THREE.Scene(); s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(r), .04).texture; lights(s);
      const cam = new THREE.PerspectiveCamera(30, 1, .1, 100);
      const ctl = new OrbitControls(cam, r.domElement);
      ctl.enableDamping = true; ctl.autoRotateSpeed = 1.6; ctl.enablePan = false;
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; s.add(sh);
      VW = { r, s, cam, ctl, sh, raf: 0, model: null, ro: null, tween: null };
    }
    const M = buildProduct(p);
    VW.model = M; VW.s.add(M.group);
    const size = M.box.getSize(new THREE.Vector3()), center = M.box.getCenter(new THREE.Vector3());
    VW.sh.scale.set(size.x * 1.7, size.z * 1.7, 1); VW.sh.position.set(center.x, .001, center.z);
    const c = fitCamera(VW.cam, M.box, .75, .45, 1.15);
    VW.ctl.target.copy(c); VW.ctl.autoRotate = !REDUCE;
    VW.ctl.minDistance = VW.cam.position.distanceTo(c) * .45; VW.ctl.maxDistance = VW.cam.position.distanceTo(c) * 2.2;
    VW.ctl.update();
    el.appendChild(VW.r.domElement);
    el.insertAdjacentHTML('beforeend', `<span class="vhint">Drag to turn it around</span>`);

    // digital files: preview the print layer by layer
    if (M.digital) {
      const layers = Math.round(M.height / 0.016);
      el.insertAdjacentHTML('beforeend', `<div class="vctl"><label for="vl">Layers</label><input type="range" id="vl" min="0" max="${layers}" value="${layers}"><output id="vo">${layers} of ${layers}</output></div>`);
      const inp = el.querySelector('#vl'), out = el.querySelector('#vo');
      const set = (n, hot) => { M.shared.uPrint.value = n >= layers ? 1e4 : n * .016; M.shared.uHot.value = hot; inp.value = n; out.textContent = `${Math.round(n)} of ${layers}` };
      inp.addEventListener('input', () => { if (VW.tween) VW.tween.kill(); set(+inp.value, +inp.value < layers ? 1 : 0) });
      if (!REDUCE && window.gsap) {
        const st = { n: 0 };
        set(0, 1);
        VW.tween = gsap.to(st, { n: layers, duration: 2.2, ease: 'power1.inOut', onUpdate: () => set(st.n, 1), onComplete: () => gsap.to(M.shared.uHot, { value: 0, duration: .8 }) });
      }
    }
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; VW.r.setSize(w, h, false); VW.cam.aspect = w / h; VW.cam.updateProjectionMatrix() };
    VW.ro = new ResizeObserver(resize); VW.ro.observe(el); resize();
    const loop = () => { VW.raf = requestAnimationFrame(loop); VW.ctl.update(); VW.r.render(VW.s, VW.cam) };
    loop();
    // drop the static poster once the live view is drawing
    requestAnimationFrame(() => el.querySelectorAll(':scope > img, :scope > svg').forEach(n => n.remove()));
  }
  function unmountViewer() {
    if (!VW || !VW.model) return;
    cancelAnimationFrame(VW.raf);
    if (VW.tween) { VW.tween.kill(); VW.tween = null }
    if (VW.ro) VW.ro.disconnect();
    VW.s.remove(VW.model.group);
    VW.model.group.traverse(o => { if (o.geometry) o.geometry.dispose() }); VW.model.mats.forEach(m => m.dispose());
    VW.model = null;
    VW.r.domElement.remove();
  }

  window.STORE3D = { thumb, mountViewer, unmountViewer };
  dispatchEvent(new Event('store3d:ready'));
}
