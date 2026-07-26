/* ATLITOS landing motion. Progressive: full content renders with zero JS.
   All initial hidden states are applied here at runtime, never in CSS. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Nav morph: floating card shrinks into the pill */
  var header = document.getElementById("siteHeader");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("compact", window.scrollY > 60);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  if (reduced) { return; }

  /* Typewriter, one shot. Text already complete in markup. */
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

  var heroType = document.getElementById("heroType");
  if (heroType) { observeOnce(heroType, function () { typeOnce(heroType); }); }

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
          else { setTimeout(loop, 2200); }
        };
        tick();
      };
      loop();
    });
  });

  if (!window.gsap || !window.ScrollTrigger) { return; }
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  /* ---------- Load intro: scoreboard lands, copy staggers in ----------
     The scoreboard is also the pin target, so the intro must guarantee its
     final state: clearProps on complete plus a hard fallback sweep. */
  var introTargets = [".scoreboard", ".hero-sub", ".hero .cta-row > *", ".scroll-hint"];
  gsap.timeline({
    onComplete: function () { gsap.set(introTargets, { clearProps: "opacity,transform" }); }
  })
    .from(".scoreboard", { y: 44, scale: 0.965, opacity: 0, duration: 0.7, ease: "power3.out", overwrite: "auto" })
    .from(".hero-sub", { y: 22, opacity: 0, duration: 0.5, ease: "power2.out" }, "-=0.25")
    .from(".hero .cta-row > *", { y: 18, opacity: 0, duration: 0.45, stagger: 0.1, ease: "power2.out" }, "-=0.3")
    .from(".scroll-hint", { opacity: 0, duration: 0.5 }, "-=0.1");
  /* setTimeout, not delayedCall: it must fire even when rAF is throttled
     in occluded windows, so the hero can never stay half faded. */
  window.setTimeout(function () {
    if (window.scrollY < 60) { gsap.set(introTargets, { clearProps: "opacity,transform" }); }
    else { gsap.set(introTargets, { opacity: 1 }); }
  }, 2600);

  /* Scroll hint fades once scrolling starts */
  ScrollTrigger.create({
    start: 90,
    onEnter: function () { gsap.to(".scroll-hint", { opacity: 0, duration: 0.3 }); },
    onLeaveBack: function () { gsap.to(".scroll-hint", { opacity: 1, duration: 0.3 }); }
  });

  /* ---------- Hero pin, three beats: type, meet, ball docks ---------- */
  var scoreboard = document.getElementById("scoreboard");
  var dockBall = document.querySelector(".dock-ball");
  if (scoreboard) {
    var beat = 0;
    if (dockBall) { gsap.set(dockBall, { x: "70vw", rotation: 0 }); }
    ScrollTrigger.create({
      trigger: ".hero",
      start: "top top",
      end: "+=140%",
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
      onUpdate: function (self) {
        if (!(self.end > self.start)) { return; }
        var p = self.progress || 0;
        if (window.scrollY < 40) { p = 0; }
        var wantBeat = p < 0.34 ? 0 : 1;
        if (wantBeat !== beat) {
          beat = wantBeat;
          scoreboard.classList.toggle("is-meet", beat === 1);
          if (beat === 1) {
            gsap.fromTo(".sb-beat2",
              { opacity: 0.15, filter: "grayscale(1)", scale: 0.94 },
              { opacity: 1, filter: "grayscale(0)", scale: 1, duration: 0.7, ease: "power2.out" });
          } else {
            gsap.fromTo(".sb-beat1", { opacity: 0.2 }, { opacity: 1, duration: 0.4 });
          }
          gsap.fromTo(scoreboard, { rotate: beat === 1 ? -0.6 : 0.6 }, { rotate: 0, duration: 0.5, ease: "power2.out" });
        }
        if (dockBall) {
          var t = Math.max(0, Math.min(1, (p - 0.55) / 0.4));
          gsap.set(dockBall, { x: (1 - t) * window.innerWidth * 0.7, rotation: -360 * t });
        }
      }
    });
  }

  /* Peek ball: peeks in, retreats, and returns every few seconds */
  var peek = document.querySelector(".peek-ball");
  if (peek) {
    gsap.timeline({ delay: 1.4, repeat: -1, repeatDelay: 5 })
      .to(peek, { x: "-46%", rotate: 10, duration: 0.7, ease: "back.out(1.8)" })
      .to(peek, { x: "0%", rotate: -14, duration: 0.6, ease: "power2.in" }, "+=1.6");
  }

  /* ---------- Sticker pops + slow parallax drift ---------- */
  gsap.utils.toArray(".pop").forEach(function (el, i) {
    gsap.from(el, {
      opacity: 0,
      y: 30,
      rotate: (i % 2 ? 3 : -3),
      duration: 0.55,
      ease: "back.out(1.7)",
      scrollTrigger: { trigger: el, start: "top 88%" }
    });
  });
  gsap.utils.toArray(".sticker-stack").forEach(function (stack) {
    var kids = stack.querySelectorAll(".sticker");
    kids.forEach(function (k, i) {
      gsap.to(k, {
        yPercent: (i % 2 ? -8 : 8),
        ease: "none",
        scrollTrigger: { trigger: stack, start: "top bottom", end: "bottom top", scrub: 1.2 }
      });
    });
  });

  /* Chip highlight sweep when the note arrives */
  var chip = document.querySelector(".chip");
  if (chip) {
    gsap.fromTo(chip, { backgroundColor: "rgba(252, 235, 228, 0)" },
      { backgroundColor: "#FCEBE4", duration: 0.9, delay: 0.4,
        scrollTrigger: { trigger: chip, start: "top 80%" } });
  }

  /* ---------- Demo cards: rows stagger, dark CTA pulses ---------- */
  gsap.utils.toArray(".demo-card").forEach(function (card) {
    gsap.from(card.querySelectorAll(".d-row, .d-xp"), {
      opacity: 0,
      x: 34,
      duration: 0.45,
      stagger: 0.1,
      ease: "power2.out",
      scrollTrigger: { trigger: card, start: "top 78%" }
    });
    var cta = card.querySelector(".d-cta");
    if (cta) {
      gsap.to(cta, { opacity: 0.82, duration: 0.9, yoyo: true, repeat: -1, ease: "sine.inOut" });
    }
  });

  /* Step copy lines cascade per panel; docking tab gets a bounce */
  gsap.utils.toArray(".step-panel").forEach(function (panel, idx) {
    gsap.from(panel.querySelectorAll(".step-lede, .stack-list"), {
      opacity: 0,
      y: 26,
      duration: 0.5,
      stagger: 0.14,
      ease: "power2.out",
      scrollTrigger: { trigger: panel, start: "top 70%" }
    });
    var tab = document.querySelector(".tab-" + (idx + 1));
    if (tab) {
      ScrollTrigger.create({
        trigger: panel,
        start: "top 55%",
        onEnter: function () {
          gsap.fromTo(tab, { y: -10 }, { y: 0, duration: 0.55, ease: "bounce.out" });
        }
      });
    }
  });

  /* ---------- Hand drawn arrows ---------- */
  gsap.utils.toArray(".draw").forEach(function (svg) {
    var paths = svg.querySelectorAll(".a-path");
    paths.forEach(function (p) {
      var len = p.getTotalLength();
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    });
    if (svg.classList.contains("stage-arrow")) {
      /* Closing stage arrow draws WITH the scroll for a tactile feel */
      gsap.to(paths, {
        strokeDashoffset: 0,
        ease: "none",
        stagger: 0.05,
        scrollTrigger: { trigger: ".stage", start: "top 92%", end: "top 30%", scrub: 0.6 }
      });
    } else {
      gsap.to(paths, {
        strokeDashoffset: 0,
        duration: 1.1,
        stagger: 0.22,
        ease: "power2.out",
        scrollTrigger: { trigger: svg, start: "top 82%" }
      });
    }
  });

  /* ---------- Features: screen rises with scrub, cards cascade ---------- */
  var featScreen = document.querySelector(".feat-screen");
  if (featScreen) {
    gsap.fromTo(featScreen, { y: 170 }, {
      y: 0,
      ease: "none",
      scrollTrigger: { trigger: ".features", start: "top 75%", end: "top 15%", scrub: 0.8 }
    });
    gsap.from(".notif", {
      opacity: 0,
      y: 44,
      rotate: 1.5,
      duration: 0.5,
      stagger: 0.16,
      ease: "back.out(1.5)",
      scrollTrigger: { trigger: featScreen, start: "top 70%" }
    });
  }

  /* ---------- Pricing: checklist cascade, Pro card levitates ---------- */
  var incl = document.querySelector(".incl-card");
  if (incl) {
    gsap.from(incl.querySelectorAll("li"), {
      opacity: 0,
      x: -16,
      duration: 0.4,
      stagger: 0.07,
      ease: "power2.out",
      scrollTrigger: { trigger: incl, start: "top 72%" }
    });
  }
  var pro = document.querySelector(".plan-pro");
  if (pro) {
    gsap.to(pro, { y: -7, duration: 2.2, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 1 });
  }

  /* ---------- Pinned different scene ---------- */
  var stage = document.getElementById("pinStage");
  var scene = document.querySelector(".pin-scene");
  if (stage && scene) {
    var tagSets = [
      ["Site visits", "Real photos", "Live slots", "Fair prices"],
      ["Ledger entries", "Instant receipts", "Clean refunds", "Payouts on time"],
      ["Roundups", "Donations", "Verified athletes", "Tracked impact"]
    ];
    var tagEls = stage.querySelectorAll(".tag");
    var caps = stage.querySelectorAll(".pin-caption");
    var current = 0;
    var setPhase = function (n) {
      if (n === current) { return; }
      current = n;
      stage.classList.remove("phase-0", "phase-1", "phase-2");
      stage.classList.add("phase-" + n);
      gsap.fromTo(".semicircle", { scaleY: 0.955 }, { scaleY: 1, duration: 0.7, ease: "power2.out", transformOrigin: "bottom center" });
      tagEls.forEach(function (el, i) {
        el.textContent = tagSets[n][i];
        gsap.fromTo(el,
          { scale: 0.5, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.38, ease: "back.out(2)", delay: i * 0.06 });
      });
      caps.forEach(function (c, i) { c.classList.toggle("is-on", i === n); });
    };
    ScrollTrigger.create({
      trigger: scene,
      start: "top top",
      end: "bottom bottom",
      onUpdate: function (self) {
        setPhase(Math.min(2, Math.floor(self.progress * 3)));
      }
    });
    /* Ball spins slowly with the scroll and floats */
    gsap.to(".ball", {
      rotation: 100,
      ease: "none",
      transformOrigin: "50% 50%",
      scrollTrigger: { trigger: scene, start: "top bottom", end: "bottom top", scrub: 1 }
    });
    gsap.to(".ball-wrap", { y: -14, duration: 2.4, yoyo: true, repeat: -1, ease: "sine.inOut" });
    /* Tags idle bob at offset phases */
    tagEls.forEach(function (el, i) {
      gsap.to(el, { y: i % 2 ? 6 : -6, duration: 1.8 + i * 0.2, yoyo: true, repeat: -1, ease: "sine.inOut" });
    });
  }

  /* ---------- Empower stage ---------- */
  var stageBall = document.querySelector(".stage-ball");
  if (stageBall) {
    gsap.from(stageBall, {
      scale: 0,
      duration: 0.6,
      ease: "back.out(2)",
      scrollTrigger: { trigger: ".stage", start: "top 80%" }
    });
    gsap.to(stageBall, { y: 10, rotation: 8, duration: 2, yoyo: true, repeat: -1, ease: "sine.inOut" });
  }
  gsap.utils.toArray(".burst").forEach(function (el, i) {
    gsap.from(el, {
      scale: 0,
      rotate: -14,
      duration: 0.5,
      ease: "back.out(2.2)",
      delay: 0.2 + i * 0.18,
      scrollTrigger: { trigger: ".stage", start: "top 78%" }
    });
    gsap.to(el, { rotate: i % 2 ? 5 : -5, duration: 1.6, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 1 });
  });

  /* Roundup numerals count up when they arrive */
  document.querySelectorAll(".ru[data-count]").forEach(function (el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    var obj = { v: target };
    gsap.from(obj, {
      v: 0,
      duration: 1.1,
      ease: "power2.out",
      snap: { v: 1 },
      scrollTrigger: { trigger: ".roundup-line", start: "top 85%" },
      onUpdate: function () { el.textContent = "₹" + obj.v; }
    });
  });

  /* ---------- Footer: columns cascade, giant mark parallax ---------- */
  gsap.from(".footer-cols nav", {
    opacity: 0,
    y: 26,
    duration: 0.5,
    stagger: 0.12,
    ease: "power2.out",
    scrollTrigger: { trigger: ".footer-cols", start: "top 88%" }
  });
  var mark = document.getElementById("giantMark");
  if (mark) {
    gsap.from(mark, {
      yPercent: 34,
      ease: "none",
      scrollTrigger: {
        trigger: ".site-footer",
        start: "top bottom",
        end: "bottom bottom",
        scrub: true
      }
    });
  }
})();
