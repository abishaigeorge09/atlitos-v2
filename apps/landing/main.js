/* ATLITOS landing, the BASIC floor. Progressive: full content renders with
   zero JS; this file renders a correct, plainer page with no library. The rich
   ceiling lives in motion/ (GSAP + Lenis) and switches pieces of this file off
   through window.__atlitosBasic when it boots. If motion/ never boots, nothing
   is switched off and this file IS the page. See docs/MOTION-ARCHITECTURE.md.
   Block map, in order: nav folder tab morph (down tucks, up reopens),
   old way toggle with self drawing paths and one auto advance,
   lazy three.js Empower ball (WebGL gated, fallback circle),
   hero-ready hard fallback (1800ms, forces hero and nav final states),
   reduced motion early return,
   problem word rotator, typewriters, universal reveal IntersectionObserver,
   count ups with Indian digit grouping, footer giant mark parallax,
   the __atlitosBasic handover surface.
   Verification gotcha for future agents: hidden or backgrounded tabs suspend
   scroll events, IntersectionObserver, CSS transitions, and media loading.
   Always verify with the tab actually visible (take a screenshot first to wake
   it) before concluding anything is broken. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var docEl = document.documentElement;

  /* ---------- Nav: collapses to the pill on scroll down, expands back on
     any scroll up, always expanded near the top. ---------- */
  var header = document.getElementById("siteHeader");
  var lastY = window.scrollY;
  /* the nav glass flips paper once scroll leaves the dark opening (hero +
     title card); .problem is the first light band */
  var darkEnd = function () {
    var problem = document.querySelector(".problem");
    return problem ? problem.offsetTop - 120 : 90;
  };
  var onScrollNav = function () {
    var y = window.scrollY;
    docEl.classList.toggle("scrolled", y > darkEnd());
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
      /* rich mode sequences the chaos draw inside its own court timeline;
         drawing it here too would draw the path twice */
      if (!docEl.classList.contains("motion-rich")) {
        drawPath(document.getElementById("pathOld"));
      }
      /* the auto advance is the same story in both modes */
      window.setTimeout(function () {
        if (!wayTouched) { setWay(true); }
      }, 3200);
    });
  }

  /* ---------- Hero hard fallback ----------
     hero-ready forces every hero element (and the nav) to its final state via
     CSS. The rich path (motion/sections/hero.js) adds it when the load
     timeline completes; this timer guarantees it regardless. The fold can
     never depend on animation completing. Registered for every mode, before
     the reduced-motion early return. */
  window.setTimeout(function () {
    docEl.classList.add("hero-ready");
  }, 1800);

  if (reduced) {
    /* Reduced motion: final states on first paint, handled in CSS. */
    docEl.classList.add("hero-ready");
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

  /* ---------- Problem word rotator: fade out to blank, then the next phrase ---------- */
  /* Basic-mode text behaviours check motion-rich AT FIRE TIME so the rich
     modules can own the same elements without double-driving them. */
  var richOwns = function () { return docEl.classList.contains("motion-rich"); };

  var rotChip = document.getElementById("rotChip");
  if (rotChip) {
    var phrases = [
      "twenty pings in a WhatsApp group",
      "three calls to check one slot",
      "a paper ledger at the front desk",
      "cash only and no refunds"
    ];
    var pi = 0;
    window.__atlitosPhrases = phrases;
    observeOnce(rotChip, function () {
      if (richOwns()) { return; }
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
    observeOnce(el, function () { if (!richOwns()) { typeOnce(el); } });
  });

  /* Typewriter, looping (features headline). */
  document.querySelectorAll("[data-type-loop]").forEach(function (el) {
    var full = el.textContent;
    observeOnce(el, function () {
      if (richOwns()) { return; }
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
  var onScrollMark = null;
  if (mark && footer) {
    var ticking = false;
    onScrollMark = function () {
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

  /* ---------- Handover surface for motion/ (the rich ceiling) ----------
     If motion/index.js boots it calls these to switch basic behaviours off.
     If it never boots, nothing calls them and this file IS the page. */
  window.__atlitosBasic = {
    disableReveal: function () { revealIO.disconnect(); },
    disableNavScroll: function () { window.removeEventListener("scroll", onScrollNav); },
    disableMarkParallax: function () {
      if (onScrollMark) { window.removeEventListener("scroll", onScrollMark); }
    },
    setWay: setWay,
    drawPath: drawPath,
    formatIN: formatIN,
    observeOnce: observeOnce
  };
})();
