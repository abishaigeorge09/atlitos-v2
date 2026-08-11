/* THE ORBIT, main thread side. mountOrbit(host) returns { setProgress,
   setVisible, dispose } or null on ANY unavailability (the null contract from
   MOTION-ARCHITECTURE.md 4.1: the caller leaves the CSS fallback circle).
   All three.js cost lives in a worker with an OffscreenCanvas; this file
   never imports three. Gating per 3.13: no reduced motion, no <=620px, no
   saveData, WebGL and OffscreenCanvas required. */

export function mountOrbit(host) {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { return null; }
    if (window.innerWidth <= 620) { return null; }
    if (navigator.connection && navigator.connection.saveData) { return null; }
    if (typeof OffscreenCanvas === "undefined") { return null; }

    /* probe WebGL on a throwaway canvas before committing */
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) { return null; }

    const rect = host.getBoundingClientRect();
    const width = Math.min(720, Math.round(rect.width) || 720);
    const height = Math.round(rect.height) || 300;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;display:block;";
    host.appendChild(canvas);
    const offscreen = canvas.transferControlToOffscreen();

    const worker = new Worker(new URL("./orbit-worker.js", import.meta.url));
    let ready = false;
    let disposed = false;

    worker.postMessage(
      { type: "init", canvas: offscreen, width, height, dpr: window.devicePixelRatio || 1 },
      [offscreen]
    );
    worker.onmessage = (e) => {
      if (e.data.type === "ready") {
        ready = true;
        host.classList.add("has-gl");
      } else if (e.data.type === "error") {
        /* worker failed to build the scene; fall back silently */
        canvas.remove();
        host.classList.remove("has-gl");
        worker.terminate();
      }
    };

    const onResize = () => {
      if (!ready || disposed) { return; }
      const r = host.getBoundingClientRect();
      worker.postMessage({ type: "resize", width: Math.min(720, Math.round(r.width)), height: Math.round(r.height) });
    };
    window.addEventListener("resize", onResize);

    return {
      setProgress(p) { if (!disposed) { worker.postMessage({ type: "progress", p }); } },
      setVisible(visible) { if (!disposed) { worker.postMessage({ type: "visible", visible }); } },
      dispose() {
        disposed = true;
        window.removeEventListener("resize", onResize);
        worker.postMessage({ type: "dispose" });
        setTimeout(() => worker.terminate(), 100);
        canvas.remove();
        host.classList.remove("has-gl");
      },
    };
  } catch (e) {
    return null; /* the contract: never throw, the fallback circle stays */
  }
}
