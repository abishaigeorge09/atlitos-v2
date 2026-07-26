/* ATLITOS landing motion. Progressive: full content renders with zero JS.
   No scroll pinning library. Sticky scenes are fixed height CSS sticky
   tracks, so later sections can never scroll over a stuck stage. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var docEl = document.documentElement;

  /* ---------- Nav: loads compact, expands ONCE past ~1.2 viewports, stays. ---------- */
  var header = document.getElementById("siteHeader");
  var navExpanded = false;
  var onScrollNav = function () {
    var y = window.scrollY;
    docEl.classList.toggle("scrolled", y > 90);
    if (header && !navExpanded && y > window.innerHeight * 1.2) {
      navExpanded = true;
      header.classList.remove("compact");
    }
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

  if (reduced) { return; }

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

  /* ---------- Hero: scroll scrubbed narrative in the scoreboard screen ---------- */
  var hero = document.querySelector(".hero");
  var heroImgs = document.querySelectorAll(".hero-bg img");
  if (hero && heroImgs.length) {
    var heroCurrent = 0;
    var onScrollHero = function () {
      var rect = hero.getBoundingClientRect();
      var track = hero.offsetHeight - window.innerHeight;
      if (track <= 0) { return; }
      var p = Math.min(1, Math.max(0, -rect.top / track));
      var idx = Math.min(heroImgs.length - 1, Math.floor(p * heroImgs.length));
      if (idx !== heroCurrent) {
        heroImgs[heroCurrent].classList.remove("is-on");
        heroImgs[idx].classList.add("is-on");
        heroCurrent = idx;
      }
      if (p > 0.5) { hero.classList.add("is-meet"); }
    };
    window.addEventListener("scroll", onScrollHero, { passive: true });
    onScrollHero();
  }
  var heroType = document.getElementById("heroType");
  if (heroType && hero) {
    observeOnce(heroType, function () {
      typeOnce(heroType, function () {
        setTimeout(function () { hero.classList.add("is-meet"); }, 1400);
      });
    });
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
    document.querySelectorAll(".hero [data-reveal]").forEach(function (el) {
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
