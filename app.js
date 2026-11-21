(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const nav = $(".site-nav");
  const setNavState = () => nav?.classList.toggle("is-scrolled", window.scrollY > 24);
  setNavState();
  window.addEventListener("scroll", setNavState, { passive: true });

  const revealTargets = $$(
    ".quick-head, .quick-flow, .case-compare, .case-figure, .template-card, .price-panel"
  );
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealTargets.forEach((target) => target.classList.add("reveal"));
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.12 }
    );
    revealTargets.forEach((target) => revealObserver.observe(target));
  }

  const demoScripts = [
    ["把 Skill 文件夹放进技能目录", "在 Agent 输入一句启动指令", "看到“Skill 已加载”就可以开始"],
    ["点击上传旧简历；没有简历也可以从零填写", "Skill 自动提取教育、工作和项目经历", "检查提取结果，再确认进入改写"],
    ["先看改写前后，确认没有编造事实", "核对无误后，确认内容真实", "再选模板，查看真实排版"],
    ["先查看整页预览，确认没有分页或排版问题", "等待内容、分页和文字层检查通过", "点击定稿，下载 Word、PDF 和全部 PNG"]
  ];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const story = $(".story-track");
  const sticky = $(".story-sticky");
  const chapters = $$(".story-chapter");
  const demos = $$("[data-step-demo]");
  const markers = $$(".story-progress li");
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const ease = (value) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };

  const renderDemo = (demo, index, progress) => {
    // Every visual value comes from scroll position; no playback clock.
    const phase = Math.min(2, Math.floor(progress * 3));
    for (let part = 0; part < 3; part++) {
      // A short movement followed by a reading hold in each narrated phase.
      demo.style.setProperty(`--part-${part + 1}`, ease((progress * 3 - part) / 0.64).toFixed(4));
    }
    if (demo.dataset.renderedPhase === String(phase)) return;
    demo.dataset.phase = String(phase);
    demo.dataset.renderedPhase = String(phase);
    $("[data-demo-count]", demo).textContent = `${phase + 1} / 3`;
    $("[data-demo-caption]", demo).textContent = demoScripts[index][phase];
    $$(".demo-timeline li", demo).forEach((item, itemIndex) => {
      item.classList.toggle("is-active", itemIndex === phase);
      item.classList.toggle("is-done", itemIndex < phase);
    });
  };

  if (story && sticky && chapters.length) {
    let frame = 0;
    let mode = "static";
    let storyStart = 0;
    let distance = 1;
    let flowBounds = [];
    const chapterNav = $(".story-progress");
    const cue = $(".scroll-cue span");

    const updateStory = () => {
      frame = 0;
      const progress = clamp((window.scrollY - storyStart) / distance);
      const position = progress * chapters.length;
      let chapterIndex = Math.min(chapters.length - 1, Math.floor(position));
      if (mode === "flow") {
        chapterIndex = Math.max(0, flowBounds.findLastIndex((bounds) => window.scrollY >= bounds.heading - window.innerHeight * 0.35));
      }
      chapters.forEach((chapter, index) => {
        const active = mode === "static" || index === chapterIndex;
        const enter = mode !== "cinematic" || index === 0 ? 1 : ease((position - index + 0.08) / 0.16);
        const exit = mode !== "cinematic" || index === chapters.length - 1 ? 1 : 1 - ease((position - index - 0.92) / 0.16);
        const visibility = enter * exit;
        chapter.classList.toggle("is-active", active);
        chapter.classList.toggle("is-present", visibility > 0.001);
        chapter.style.setProperty("--scene-opacity", visibility.toFixed(4));
        chapter.style.setProperty("--scene-y", `${((1 - enter) * 32 - (1 - exit) * 24).toFixed(2)}px`);
        chapter.style.setProperty("--scene-scale", (1 - (1 - enter) * 0.035 - (1 - exit) * 0.015).toFixed(4));
        chapter.inert = mode === "cinematic" && !active;
        if (!chapter.inert) chapter.removeAttribute("aria-hidden");
        else chapter.setAttribute("aria-hidden", "true");
        const local = mode === "cinematic" ? clamp(position - index)
          : mode === "flow" ? clamp((window.scrollY - flowBounds[index].start) / flowBounds[index].distance) : 1;
        renderDemo(demos[index], index, local);
        markers[index].style.setProperty("--progress", local);
        const button = $("[data-story-jump]", markers[index]);
        if (mode !== "static" && active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
      cue.textContent = mode !== "static"
        ? (progress > 0.96 ? "已经看完，继续滑动看改写案例" : "继续往下滑，演示随你推进")
        : "四步完整呈现，往下阅读即可";
    };
    const scheduleStory = () => {
      if (!frame) frame = window.requestAnimationFrame(updateStory);
    };
    const measureStory = () => {
      // Mobile pins only the illustration, leaving copy in the natural reading flow.
      const mobile = window.matchMedia("(max-width: 48rem)").matches;
      mode = reduceMotion.matches ? "static" : mobile ? "flow" : "cinematic";
      story.dataset.mode = mode;
      const top = parseFloat(getComputedStyle(sticky).top) || 0;
      story.style.setProperty("--story-nav-height", `${chapterNav.offsetHeight}px`);
      const demoTop = parseFloat(getComputedStyle(demos[0]).top) || 0;
      const fits = mode === "cinematic"
        ? sticky.offsetHeight + top + 8 <= window.innerHeight
        : Math.max(...demos.map((demo) => demo.offsetHeight)) + demoTop + 8 <= window.innerHeight;
      if (!fits) mode = "static";
      story.dataset.mode = mode;
      storyStart = story.getBoundingClientRect().top + window.scrollY - top;
      distance = Math.max(1, story.offsetHeight - sticky.offsetHeight);
      flowBounds = chapters.map((chapter, index) => {
        const detail = $(".workflow-detail", chapter);
        const heading = chapter.getBoundingClientRect().top + window.scrollY;
        const detailTop = detail.getBoundingClientRect().top + window.scrollY;
        const copy = $(".step-copy", detail);
        const naturalDemoTop = detailTop + copy.offsetHeight + parseFloat(getComputedStyle(demos[index]).marginTop);
        const start = naturalDemoTop - demoTop - window.innerHeight * 0.18;
        const end = detailTop + detail.offsetHeight - demos[index].offsetHeight - demoTop - 24;
        return { heading, start, distance: Math.max(1, end - start) };
      });
      scheduleStory();
    };
    $$("[data-story-jump]").forEach((button, index) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const destination = mode === "cinematic"
          ? storyStart + distance * ((index + 0.08) / chapters.length)
          : flowBounds[index].heading - (parseFloat(getComputedStyle(chapterNav).top) || 64) - chapterNav.offsetHeight - 16;
        window.scrollTo({ top: destination, behavior: reduceMotion.matches ? "instant" : "smooth" });
      });
    });
    window.addEventListener("scroll", scheduleStory, { passive: true });
    window.addEventListener("resize", measureStory);
    window.addEventListener("pageshow", measureStory);
    reduceMotion.addEventListener("change", measureStory);
    document.fonts.ready.then(measureStory);
    window.addEventListener("load", measureStory, { once: true });
    measureStory();
  }

  const copyButtons = $$("[data-copy]");
  copyButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy);
      if (!source) return;
      button.classList.add("is-loading");
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        button.dataset.state = "copied";
        button.classList.add("is-success");
        $(".copy-label", button).textContent = "已复制";
        window.setTimeout(() => {
          delete button.dataset.state;
          button.classList.remove("is-success");
          $(".copy-label", button).textContent = "复制";
        }, 2500);
      } catch {
        button.classList.add("is-error");
        $(".copy-label", button).textContent = "请手动复制";
      } finally {
        button.classList.remove("is-loading");
      }
    });
  });

  const filterTabs = $$("[data-filter]");
  const templateCards = $$("[data-template-card]");
  const applyFilter = (filter, focus = false) => {
    filterTabs.forEach((tab) => {
      const selected = tab.dataset.filter === filter;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus({ preventScroll: true });
    });
    templateCards.forEach((card) => {
      const categories = card.dataset.categories.split(" ");
      card.hidden = filter !== "all" && !categories.includes(filter);
    });
  };

  filterTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => applyFilter(tab.dataset.filter));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = filterTabs[(index + delta + filterTabs.length) % filterTabs.length];
      applyFilter(next.dataset.filter, true);
    });
  });

  const main = $("main");
  const openDialog = (dialog, trigger) => {
    dialog.dataset.triggerId = trigger?.id || "";
    dialog.showModal();
    main?.setAttribute("inert", "");
    document.body.classList.add("is-locked");
    const primary = dialog.id === "paymentDialog"
      ? $(".dialog-head [data-close]", dialog)
      : $("[data-dialog-primary]", dialog);
    primary?.focus({ preventScroll: true });
  };
  const closeDialog = (dialog) => dialog.close();

  $$("dialog").forEach((dialog) => {
    $$("[data-close]", dialog).forEach((button) => {
      button.addEventListener("click", () => closeDialog(dialog));
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) closeDialog(dialog);
    });
    dialog.addEventListener("close", () => {
      main?.removeAttribute("inert");
      document.body.classList.remove("is-locked");
      const trigger = dialog.dataset.triggerId && document.getElementById(dialog.dataset.triggerId);
      trigger?.focus();
    });
  });

  const templateDialog = $("#templateDialog");
  const templateDialogImage = $("#templateDialogImage");
  const templateDialogTitle = $("#templateDialogTitle");
  $$("[data-template-open]").forEach((button, index) => {
    if (!button.id) button.id = `template-open-${index + 1}`;
    button.addEventListener("click", () => {
      templateDialogImage.src = button.dataset.src;
      templateDialogImage.alt = `${button.dataset.title}合成简历样张大图`;
      templateDialogTitle.textContent = button.dataset.title;
      openDialog(templateDialog, button);
    });
  });

  const overviewDialog = $("#overviewDialog");
  const overviewTrigger = $("#overviewTrigger");
  overviewTrigger?.addEventListener("click", () => openDialog(overviewDialog, overviewTrigger));

  window.initCheckout({ openDialog });
})();
