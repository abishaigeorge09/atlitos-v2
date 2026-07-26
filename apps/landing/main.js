/* ATLITOS landing motion. Progressive: full content renders with zero JS.
   All initial hidden states are applied here at runtime, never in CSS. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Nav morph: full bar to floating pill */
  var header = document.getElementById("siteHeader");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("compact", window.scrollY > 60);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  if (reduced) { return; }

  /* Typewriter. Text already complete in markup; clear and retype on first view. */
  var typeEls = [document.getElementById("heroType")].concat(
    Array.prototype.slice.call(document.querySelectorAll("[data-type]"))
  ).filter(Boolean);

  typeEls.forEach(function (el) {
    var full = el.textContent;
    var done = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || done) { return; }
        done = true;
        io.unobserve(el);
        el.textContent = "";
        var i = 0;
        var tick = function () {
          i += 1;
          el.textContent = full.slice(0, i);
          if (i < full.length) { setTimeout(tick, 40); }
        };
        setTimeout(tick, 250);
      });
    }, { threshold: 0.5 });
    io.observe(el);
  });

  /* Hero second beat: screen swaps to MEET ATLITOS after you scroll past. */
  var heroType = document.getElementById("heroType");
  var heroLine = "THE WAY INDIA PLAYS IS ABOUT TO CHANGE FOREVER";
  var meetLine = "MEET ATLITOS.";

  if (!window.gsap || !window.ScrollTrigger) { return; }
  gsap.registerPlugin(ScrollTrigger);

  /* Pin the hero like the reference Mac scene: the screen swaps to the
     second beat while still on screen, then the page continues. */
  if (heroType) {
    var onMeet = false;
    ScrollTrigger.create({
      trigger: ".hero",
      start: "top top",
      end: "+=90%",
      pin: true,
      pinSpacing: true,
      onUpdate: function (self) {
        var wantMeet = self.progress > 0.45;
        if (wantMeet === onMeet) { return; }
        onMeet = wantMeet;
        heroType.textContent = wantMeet ? meetLine : heroLine;
        gsap.fromTo(".sb-text", { opacity: 0.15 }, { opacity: 1, duration: 0.45 });
      }
    });
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
    /* gentle ball float */
    gsap.to(".ball-wrap", {
      y: -14,
      duration: 2.4,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut"
    });
  }

  /* Empower bursts pop with rotation */
  gsap.utils.toArray(".burst").forEach(function (el, i) {
    gsap.from(el, {
      scale: 0,
      rotate: -14,
      duration: 0.5,
      ease: "back.out(2.2)",
      delay: i * 0.18,
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
