/* ATLITOS landing motion. Progressive: full content renders with zero JS.
   No scroll pinning library. The only sticky scene is a fixed height CSS
   sticky track, so later sections can never scroll over a stuck stage. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var docEl = document.documentElement;

  /* ---------- Nav morph, both directions.
     Down past the hero: shrink to the pill. Any upward scroll: expand back. */
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

  /* ---------- Old way toggle. Works regardless of motion settings. ---------- */
  var wayOld = document.getElementById("wayOld");
  var wayNew = document.getElementById("wayNew");
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
    document.querySelectorAll(".way-labels-old").forEach(function (el) { el.classList.toggle("is-shown", !isNew); });
    document.querySelectorAll(".way-labels-new").forEach(function (el) { el.classList.toggle("is-shown", isNew); });
  };
  if (wayOld && wayNew) {
    wayOld.addEventListener("click", function () { setWay(false); });
    wayNew.addEventListener("click", function () { setWay(true); });
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

  var observeOnce = function (el, fn) {
    var fired = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || fired) { return; }
        fired = true;
        io.unobserve(el);
        fn();
      });
    }, { threshold: 0.5 });
    io.observe(el);
  };

  /* Hero: rotate the sport photography, type the line, then Meet Atlitos. */
  var hero = document.querySelector(".hero");
  var heroImgs = document.querySelectorAll(".hero-bg img");
  if (heroImgs.length > 1) {
    var heroIdx = 0;
    setInterval(function () {
      if (document.visibilityState === "hidden") { return; }
      heroImgs[heroIdx].classList.remove("is-on");
      heroIdx = (heroIdx + 1) % heroImgs.length;
      heroImgs[heroIdx].classList.add("is-on");
    }, 4800);
  }
  var heroType = document.getElementById("heroType");
  if (heroType && hero) {
    observeOnce(heroType, function () {
      typeOnce(heroType, function () {
        setTimeout(function () {
          hero.classList.add("is-meet");
        }, 900);
      });
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
     Plays on entry. If an element leaves through the BOTTOM of the viewport
     (user scrolled back up past it) it re-arms, so it replays on the way down.
     Elements above the viewport stay in their final state. */
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
          el.querySelectorAll(".a-path").forEach(function (p) {
            p.style.strokeDashoffset = "0";
          });
        }
      } else if (entry.boundingClientRect.top > 0) {
        el.classList.remove("is-in");
        if (el.getAttribute("data-reveal") === "draw") {
          el.querySelectorAll(".a-path").forEach(function (p) {
            p.style.strokeDashoffset = p.style.strokeDasharray;
          });
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

  /* ---------- Pinned different scene: phases from sticky track progress ---------- */
  var scene = document.querySelector(".pin-scene");
  var stage = document.getElementById("pinStage");
  if (scene && stage) {
    var tagSets = [
      ["Site visits", "Real photos", "Live slots", "Fair prices"],
      ["Ledger entries", "Instant receipts", "Clean refunds", "Payouts on time"],
      ["Roundups", "Donations", "Verified athletes", "Tracked impact"]
    ];
    var tagEls = stage.querySelectorAll(".tag");
    var caps = stage.querySelectorAll(".pin-caption");
    var dots = stage.querySelectorAll(".pd");
    var ballEl = stage.querySelector(".ball");
    var current = 0;
    var setPhase = function (n) {
      if (n === current) { return; }
      current = n;
      stage.classList.remove("phase-0", "phase-1", "phase-2");
      stage.classList.add("phase-" + n);
      tagEls.forEach(function (el, i) {
        el.textContent = tagSets[n][i];
        el.classList.remove("is-swap");
        void el.offsetWidth; /* restart the swap animation */
        el.classList.add("is-swap");
      });
      caps.forEach(function (c, i) { c.classList.toggle("is-on", i === n); });
      dots.forEach(function (d, i) { d.classList.toggle("is-on", i === n); });
    };
    var onScrollScene = function () {
      var rect = scene.getBoundingClientRect();
      var track = scene.offsetHeight - window.innerHeight;
      if (track <= 0) { return; }
      var p = Math.min(1, Math.max(0, -rect.top / track));
      if (rect.top > window.innerHeight || rect.bottom < 0) { return; }
      setPhase(Math.min(2, Math.floor(p * 3)));
      if (ballEl) { ballEl.style.rotate = (p * 100) + "deg"; }
    };
    window.addEventListener("scroll", onScrollScene, { passive: true });
    onScrollScene();
  }

  /* ---------- Roundup numerals count up when they arrive ---------- */
  var counted = false;
  var roundupLine = document.querySelector(".roundup-line");
  if (roundupLine) {
    observeOnce(roundupLine, function () {
      if (counted) { return; }
      counted = true;
      roundupLine.querySelectorAll(".ru[data-count]").forEach(function (el) {
        var target = parseInt(el.getAttribute("data-count"), 10);
        var start = null;
        var stepFn = function (ts) {
          if (start === null) { start = ts; }
          var t = Math.min(1, (ts - start) / 1100);
          var eased = 1 - Math.pow(1 - t, 3);
          el.textContent = "₹" + Math.round(target * eased);
          if (t < 1) { requestAnimationFrame(stepFn); }
        };
        requestAnimationFrame(stepFn);
      });
    });
  }

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
