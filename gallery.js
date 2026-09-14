import * as THREE from "three";

// ---------------------------------------------------------------------------
// Artworks — all public domain. `size` scales each piece relative to the base
// painting height, so large canvases hang a little bigger than small ones.
// ---------------------------------------------------------------------------
const ARTWORKS = [
  { file: "starry-night", title: "The Starry Night", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas", size: 0.74 },
  { file: "white-on-white", title: "Suprematist Composition: White on White", artist: "Kazimir Malevich", year: "1918", medium: "Oil on canvas", size: 0.72 },
  { file: "picture-with-an-archer", title: "Picture with an Archer", artist: "Vasily Kandinsky", year: "1909", medium: "Oil on canvas", size: 0.92 },
  { file: "seed-of-the-areoi", title: "The Seed of the Areoi", artist: "Paul Gauguin", year: "1892", medium: "Oil on burlap", size: 0.8 },
  { file: "evening-honfleur", title: "Evening, Honfleur", artist: "Georges-Pierre Seurat", year: "1886", medium: "Oil on canvas, with painted frame", size: 0.72 },
  { file: "the-dream", title: "The Dream", artist: "Henri Rousseau", year: "1910", medium: "Oil on canvas", size: 0.84 },
  { file: "joseph-roulin", title: "Portrait of Joseph Roulin", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas", size: 0.66 },
  { file: "still-life-with-apples", title: "Still Life with Apples", artist: "Paul Cézanne", year: "1895–98", medium: "Oil on canvas", size: 0.64 },
  { file: "hope-ii", title: "Hope, II", artist: "Gustav Klimt", year: "1907–08", medium: "Oil, gold, and platinum on canvas", size: 0.84 },
  { file: "the-storm", title: "The Storm", artist: "Edvard Munch", year: "1893", medium: "Oil on canvas", size: 0.76 },
  { file: "the-bather", title: "The Bather", artist: "Paul Cézanne", year: "c. 1885", medium: "Oil on canvas", size: 0.9 },
  { file: "felix-feneon", title: "Portrait of Félix Fénéon", artist: "Paul Signac", year: "1890", medium: "Oil on canvas", size: 0.7 },
  { file: "the-city-rises", title: "The City Rises", artist: "Umberto Boccioni", year: "1910", medium: "Oil on canvas", size: 0.82 },
  { file: "olive-trees", title: "The Olive Trees", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas", size: 0.7 },
  { file: "sleeping-gypsy", title: "The Sleeping Gypsy", artist: "Henri Rousseau", year: "1897", medium: "Oil on canvas", size: 0.8 },
];

// ---------------------------------------------------------------------------
// The room. Works travel along a U-shaped wall: the left wall runs from beside
// the camera to the back, a rounded corner turns onto a flat back wall, and a
// second corner leads onto the right wall coming back toward the camera.
// Sizes are multiples of the average painting width, so the room scales with
// the viewport.
// ---------------------------------------------------------------------------
const TUNE = {
  cameraZ: 2000,          // camera distance; FOV is set so 1 unit = 1px at z = 0
  paintingHeight: 0.6,    // base painting height as a fraction of viewport height…
  paintingHeightMax: 560, // …capped at this many px
  roomWidth: 2.3,         // back wall width (× average painting width)
  roomDepth: 4.5,         // how far the back wall sits behind the focal plane
  cornerRadius: 0.75,     // rounded corner radius
  sideScale: 1.25,        // side walls stretch works in depth for stronger foreshortening
  gap: 0.6,               // space between works
  labelHeight: 0.24,      // caption block height (× base painting height)
  labelGap: 0.04,
  drift: 14,              // idle drift, px / second (0 to disable)
};

const SEGMENTS = 96; // vertical strips per painting — enough to bend smoothly around corners

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const root = document.getElementById("gallery");
const canvas = document.getElementById("scene");
const hint = document.getElementById("hint");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setClearColor(0xffffff, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
camera.position.set(0, 0, TUNE.cameraZ);
camera.lookAt(0, 0, 0);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

function makeStrip(transparent) {
  const geo = new THREE.PlaneGeometry(1, 1, SEGMENTS, 1);
  geo.getAttribute("position").setUsage(THREE.DynamicDrawUsage);
  geo.getAttribute("uv").setUsage(THREE.DynamicDrawUsage);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent, depthWrite: !transparent });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // vertices move every frame, so the bounding sphere would be stale
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Path geometry
// ---------------------------------------------------------------------------
let room = null;

function buildRoom({ width, depth, front, radius, sideScale }) {
  radius = Math.max(0, Math.min(radius, width / 2, depth + front));
  const sideLength = (depth + front - radius) / sideScale;
  // Corners are traversed with eased angular speed (see cornerAngle), which
  // changes their path length relative to a plain quarter circle.
  const cornerLength = (Math.PI * radius) / (sideScale + 1);
  const backLength = width - 2 * radius;
  return { width, depth, front, radius, sideScale, sideLength, cornerLength, backLength, length: 2 * sideLength + 2 * cornerLength + backLength };
}

// Angle through a corner for progress t∈[0,1], ending at a quarter turn. The
// angular speed starts proportional to `from` and ends proportional to `to`,
// so motion flows seamlessly out of a (stretched) side wall into the back wall.
function cornerAngle(t, from, to) {
  return (Math.PI * (from * t + (to - from) * (t ** 3 - t ** 4 / 2))) / (from + to);
}

const point = { x: 0, z: 0 };
function pointOnPath(u) {
  const { width, depth, front, radius: r, sideScale: k, sideLength, cornerLength, backLength } = room;
  u = Math.max(0, Math.min(u, room.length));

  if (u <= sideLength) { // left wall, walking away from the camera
    point.x = -width / 2;
    point.z = front - u * k;
    return point;
  }
  u -= sideLength;
  if (u <= cornerLength) { // back-left corner
    const a = cornerAngle(u / cornerLength, k, 1);
    point.x = -width / 2 + r - r * Math.cos(a);
    point.z = -depth + r - r * Math.sin(a);
    return point;
  }
  u -= cornerLength;
  if (u <= backLength) { // back wall
    point.x = -width / 2 + r + u;
    point.z = -depth;
    return point;
  }
  u -= backLength;
  if (u <= cornerLength) { // back-right corner
    const a = cornerAngle(u / cornerLength, 1, k);
    point.x = width / 2 - r + r * Math.sin(a);
    point.z = -depth + r - r * Math.cos(a);
    return point;
  }
  u -= cornerLength;
  point.x = width / 2; // right wall, walking back toward the camera
  point.z = -depth + r + u * k;
  return point;
}

// Bend a strip mesh so it spans [centre - w/2, centre + w/2] along the path.
// Anything hanging off either end of the path is trimmed (UVs follow), so works
// slide in and out past the camera instead of popping.
function layStrip(mesh, centre, w, h, cy) {
  const start = centre - w / 2;
  const a = Math.max(start, 0);
  const b = Math.min(start + w, room.length);
  if (w <= 0 || b <= a || !mesh.material.map) { mesh.visible = false; return; }
  mesh.visible = true;

  const pos = mesh.geometry.getAttribute("position");
  const uv = mesh.geometry.getAttribute("uv");
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = a + ((b - a) * i) / SEGMENTS;
    const p = pointOnPath(u);
    const tu = (u - start) / w;
    pos.setXYZ(i, p.x, cy + h / 2, p.z);
    pos.setXYZ(i + SEGMENTS + 1, p.x, cy - h / 2, p.z);
    uv.setX(i, tu);
    uv.setX(i + SEGMENTS + 1, tu);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
const items = ARTWORKS.map((art) => ({
  art,
  aspect: 1,
  painting: makeStrip(false),
  label: makeStrip(true),
  labelAspect: 4,
  w: 0, h: 0, labelW: 0, labelH: 0, labelCy: 0, stripCentre: 0,
}));
let stripLength = 1;

function labelCanvas(art) {
  const serif = "Newsreader, Georgia, serif";
  const titleFont = `italic 400 44px ${serif}`;
  const bodyFont = `400 44px ${serif}`;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = titleFont;
  let width = measure.measureText(art.title).width;
  measure.font = bodyFont;
  for (const t of [art.artist, art.year, art.medium]) width = Math.max(width, measure.measureText(t).width);

  const W = Math.ceil(width) + 4, H = 262, line = 56;
  const c = document.createElement("canvas");
  c.width = W * 2;
  c.height = H * 2;
  const ctx = c.getContext("2d");
  ctx.scale(2, 2);
  ctx.textBaseline = "top";
  let y = 18;
  ctx.fillStyle = "#404040";
  ctx.font = titleFont;
  ctx.fillText(art.title, 0, y);
  ctx.fillStyle = "#bdbdbd";
  ctx.font = bodyFont;
  for (const t of [art.artist, art.year, art.medium]) { y += line; ctx.fillText(t, 0, y); }
  return c;
}

function prepTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

// ---------------------------------------------------------------------------
// Layout — recomputed on resize and once textures report their aspect ratios.
// ---------------------------------------------------------------------------
let dirty = true;

function layout() {
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  const narrow = vw < 700;
  renderer.setSize(vw, vh, false);
  camera.aspect = vw / vh;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(vh / 2 / TUNE.cameraZ));
  camera.updateProjectionMatrix();

  const base = Math.min(TUNE.paintingHeight * vh, TUNE.paintingHeightMax);
  let total = 0;
  for (const it of items) {
    it.h = base * it.art.size;
    it.w = it.h * it.aspect;
    it.labelH = TUNE.labelHeight * base;
    it.labelW = it.labelH * it.labelAspect;
    it.labelCy = -it.h / 2 - TUNE.labelGap * base - it.labelH / 2;
    total += it.w;
  }
  const avg = total / items.length;

  const width = narrow ? 1.25 * avg : TUNE.roomWidth * avg;
  const depth = narrow ? 3.5 * avg : TUNE.roomDepth * avg;
  // Side walls reach forward past the focal plane; the narrower the back wall is
  // relative to the screen, the further they reach so the edges stay filled.
  const front = Math.max(0, Math.min(TUNE.cameraZ * (1 - width / vw) + 200, 1200));
  room = buildRoom({ width, depth, front, radius: TUNE.cornerRadius * avg, sideScale: TUNE.sideScale });

  let cursor = 0;
  const gap = TUNE.gap * avg;
  for (const it of items) {
    it.stripCentre = cursor + it.w / 2;
    cursor += it.w + gap;
  }
  stripLength = Math.max(cursor, room.length + 2 * avg); // never show the same work twice at once
  dirty = true;
}

// ---------------------------------------------------------------------------
// Motion: wheel target with smoothing, drag with momentum, intro sweep.
// ---------------------------------------------------------------------------
let offset = 0;        // rendered position along the strip (px)
let target = 0;        // where wheel/keys want to go
let velocity = 0;      // fling momentum, px / ms
let dragging = false;
let lastPointer = 0;
let lastMoveTime = 0;
let pointerId = null;
let touched = false;   // any input cancels the intro sweep
let introStart = 0;
let introDone = false;
let idleFor = 0;

function interrupt() {
  touched = true;
  idleFor = 0;
  hint.classList.add("gone");
}

root.addEventListener("wheel", (e) => {
  e.preventDefault();
  interrupt();
  velocity = 0;
  target += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
}, { passive: false });

// Touch: allow either axis to move the wall (phones feel natural scrolling vertically).
function coord(e) {
  return e.pointerType === "touch" ? e.clientX + e.clientY : e.clientX;
}

root.addEventListener("pointerdown", (e) => {
  if (!e.isPrimary || e.button !== 0) return;
  e.preventDefault();
  interrupt();
  dragging = true;
  pointerId = e.pointerId;
  velocity = 0;
  target = offset;
  lastPointer = coord(e);
  lastMoveTime = e.timeStamp;
  root.setPointerCapture(e.pointerId);
  root.classList.add("dragging");
});

window.addEventListener("pointermove", (e) => {
  if (!dragging || e.pointerId !== pointerId) return;
  const events = e.getCoalescedEvents?.() ?? [];
  for (const ev of events.length ? events : [e]) {
    const c = coord(ev);
    const d = (lastPointer - c) * 1.5;
    const dt = Math.max(8, ev.timeStamp - lastMoveTime);
    velocity = THREE.MathUtils.lerp(velocity, THREE.MathUtils.clamp(d / dt, -3, 3), 0.5);
    offset += d;
    lastPointer = c;
    lastMoveTime = ev.timeStamp;
  }
  target = offset;
  idleFor = 0;
  dirty = true;
});

function endDrag(e) {
  if (!dragging || (e && e.pointerId !== pointerId)) return;
  dragging = false;
  // Pausing before letting go kills the fling.
  const held = e ? Math.max(0, e.timeStamp - lastMoveTime - 32) : Infinity;
  velocity = reducedMotion.matches ? 0 : velocity * Math.exp(-held / 120);
  if (pointerId !== null && root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
  pointerId = null;
  root.classList.remove("dragging");
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
window.addEventListener("blur", () => endDrag());

window.addEventListener("keydown", (e) => {
  if (["ArrowRight", "ArrowDown", "PageDown"].includes(e.key)) { interrupt(); target += 160; }
  if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { interrupt(); target -= 160; }
});

new ResizeObserver(layout).observe(root);

let last = performance.now();
function tick(now) {
  const dt = Math.min(64, now - last);
  last = now;

  // Intro: sweep the wall along once, easing out, unless the visitor grabs it.
  if (introStart && !introDone && !touched && now >= introStart) {
    const t = Math.min((now - introStart) / 2400, 1);
    offset = target = 1080 * (1 - Math.pow(1 - t, 3));
    dirty = true;
    if (t >= 1) introDone = true;
  }

  // Fling momentum decays with a ~240ms time constant.
  if (!dragging && Math.abs(velocity) > 0.01) {
    const decay = Math.exp(-dt / 240);
    offset += 240 * velocity * (1 - decay);
    velocity *= decay;
    target = offset;
    dirty = true;
  } else if (!dragging) {
    velocity = 0;
  }

  // Wheel and keys ease toward their target.
  const toTarget = target - offset;
  if (Math.abs(toTarget) > 0.05) { offset += toTarget * 0.18; dirty = true; }

  // Gentle idle drift once everything has settled.
  if (!dragging && (introDone || touched) && TUNE.drift && !reducedMotion.matches) {
    idleFor += dt;
    const ramp = Math.min(1, Math.max(0, idleFor - 2500) / 2000);
    if (ramp > 0) {
      const d = (TUNE.drift * ramp * dt) / 1000;
      offset += d;
      target += d;
      dirty = true;
    }
  }

  if (dirty && room) {
    for (const it of items) {
      let c = (((it.stripCentre - offset) % stripLength) + stripLength) % stripLength;
      // If this lap has carried the work past the end, the previous lap may still be entering.
      if (c - it.w / 2 >= room.length && c - stripLength + it.w / 2 > 0) c -= stripLength;
      layStrip(it.painting, c, it.w, it.h, 0);
      layStrip(it.label, c - it.w / 2 + it.labelW / 2, it.labelW, it.labelH, it.labelCy);
    }
    renderer.render(scene, camera);
    dirty = false;
  }
  requestAnimationFrame(tick);
}

async function start() {
  layout();
  requestAnimationFrame(tick);

  const fontsReady = Promise.all([
    document.fonts.load("italic 400 44px Newsreader"),
    document.fonts.load("400 44px Newsreader"),
  ]).catch(() => {});

  const loader = new THREE.TextureLoader();
  const paintings = Promise.all(items.map((it) =>
    loader.loadAsync(`artworks/${it.art.file}.jpg`).then((tex) => {
      prepTexture(tex);
      it.aspect = tex.image.width / tex.image.height;
      it.painting.material.map = tex;
      it.painting.material.needsUpdate = true;
    })
  ));

  await Promise.all([fontsReady, paintings]);
  for (const it of items) {
    const c = labelCanvas(it.art);
    it.labelAspect = c.width / c.height;
    it.label.material.map = prepTexture(new THREE.CanvasTexture(c));
    it.label.material.needsUpdate = true;
  }
  layout();

  root.classList.add("ready");
  introStart = performance.now() + 700; // let the wall start rising before it sweeps
}

start();
