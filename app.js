(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const nav = $(".site-nav");
  const setNavState = () => nav?.classList.toggle("is-scrolled", window.scrollY > 24);
  setNavState();
  window.addEventListener("scroll", setNavState, { passive: true });

  const revealTargets = $$(
    ".quick-head, .quick-flow, .workflow-accordion, .case-compare, .case-figure, .template-card, .price-panel"
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

  const workflowSteps = $$(".workflow-accordion details");
  const demoScripts = [
    ["把 Skill 文件夹放进技能目录", "在 Agent 输入一句启动指令", "看到“Skill 已加载”就可以开始"],
    ["点击上传旧简历；没有简历也可以从零填写", "Skill 自动提取教育、工作和项目经历", "检查提取结果，再确认进入改写"],
    ["先看改写前后，确认没有编造事实", "点击“确认内容真实”", "再选模板，右侧立即显示真实排版"],
    ["先查看整页预览，确认没有分页或排版问题", "等待内容、分页和文字层检查通过", "点击定稿，下载 Word、PDF 和全部 PNG"]
  ];
  const demoTimers = new WeakMap();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const stopStepDemo = (demo) => {
    if (!demo) return;
    const timers = demoTimers.get(demo);
    if (timers) {
      window.clearInterval(timers.interval);
      window.clearTimeout(timers.click);
    }
    demoTimers.delete(demo);
    demo.classList.remove("is-playing", "is-clicking");
  };

  const renderDemoPhase = (demo, phase) => {
    const index = $$("[data-step-demo]").indexOf(demo);
    const script = demoScripts[index] || demoScripts[0];
    const nextPhase = Math.max(0, Math.min(phase, script.length - 1));
    demo.dataset.phase = String(nextPhase);
    $("[data-demo-count]", demo).textContent = `${nextPhase + 1} / ${script.length}`;
    $("[data-demo-caption]", demo).textContent = script[nextPhase];
    $$(".demo-timeline li", demo).forEach((item, itemIndex) => {
      item.classList.toggle("is-active", itemIndex === nextPhase);
      item.classList.toggle("is-done", itemIndex < nextPhase);
    });
    demo.classList.remove("is-clicking");
    const timers = demoTimers.get(demo) || {};
    window.clearTimeout(timers.click);
    if (!reduceMotion.matches) {
      timers.click = window.setTimeout(() => demo.classList.add("is-clicking"), 650);
    }
    demoTimers.set(demo, timers);
  };

  const playStepDemo = (demo) => {
    if (!demo) return;
    stopStepDemo(demo);
    demo.classList.add("is-playing");
    if (reduceMotion.matches) {
      renderDemoPhase(demo, 2);
      return;
    }
    let phase = 0;
    renderDemoPhase(demo, phase);
    const timers = demoTimers.get(demo) || {};
    timers.interval = window.setInterval(() => {
      phase = (phase + 1) % 3;
      renderDemoPhase(demo, phase);
    }, 2600);
    demoTimers.set(demo, timers);
  };

  workflowSteps.forEach((step) => {
    const caption = $("[data-demo-caption]", step);
    caption?.setAttribute("aria-live", "polite");
    step.addEventListener("toggle", () => {
      const demo = $("[data-step-demo]", step);
      if (!step.open) {
        stopStepDemo(demo);
        return;
      }
      workflowSteps.forEach((other) => {
        if (other !== step) other.open = false;
      });
      playStepDemo(demo);
    });
  });
  $$("[data-demo-replay]").forEach((button) => {
    button.addEventListener("click", () => playStepDemo(button.closest("[data-step-demo]")));
  });
  $$(".demo-confirm").forEach((button) => {
    button.addEventListener("click", () => {
      const demo = button.closest("[data-step-demo]");
      const next = Math.min(Number(demo.dataset.phase || 0) + 1, 2);
      renderDemoPhase(demo, next);
    });
  });
  document.addEventListener("visibilitychange", () => {
    const openDemo = $(".workflow-accordion details[open] [data-step-demo]");
    if (document.hidden) stopStepDemo(openDemo);
    else if (openDemo) playStepDemo(openDemo);
  });

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
