/* ATLITOS landing motion. Progressive: full content renders with zero JS.
   All initial hidden states are applied here at runtime, never in CSS. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Nav morph: flush full width strip to floating pill */
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

  /* Hero pin, three beats: type, meet, ball docks into the slot. */
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
      onUpdate: function (self) {
        var p = self.progress;
        var wantBeat = p < 0.34 ? 0 : 1;
        if (wantBeat !== beat) {
          beat = wantBeat;
          scoreboard.classList.toggle("is-meet", beat === 1);
          if (beat === 1) {
            gsap.fromTo(".sb-beat2",
              { opacity: 0.15, filter: "grayscale(1)" },
              { opacity: 1, filter: "grayscale(0)", duration: 0.7 });
          }
        }
        /* Beat 3: ball rolls in from the right and docks into the slot. */
        if (dockBall) {
          var t = Math.max(0, Math.min(1, (p - 0.55) / 0.4));
          gsap.set(dockBall, { x: (1 - t) * window.innerWidth * 0.7, rotation: -360 * t });
        }
      }
    });
  }

  /* Peek ball: slides in from the page edge, pauses, slides back. */
  var peek = document.querySelector(".peek-ball");
  if (peek) {
    gsap.timeline({ delay: 1.4 })
      .to(peek, { x: "-46%", rotate: 10, duration: 0.7, ease: "back.out(1.8)" })
      .to(peek, { x: "0%", rotate: -14, duration: 0.6, ease: "power2.in" }, "+=1.6");
  }

  /* Sticker and demo frame pops */
  gsap.utils.toArray(".pop").forEach(function (el, i) {
    gsap.from(el, {
      opacity: 0,
      y: 26,
      rotate: (i % 2 ? 2.5 : -2.5),
      duration: 0.55,
      ease: "back.out(1.6)",
      scrollTrigger: { trigger: el, start: "top 88%" }
    });
  });

  /* Demo card rows stagger in, dark CTA row pulses. */
  gsap.utils.toArray(".demo-card").forEach(function (card) {
    gsap.from(card.querySelectorAll(".d-row, .d-xp"), {
      opacity: 0,
      x: 30,
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

  /* Hand drawn arrows: stroke reveal */
  gsap.utils.toArray(".draw").forEach(function (svg) {
    var paths = svg.querySelectorAll(".a-path");
    paths.forEach(function (p) {
      var len = p.getTotalLength();
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    });
    gsap.to(paths, {
      strokeDashoffset: 0,
      duration: 1.1,
      stagger: 0.22,
      ease: "power2.out",
      scrollTrigger: { trigger: svg, start: "top 82%" }
    });
  });

  /* Features: screen rises, notification cards stagger in. */
  var featScreen = document.querySelector(".feat-screen");
  if (featScreen) {
    gsap.from(featScreen, {
      y: 140,
      opacity: 0,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: { trigger: ".features", start: "top 60%" }
    });
    gsap.from(".notif", {
      opacity: 0,
      y: 40,
      duration: 0.5,
      stagger: 0.16,
      ease: "back.out(1.5)",
      scrollTrigger: { trigger: featScreen, start: "top 70%" }
    });
  }

  /* Pinned different scene: phases recolor and retag */
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
    gsap.to(".ball-wrap", {
      y: -14,
      duration: 2.4,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut"
    });
  }

  /* Empower stage: center ball pops then bobs, bursts pop with rotation. */
  var stageBall = document.querySelector(".stage-ball");
  if (stageBall) {
    gsap.from(stageBall, {
      scale: 0,
      duration: 0.6,
      ease: "back.out(2)",
      scrollTrigger: { trigger: ".stage", start: "top 80%" }
    });
    gsap.to(stageBall, { y: 10, duration: 2, yoyo: true, repeat: -1, ease: "sine.inOut" });
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
  });

  /* Footer giant mark parallax rise */
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
