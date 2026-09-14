import * as THREE from "three";

// ---------------------------------------------------------------------------
// Artworks — all public domain. `cm` is the real height in centimetres and
// drives how big each piece hangs relative to the others.
// ---------------------------------------------------------------------------
const ARTWORKS = [
  { file: "starry-night", title: "The Starry Night", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas", cm: 74 },
  { file: "white-on-white", title: "Suprematist Composition: White on White", artist: "Kazimir Malevich", year: "1918", medium: "Oil on canvas", cm: 79 },
  { file: "picture-with-an-archer", title: "Picture with an Archer", artist: "Vasily Kandinsky", year: "1909", medium: "Oil on canvas", cm: 175 },
  { file: "seed-of-the-areoi", title: "The Seed of the Areoi", artist: "Paul Gauguin", year: "1892", medium: "Oil on burlap", cm: 92 },
  { file: "evening-honfleur", title: "Evening, Honfleur", artist: "Georges-Pierre Seurat", year: "1886", medium: "Oil on canvas, with painted frame", cm: 78 },
  { file: "the-dream", title: "The Dream", artist: "Henri Rousseau", year: "1910", medium: "Oil on canvas", cm: 205 },
  { file: "joseph-roulin", title: "Portrait of Joseph Roulin", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas", cm: 64 },
  { file: "still-life-with-apples", title: "Still Life with Apples", artist: "Paul Cézanne", year: "1895–98", medium: "Oil on canvas", cm: 69 },
  { file: "hope-ii", title: "Hope, II", artist: "Gustav Klimt", year: "1907–08", medium: "Oil, gold, and platinum on canvas", cm: 111 },
  { file: "the-storm", title: "The Storm", artist: "Edvard Munch", year: "1893", medium: "Oil on canvas", cm: 92 },
  { file: "the-bather", title: "The Bather", artist: "Paul Cézanne", year: "c. 1885", medium: "Oil on canvas", cm: 127 },
  { file: "felix-feneon", title: "Portrait of Félix Fénéon", artist: "Paul Signac", year: "1890", medium: "Oil on canvas", cm: 74 },
  { file: "the-city-rises", title: "The City Rises", artist: "Umberto Boccioni", year: "1910", medium: "Oil on canvas", cm: 199 },
  { file: "olive-trees", title: "The Olive Trees", artist: "Vincent van Gogh", year: "1889", medium: "Oil on canvas", cm: 73 },
  { file: "sleeping-gypsy", title: "The Sleeping Gypsy", artist: "Henri Rousseau", year: "1897", medium: "Oil on canvas", cm: 130 },
];

// ---------------------------------------------------------------------------
// Tunables. Works hang on a strip that wraps around the inside of a cylinder;
// the strip is longer than the cylinder's circumference, so pieces loop out of
// sight behind the camera and re-enter on the other side.
// ---------------------------------------------------------------------------
const TUNE = {
  radius: 9,            // cylinder radius (world units)
  baseHeight: 3.1,      // world height of an ~80cm painting
  sizeCurve: 0.42,      // <1 compresses the range between tiny and huge works
  gap: 2.0,             // horizontal space between works
  back: 1.0,            // camera sits this fraction of the radius behind centre
  fov: 72,              // vertical field of view on landscape screens
  lookY: -0.3,
  portraitHFov: 66,     // horizontal field of view on phones
  autoSpeed: 0.16,      // world units / second of idle drift
  friction: 3.2,
};
window.__tune = TUNE; // handy for tweaking from the console, then call __relayout()

const CAPTION_GAP = 0.16;
const CAPTION_HEIGHT = 1.15;
const PX_PER_UNIT = 240;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const root = document.getElementById("gallery");
const canvas = document.getElementById("scene");
const hint = document.getElementById("hint");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setClearColor(0xffffff, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// A plane wrapped onto the inside of a cylinder of radius r, spanning arc
// lengths x0..x1 (measured from the front, right is positive) and heights y0..y1.
function curvedPlane(r, x0, x1, y0, y1) {
  const a0 = x0 / r;
  const a1 = x1 / r;
  const segs = Math.max(4, Math.ceil(((a1 - a0) * 180) / Math.PI / 1.5));
  const geo = new THREE.PlaneGeometry(1, 1, segs, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5;
    const v = pos.getY(i) + 0.5;
    const a = a0 + (a1 - a0) * u;
    pos.setXYZ(i, r * Math.sin(a), y0 + (y1 - y0) * v, -r * Math.cos(a));
  }
  geo.computeVertexNormals();
  return geo;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function captionTexture(art, widthUnits) {
  const w = Math.round(Math.max(widthUnits, 3.4) * PX_PER_UNIT);
  const h = Math.round(CAPTION_HEIGHT * PX_PER_UNIT);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const s = PX_PER_UNIT / 100; // font sizes below are in hundredths of a unit
  ctx.textBaseline = "top";

  ctx.fillStyle = "#1a1a1a";
  ctx.font = `italic 400 ${20 * s}px Newsreader, Georgia, serif`;
  ctx.fillText(art.title, 0, 2 * s, w);

  ctx.fillStyle = "#9a9a9a";
  ctx.font = `400 ${18 * s}px Newsreader, Georgia, serif`;
  const line = 25 * s;
  [art.artist, art.year, art.medium].forEach((t, i) => ctx.fillText(t, 0, 3 * s + line * (i + 1), w));

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return { tex, widthUnits: w / PX_PER_UNIT };
}

const items = [];
let stripLength = 1;
let visibleLimit = Math.PI;

async function build() {
  await Promise.all([
    document.fonts.load("italic 400 20px Newsreader"),
    document.fonts.load("400 20px Newsreader"),
  ]).catch(() => {});

  const images = await Promise.all(ARTWORKS.map((a) => loadImage(`artworks/${a.file}.jpg`)));

  ARTWORKS.forEach((art, i) => {
    const img = images[i];
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    tex.needsUpdate = true;

    const group = new THREE.Group();
    const painting = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ map: tex }));
    const caption = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    group.add(painting, caption);
    scene.add(group);
    items.push({ art, aspect: img.naturalWidth / img.naturalHeight, group, painting, caption, index: i });
  });

  relayout();
  state.offset = items[0].centre + 0.2 * TUNE.radius; // open with the first work just left of centre
  requestAnimationFrame(() => root.classList.add("ready"));
}

// (Re)build geometry from TUNE — sizes, strip positions, captions.
function relayout() {
  const r = TUNE.radius;
  let cursor = 0;
  items.forEach((it) => {
    const h = TUNE.baseHeight * Math.pow(it.art.cm / 80, TUNE.sizeCurve);
    const w = h * it.aspect;
    it.centre = cursor + w / 2;
    cursor += w + TUNE.gap;

    // Gentle vertical rhythm so the wall doesn't read as a strict line.
    const lift = Math.sin(it.index * 2.3) * 0.22;
    const top = h / 2 + lift + 0.45;
    const bottom = top - h;

    it.painting.geometry?.dispose();
    it.painting.geometry = curvedPlane(r, -w / 2, w / 2, bottom, top);

    const cap = it.caption.material.map ? { tex: it.caption.material.map, widthUnits: it.captionWidth } : captionTexture(it.art, w);
    it.caption.material.map = cap.tex;
    it.caption.material.needsUpdate = true;
    it.captionWidth = cap.widthUnits;
    it.caption.geometry?.dispose();
    it.caption.geometry = curvedPlane(r, -w / 2, -w / 2 + cap.widthUnits, bottom - CAPTION_GAP - CAPTION_HEIGHT, bottom - CAPTION_GAP);
  });
  stripLength = cursor;
  resize();
}
window.__relayout = relayout;

// ---------------------------------------------------------------------------
// Camera framing — pulls in on narrow screens so phones still see a few works.
// ---------------------------------------------------------------------------
function resize() {
  const w = root.clientWidth;
  const h = root.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  const r = TUNE.radius;
  const portrait = w / h < 1;
  // On tall screens, step toward the wall and frame by horizontal angle instead.
  const b = portrait ? TUNE.back * 0.3 : TUNE.back;
  camera.position.set(0, 0, r * b);
  // Hide works once they've swung past the camera (their faces are culled from there on),
  // so the jump where the strip wraps is never on screen.
  visibleLimit = Math.min(Math.PI - 0.05, (b > 1 ? Math.acos(-1 / b) : Math.PI - 0.35) + 0.5);
  camera.fov = portrait
    ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(TUNE.portraitHFov / 2)) / camera.aspect))
    : TUNE.fov;
  camera.lookAt(0, TUNE.lookY, -r);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// ---------------------------------------------------------------------------
