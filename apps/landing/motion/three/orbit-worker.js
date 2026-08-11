/* THE ORBIT, worker side. Classic worker (importScripts) so the 651KB three
   UMD parses OFF the main thread; rendering goes to an OffscreenCanvas. The
   main thread only posts { type: "progress", p } and resize. This is what
   keeps C9 green with WebGL on the page.

   Scene: the seamed paper ball from the original Empower moment, a green
   orbit ring, and 24 coin meshes whose orbit radius, tilt and phase are
   driven by scroll progress, not wall clock. Key light lerps ember to green
   over p 0.52-0.72. */

importScripts("../../vendor/three.min.js");

let renderer = null;
let scene = null;
let camera = null;
let group = null;
let coins = [];
let keyLight = null;
let progress = 0;
let raf = null;
let running = false;

/* palette (mirrors the token set; workers cannot read CSS custom props) */
const PAPER = 0xFBF7F1;
const INK = 0x1C1712;
const EMBER = 0xE46136;
const MARIGOLD = 0xE8B324;
const GREEN = 0x4CAF7D;

function build(canvas, width, height, dpr) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr <= 1, alpha: true, powerPreference: "low-power" });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(1.5, dpr));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  group = new THREE.Group();
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 48, 48),
    new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.55, metalness: 0.05 })
  ));
  const seamMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6 });
  const seam1 = new THREE.Mesh(new THREE.TorusGeometry(1.61, 0.035, 12, 90), seamMat);
  const seam2 = seam1.clone(); seam2.rotation.y = Math.PI / 2;
  const seam3 = seam1.clone(); seam3.rotation.x = Math.PI / 2;
  group.add(seam1, seam2, seam3);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.02, 8, 120),
    new THREE.MeshBasicMaterial({ color: GREEN })
  );
  ring.rotation.x = Math.PI / 2.4;
  group.add(ring);

  /* 24 coins on the orbit */
  const coinGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 20);
  const coinMat = new THREE.MeshStandardMaterial({ color: MARIGOLD, roughness: 0.35, metalness: 0.4 });
  coins = [];
  for (let i = 0; i < 24; i++) {
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.rotation.x = Math.PI / 2;
    coin.visible = false;
    group.add(coin);
    coins.push(coin);
  }

  scene.add(group);
  scene.add(new THREE.AmbientLight(PAPER, 0.55));
  keyLight = new THREE.DirectionalLight(MARIGOLD, 1.4);
  keyLight.position.set(3, 4, 5);
  scene.add(keyLight);
  const rim = new THREE.DirectionalLight(EMBER, 0.9);
  rim.position.set(-4, -2, 3);
  scene.add(rim);
}

const emberColor = { r: 0xE4 / 255, g: 0x61 / 255, b: 0x36 / 255 };
const greenColor = { r: 0x4C / 255, g: 0xAF / 255, b: 0x7D / 255 };

function render() {
  raf = null;
  if (!renderer) { return; }
  const p = progress;

  /* ball: slow idle spin plus progress-driven tilt */
  group.rotation.y += 0.006;
  group.rotation.x = -0.3 + p * 0.5;

  /* coins: appear over p 0.35-0.52, orbit tightens over 0.52-0.72 */
  const coinIn = Math.min(1, Math.max(0, (p - 0.35) / 0.17));
  const tighten = Math.min(1, Math.max(0, (p - 0.52) / 0.2));
  const radius = 2.6 - tighten * 0.5;
  const tilt = Math.PI / 2.4 + tighten * 0.3;
  const count = Math.round(coinIn * coins.length);
  coins.forEach((coin, i) => {
    coin.visible = i < count;
    if (!coin.visible) { return; }
    const a = (i / coins.length) * Math.PI * 2 + p * 4 + group.rotation.y;
    coin.position.set(
      Math.cos(a) * radius,
      Math.sin(a) * radius * Math.cos(tilt) * 0.4,
      Math.sin(a) * radius * Math.sin(tilt) * 0.5
    );
  });

  /* key light lerps ember->green over 0.52-0.72 */
  const t = tighten;
  keyLight.color.setRGB(
    emberColor.r + (greenColor.r - emberColor.r) * t,
    emberColor.g + (greenColor.g - emberColor.g) * t,
    emberColor.b + (greenColor.b - emberColor.b) * t
  );

  renderer.render(scene, camera);
  if (running) { raf = requestAnimationFrame(render); }
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      build(msg.canvas, msg.width, msg.height, msg.dpr);
      running = true;
      raf = requestAnimationFrame(render);
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  } else if (msg.type === "progress") {
    progress = msg.p;
  } else if (msg.type === "visible") {
    running = msg.visible;
    if (running && raf === null && renderer) { raf = requestAnimationFrame(render); }
  } else if (msg.type === "resize" && renderer) {
    renderer.setSize(msg.width, msg.height, false);
    camera.aspect = msg.width / msg.height;
    camera.updateProjectionMatrix();
  } else if (msg.type === "dispose") {
    running = false;
    if (renderer) { renderer.dispose(); renderer = null; }
    self.close();
  }
};
