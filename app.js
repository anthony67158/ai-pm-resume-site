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
    ["先看改写前后，确认没有编造事实", "点击“确认内容真实”", "再选模板，右侧立即显示真实排版"],
    ["先查看整页预览，确认没有分页或排版问题", "等待内容、分页和文字层检查通过", "点击定稿，下载 Word、PDF 和全部 PNG"]
  ];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const story = $(".story-track");
  const sticky = $(".story-sticky");
  const chapters = $$(".story-chapter");
  const demos = $$("[data-step-demo]");
  const markers = $$(".story-progress li");
  const clamp = (value) => Math.max(0, Math.min(1, value));

  const renderDemo = (demo, index, progress) => {
    // Every visual value comes from scroll position; no playback clock.
    const phase = Math.min(2, Math.floor(progress * 3));
    for (let part = 0; part < 3; part++) {
      demo.style.setProperty(`--part-${part + 1}`, clamp(progress * 3 - part).toFixed(4));
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
    let pinned = false;
    let storyStart = 0;
    let distance = 1;

    const updateStory = () => {
      frame = 0;
      const progress = clamp((window.scrollY - storyStart) / distance);
      const chapterIndex = Math.min(chapters.length - 1, Math.floor(progress * chapters.length));
      chapters.forEach((chapter, index) => {
        const active = !pinned || index === chapterIndex;
        chapter.classList.toggle("is-active", active);
        chapter.inert = !active;
        if (active) chapter.removeAttribute("aria-hidden");
        else chapter.setAttribute("aria-hidden", "true");
        const local = pinned ? clamp(progress * chapters.length - index) : 1;
        renderDemo(demos[index], index, local);
        markers[index].style.setProperty("--progress", pinned ? local : 1);
        if (pinned && active) markers[index].setAttribute("aria-current", "step");
        else markers[index].removeAttribute("aria-current");
      });
      const cue = $(".scroll-cue span");
      cue.textContent = pinned
        ? (progress > 0.96 ? "已经看完，继续滑动看改写案例" : "继续往下滑，演示随你推进")
        : "四步完整呈现，往下阅读即可";
    };
    const scheduleStory = () => {
      if (!frame) frame = window.requestAnimationFrame(updateStory);
    };
    const measureStory = () => {
      // Short windows and enlarged text get the complete readable document.
      story.classList.add("is-enhanced");
      story.classList.remove("is-static");
      const top = parseFloat(getComputedStyle(sticky).top) || 0;
      pinned = !reduceMotion.matches && sticky.offsetHeight + top + 12 <= window.innerHeight;
      story.classList.toggle("is-static", !pinned);
      storyStart = story.getBoundingClientRect().top + window.scrollY - top;
      distance = Math.max(1, story.offsetHeight - sticky.offsetHeight);
      scheduleStory();
    };
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
        await navigator.clipboard.writeText(source.innerText.trim());
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
    $("[data-dialog-primary]", dialog)?.focus();
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

  const paymentDialog = $("#paymentDialog");
  const paymentTitle = $("#paymentTitle");
  const paymentLead = $("#paymentLead");
  const paymentImage = $("#paymentImage");
  const paymentPlaceholder = $("#paymentPlaceholder");
  const paymentPlaceholderTitle = $("#paymentPlaceholderTitle");
  const paymentStatus = $("#paymentStatus");
  const paymentOptions = $$("[data-payment-option]");
  const paymentConfig = {
    wechat: { name: "微信", title: "微信扫码支付", sourceKey: "wechatSrc" },
    alipay: { name: "支付宝", title: "支付宝扫码支付", sourceKey: "alipaySrc" }
  };

  const renderPayment = (method) => {
    const config = paymentConfig[method] || paymentConfig.wechat;
    paymentTitle.textContent = config.title;
    paymentLead.textContent = `使用${config.name}扫描下方收款码，支付 9.9 元。`;
    paymentPlaceholderTitle.textContent = `${config.name}收款码`;
    paymentDialog.setAttribute("aria-label", `${config.name}收款码`);
    paymentOptions.forEach((option) => {
      const selected = option.dataset.paymentOption === method;
      option.setAttribute("aria-selected", String(selected));
      option.tabIndex = selected ? 0 : -1;
    });
    const source = paymentDialog.dataset[config.sourceKey]?.trim();
    if (source) {
      paymentImage.src = source;
      paymentImage.alt = `${config.name}收款码，支付 9.9 元`;
      paymentImage.hidden = false;
      paymentPlaceholder.hidden = true;
      paymentStatus.textContent = `请使用${config.name}扫码支付 9.9 元。`;
    } else {
      paymentImage.removeAttribute("src");
      paymentImage.alt = "";
      paymentImage.hidden = true;
      paymentPlaceholder.hidden = false;
      paymentStatus.textContent = "当前收款码待上传，本页暂不收款。";
    }
  };

  $$("[data-pay-open]").forEach((button, index) => {
    if (!button.id) button.id = `pay-open-${index + 1}`;
    button.addEventListener("click", () => {
      renderPayment(button.dataset.payOpen);
      openDialog(paymentDialog, button);
    });
  });

  paymentOptions.forEach((option) => {
    option.addEventListener("click", () => renderPayment(option.dataset.paymentOption));
    option.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const nextMethod = option.dataset.paymentOption === "wechat" ? "alipay" : "wechat";
      renderPayment(nextMethod);
      $(`[data-payment-option="${nextMethod}"]`)?.focus({ preventScroll: true });
    });
  });
})();