// Motion: idle drift + drag + wheel, all feeding one velocity along the strip.
// ---------------------------------------------------------------------------
const state = { offset: 0, velocity: 0, dragging: false, lastX: 0, lastT: 0, idleFor: 0 };

// World units along the front wall per screen pixel, so drags track the finger.
function unitsPerPixel() {
  const dist = TUNE.radius + camera.position.z;
  return (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / root.clientHeight;
}

function dismissHint() { hint.classList.add("gone"); }

root.addEventListener("pointerdown", (e) => {
  state.dragging = true;
  state.lastX = e.clientX;
  state.lastT = performance.now();
  state.velocity = 0;
  root.classList.add("dragging");
  root.setPointerCapture(e.pointerId);
  dismissHint();
});
root.addEventListener("pointermove", (e) => {
  if (!state.dragging) return;
  const now = performance.now();
  const dt = Math.max(1, now - state.lastT) / 1000;
  const d = (e.clientX - state.lastX) * unitsPerPixel();
  state.offset -= d;
  state.velocity = THREE.MathUtils.lerp(state.velocity, -d / dt, 0.35);
  state.lastX = e.clientX;
  state.lastT = now;
});
function endDrag(e) {
  if (!state.dragging) return;
  state.dragging = false;
  state.idleFor = 0;
  root.classList.remove("dragging");
  if (performance.now() - state.lastT > 80) state.velocity = 0;
  if (e?.pointerId != null && root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
}
root.addEventListener("pointerup", endDrag);
root.addEventListener("pointercancel", endDrag);

root.addEventListener("wheel", (e) => {
  e.preventDefault();
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  state.velocity += delta * 0.03;
  state.idleFor = 0;
  dismissHint();
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") state.velocity -= 9;
  if (e.key === "ArrowRight") state.velocity += 9;
  if (e.key.startsWith("Arrow")) { state.idleFor = 0; dismissHint(); }
});

const wrap = (x, L) => ((((x + L / 2) % L) + L) % L) - L / 2;

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!state.dragging) {
    state.offset += state.velocity * dt;
    state.velocity *= Math.exp(-TUNE.friction * dt);
    state.idleFor += dt;
    // Ease back into the idle drift once a fling has settled.
    if (!reducedMotion) {
      state.offset += TUNE.autoSpeed * Math.min(1, Math.max(0, state.idleFor - 1.2) / 2) * dt;
    }
  }

  for (const it of items) {
    const angle = wrap(it.centre - state.offset, stripLength) / TUNE.radius;
    it.group.rotation.y = -angle;
    it.group.visible = Math.abs(angle) < visibleLimit;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

resize();
build().then(() => requestAnimationFrame(tick));
