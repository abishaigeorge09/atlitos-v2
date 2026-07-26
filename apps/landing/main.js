/* ATLITOS landing motion. Progressive: full content renders with zero JS.
   No scroll pinning library. Sticky scenes are fixed height CSS sticky
   tracks, so later sections can never scroll over a stuck stage. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var docEl = document.documentElement;

  /* ---------- Nav: collapses to the pill on scroll down, expands back on
     any scroll up, always expanded near the top. ---------- */
  var header = document.getElementById("siteHeader");
  var lastY = window.scrollY;
  var onScrollNav = function () {
    var y = window.scrollY;
    docEl.classList.toggle("scrolled", y > 90);
    if (header) {
      if (y < 80) {
        header.classList.remove("compact");
      } else if (y > lastY + 2) {
        header.classList.add("compact");
      } else if (y < lastY - 2) {
        header.classList.remove("compact");
      }
    }
    lastY = y;
  };
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  /* ---------- Old way toggle. Paths draw themselves on every switch. ---------- */
  var wayOld = document.getElementById("wayOld");
  var wayNew = document.getElementById("wayNew");
  var wayTouched = false;
  var drawPath = function (p) {
    if (!p) { return; }
    var len = p.getTotalLength();
    p.style.strokeDasharray = String(len);
    if (reduced) { p.style.strokeDashoffset = "0"; return; }
    p.style.transition = "none";
    p.style.strokeDashoffset = String(len);
    void p.getBoundingClientRect();
    p.style.transition = "";
    p.style.strokeDashoffset = "0";
  };
  var setWay = function (isNew) {
    if (!wayOld || !wayNew) { return; }
    wayNew.classList.toggle("is-active", isNew);
    wayOld.classList.toggle("is-active", !isNew);
    wayNew.setAttribute("aria-selected", String(isNew));
    wayOld.setAttribute("aria-selected", String(!isNew));
    var oldPath = document.getElementById("pathOld");
    var newPath = document.getElementById("pathNew");
    if (oldPath) { oldPath.classList.toggle("is-shown", !isNew); }
    if (newPath) { newPath.classList.toggle("is-shown", isNew); }
    drawPath(isNew ? newPath : oldPath);
    document.querySelectorAll(".way-labels-old").forEach(function (el) { el.classList.toggle("is-shown", !isNew); });
    document.querySelectorAll(".way-labels-new").forEach(function (el) { el.classList.toggle("is-shown", isNew); });
  };
  if (wayOld && wayNew) {
    wayOld.addEventListener("click", function () { wayTouched = true; setWay(false); });
    wayNew.addEventListener("click", function () { wayTouched = true; setWay(true); });
  }

  var observeOnce = function (el, fn) {
    if (!el) { return; }
    var fired = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || fired) { return; }
        fired = true;
        io.unobserve(el);
        fn();
      });
    }, { threshold: 0.4 });
    io.observe(el);
  };

  /* The old way tells its story: chaos draws first, then the clean line, once. */
  var oldwaySection = document.querySelector(".oldway");
  if (oldwaySection) {
    observeOnce(oldwaySection, function () {
      drawPath(document.getElementById("pathOld"));
      window.setTimeout(function () {
        if (!wayTouched) { setWay(true); }
      }, 2600);
    });
  }

  /* ---------- Empower 3D ball: lazy loaded, WebGL gated, never above the fold. ---------- */
  var emp3d = document.getElementById("emp3d");
  if (emp3d && !reduced) {
    observeOnce(document.getElementById("empower"), function () {
      var script = document.createElement("script");
      script.src = "vendor/three.min.js";
      script.onload = function () {
        try {
          if (!window.THREE) { return; }
          var canvas = document.createElement("canvas");
          var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
          var w = emp3d.clientWidth, h = emp3d.clientHeight;
          renderer.setSize(w, h);
          renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
          var scene = new THREE.Scene();
          var camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
          camera.position.set(0, 0, 6.2);
          var group = new THREE.Group();
          group.add(new THREE.Mesh(
            new THREE.SphereGeometry(1.6, 48, 48),
            new THREE.MeshStandardMaterial({ color: 0xFBF7F1, roughness: 0.55, metalness: 0.05 })
          ));
          var seamMat = new THREE.MeshStandardMaterial({ color: 0x1C1712, roughness: 0.6 });
          var seam1 = new THREE.Mesh(new THREE.TorusGeometry(1.61, 0.035, 12, 90), seamMat);
          var seam2 = seam1.clone(); seam2.rotation.y = Math.PI / 2;
          var seam3 = seam1.clone(); seam3.rotation.x = Math.PI / 2;
          group.add(seam1); group.add(seam2); group.add(seam3);
          var ring = new THREE.Mesh(
            new THREE.TorusGeometry(2.6, 0.02, 8, 120),
            new THREE.MeshBasicMaterial({ color: 0x4CAF7D })
          );
          ring.rotation.x = Math.PI / 2.4;
          group.add(ring);
          scene.add(group);
          scene.add(new THREE.AmbientLight(0xFBF7F1, 0.55));
          var key = new THREE.DirectionalLight(0xE8B324, 1.4);
          key.position.set(3, 4, 5);
          scene.add(key);
          var rim = new THREE.DirectionalLight(0xE46136, 0.9);
          rim.position.set(-4, -2, 3);
          scene.add(rim);
          emp3d.appendChild(canvas);
          emp3d.classList.add("has-gl");
          var render = function () {
            var rect = emp3d.getBoundingClientRect();
            var visible = rect.bottom > 0 && rect.top < window.innerHeight;
            if (visible && document.visibilityState !== "hidden") {
              var p = 1 - rect.top / window.innerHeight;
              group.rotation.y += 0.006;
              group.rotation.x = -0.3 + p * 0.5;
              group.position.y = Math.sin(Date.now() / 900) * 0.12;
              renderer.render(scene, camera);
            }
            requestAnimationFrame(render);
          };
          render();
          window.addEventListener("resize", function () {
            var w2 = emp3d.clientWidth, h2 = emp3d.clientHeight;
            renderer.setSize(w2, h2);
            camera.aspect = w2 / h2;
            camera.updateProjectionMatrix();
          });
        } catch (e) { /* the CSS fallback circle stays */ }
      };
      document.body.appendChild(script);
    });
  }

  if (reduced) {
    /* Reduced motion: no autoplaying film, hold the resting frame. */
    var rv = document.getElementById("heroVideo");
    if (rv) {
      rv.removeAttribute("autoplay");
      rv.pause();
      var seekRest = function () { try { rv.currentTime = 7.9; } catch (e) {} };
      if (rv.readyState > 0) { seekRest(); }
      else { rv.addEventListener("loadedmetadata", seekRest); }
    }
    return;
  }

  /* ---------- Typewriter, one shot. Text already complete in markup. ---------- */
  var typeOnce = function (el, done) {
    var full = el.textContent;
    el.textContent = "";
    var i = 0;
    var tick = function () {
      i += 1;
      el.textContent = full.slice(0, i);
      if (i < full.length) { setTimeout(tick, 40); }
      else if (done) { done(); }
    };
    setTimeout(tick, 250);
  };

  /* ---------- Hero film: phase 1 autoplays the intro to the resting frame,
     phase 2 maps scroll to the final camera push. Reversible, never replays
     the intro. ---------- */
  var vid = document.getElementById("heroVideo");
  var vhero = document.querySelector(".vhero");
  var heroVeil = document.getElementById("heroVeil");
  var heroHint = document.getElementById("heroHint");
  if (vid && vhero) {
    var REST = 7.9, END = 9.88;
    var phase = "intro";
    var cur = REST;
    var enterRest = function () {
      if (phase !== "intro") { return; }
      phase = "scrub";
      vid.pause();
      try { vid.currentTime = REST; } catch (e) {}
      cur = REST;
      docEl.classList.add("v-rested");
      if (heroHint) { heroHint.style.opacity = "1"; }
    };
    vid.addEventListener("timeupdate", function () {
      if (phase === "intro" && vid.currentTime >= REST) { enterRest(); }
    });
    vid.addEventListener("ended", enterRest);
    /* Hard fallback: the page must never stay navless. */
    window.setTimeout(enterRest, 12000);
    /* Scrolling during the intro skips straight to the resting frame. */
    window.addEventListener("scroll", function () {
      if (phase === "intro" && window.scrollY > 60) { enterRest(); }
    }, { passive: true });

    var heroLoop = function () {
      requestAnimationFrame(heroLoop);
      if (phase !== "scrub") { return; }
      var track = vhero.offsetHeight - window.innerHeight;
      if (track <= 0) { return; }
      var p = Math.min(1, Math.max(0, window.scrollY / track));
      /* chase the target with a little inertia, clamped to the push in */
      var target = REST + p * (END - REST);
      cur += (target - cur) * 0.16;
      cur = Math.min(END, Math.max(REST, cur));
      if (Math.abs(cur - (vid.currentTime || 0)) > 0.008 && vid.readyState > 1) {
        try { vid.currentTime = cur; } catch (e) {}
      }
      /* scroll hint: gone within the first tenth of the push */
      if (heroHint) { heroHint.style.opacity = String(Math.max(0, 1 - p * 10)); }
      /* navbar: visible to 40 percent, gone by 70 */
      if (header) {
        var nOp = p < 0.4 ? 1 : p > 0.7 ? 0 : 1 - (p - 0.4) / 0.3;
        header.style.opacity = String(nOp);
        header.style.pointerEvents = nOp < 0.05 ? "none" : "";
      }
      /* the LED veil rises over the close up so section 2 emerges from it */
      if (heroVeil) {
        heroVeil.style.opacity = String(p < 0.8 ? 0 : (p - 0.8) / 0.2 * 0.92);
      }
    };
    heroLoop();
  }

  /* ---------- Problem word rotator: fade out to blank, then the next phrase ---------- */
  var rotChip = document.getElementById("rotChip");
  if (rotChip) {
    var phrases = [
      "twenty pings in a WhatsApp group",
      "three calls to check one slot",
      "a paper ledger at the front desk",
      "cash only and no refunds"
    ];
    var pi = 0;
    observeOnce(rotChip, function () {
      setInterval(function () {
        if (document.visibilityState === "hidden") { return; }
        rotChip.classList.add("is-out");
        setTimeout(function () {
          pi = (pi + 1) % phrases.length;
          rotChip.textContent = phrases[pi];
          rotChip.classList.remove("is-out");
        }, 380);
      }, 3400);
    });
  }

  document.querySelectorAll("[data-type]").forEach(function (el) {
    observeOnce(el, function () { typeOnce(el); });
  });

  /* Typewriter, looping (features headline). */
  document.querySelectorAll("[data-type-loop]").forEach(function (el) {
    var full = el.textContent;
    observeOnce(el, function () {
      var loop = function () {
        el.textContent = "";
        var i = 0;
        var tick = function () {
          i += 1;
          el.textContent = full.slice(0, i);
          if (i < full.length) { setTimeout(tick, 38); }
          else { setTimeout(loop, 2600); }
        };
        tick();
      };
      loop();
    });
  });

  /* ---------- Universal reveal framework ----------
     Plays on entry. Elements that leave through the BOTTOM re-arm and
     replay; elements above the viewport keep their final state. */
  var drawInit = function (svg) {
    svg.querySelectorAll(".a-path").forEach(function (p) {
      var len = p.getTotalLength();
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    });
  };
  document.querySelectorAll('[data-reveal="draw"]').forEach(drawInit);

  var revealIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var el = entry.target;
      if (entry.isIntersecting) {
        el.classList.add("is-in");
        if (el.getAttribute("data-reveal") === "draw") {
          el.querySelectorAll(".a-path").forEach(function (p) { p.style.strokeDashoffset = "0"; });
        }
      } else if (entry.boundingClientRect.top > 0) {
        el.classList.remove("is-in");
        if (el.getAttribute("data-reveal") === "draw") {
          el.querySelectorAll(".a-path").forEach(function (p) { p.style.strokeDashoffset = p.style.strokeDasharray; });
        }
      }
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll("[data-reveal]").forEach(function (el) { revealIO.observe(el); });

  /* Hard guarantee for above the fold: whatever happens, hero content shows. */
  window.setTimeout(function () {
    document.querySelectorAll(".led-entry [data-reveal]").forEach(function (el) {
      el.classList.add("is-in");
    });
  }, 2200);

  /* ---------- Count ups: any .ru with data-count, Indian digit grouping ---------- */
  var formatIN = function (n) {
    var s = String(n);
    if (s.length <= 3) { return s; }
    var last3 = s.slice(-3);
    var rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    return rest + "," + last3;
  };
  var countIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) { return; }
      var el = entry.target;
      countIO.unobserve(el);
      var target = parseInt(el.getAttribute("data-count"), 10);
      var prefix = el.getAttribute("data-prefix") || "";
      var start = null;
      var stepFn = function (ts) {
        if (start === null) { start = ts; }
        var t = Math.min(1, (ts - start) / 1100);
        var eased = 1 - Math.pow(1 - t, 3);
        el.textContent = prefix + formatIN(Math.round(target * eased));
        if (t < 1) { requestAnimationFrame(stepFn); }
      };
      requestAnimationFrame(stepFn);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll(".ru[data-count]").forEach(function (el) { countIO.observe(el); });

  /* ---------- Footer giant mark parallax ---------- */
  var mark = document.getElementById("giantMark");
  var footer = document.querySelector(".site-footer");
  if (mark && footer) {
    var ticking = false;
    var onScrollMark = function () {
      if (ticking) { return; }
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var rect = footer.getBoundingClientRect();
        var vh = window.innerHeight;
        if (rect.top > vh || rect.bottom < 0) { return; }
        var p = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
        mark.style.transform = "translateY(" + ((1 - p) * 34) + "%)";
      });
    };
    window.addEventListener("scroll", onScrollMark, { passive: true });
    onScrollMark();
  }
})();
