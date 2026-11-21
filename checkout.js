/* Only the server may authorize downloads; no local paid flag or mock mode. */
window.initCheckout = ({ openDialog }) => {
  const $ = selector => document.querySelector(selector);
  const dialog = $("#paymentDialog");
  const title = $("#paymentTitle"), lead = $("#paymentLead"), status = $("#paymentStatus");
  const image = $("#paymentImage"), placeholder = $("#paymentPlaceholder");
  const hint = $("#paymentHint"), placeholderTitle = $("#paymentPlaceholderTitle");
  const create = $("#paymentCreate"), download = $("#paymentDownload"), orderLabel = $("#paymentOrder");
  const options = [...document.querySelectorAll("[data-payment-option]")];
  const names = { wechat: "微信", alipay: "支付宝" };
  const attempted = new Set();
  let method = "wechat", order = null, methods = [], timer, generation = 0, controller;
  const reset = () => {
    generation += 1;
    clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    return generation;
  };
  const alive = token => token === generation && dialog.open;
  const api = async (url, init = {}) => {
    const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]),
      headers: { "Content-Type": "application/json" } });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("支付通道尚未开通，请暂勿转账。");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "请求未完成，请稍后重试。");
    return body;
  };
  const select = () => {
    title.textContent = `${names[method]}支付`;
    options.forEach(option => {
      const selected = option.dataset.paymentOption === method;
      option.setAttribute("aria-selected", String(selected));
      option.tabIndex = selected ? 0 : -1;
      option.disabled = Boolean(order && order.status !== "closed") || !methods.includes(option.dataset.paymentOption);
    });
  };
  const message = (heading, detail) => {
    placeholder.dataset.state = heading === "支付成功" ? "paid" : "idle";
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
    placeholderTitle.textContent = heading;
    hint.textContent = detail;
  };
  const save = async token => {
    if (!alive(token) || order?.status !== "paid") return;
    download.disabled = true;
    try {
      const response = await fetch(order.download, { credentials: "same-origin", cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
      if (!response.ok) throw new Error("下载暂未完成，请点击按钮重试。");
      const blob = await response.blob();
      if (!alive(token)) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ai-pm-resume.zip";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = "已发起下载。若浏览器未保存文件，请点“下载安装包”重试。";
    } catch (error) {
      if (alive(token)) status.textContent = error.message;
    } finally { if (alive(token)) download.disabled = false; }
  };
  const render = (data, token) => {
    if (!alive(token)) return;
    order = data;
    method = data.method;
    select();
    orderLabel.hidden = false;
    orderLabel.textContent = `订单 ${data.id}`;
    create.hidden = true;
    download.hidden = true;
    if (data.status === "paid") {
      message("支付成功", "已核实 ¥9.90 到账");
      lead.textContent = "安装包已解锁，可以在当前浏览器重新下载。";
      download.hidden = false;
      if (attempted.has(data.id)) {
        download.disabled = false;
        status.textContent = "付款已确认。需要时可再次下载安装包。";
        return;
      }
      download.disabled = true;
      const deadline = Date.now() + 3000;
      const countdown = () => {
        if (!alive(token)) return;
        const left = Math.ceil((deadline - Date.now()) / 1000);
        if (left > 0) {
          status.textContent = `支付成功，${left} 秒后自动下载。`;
          timer = setTimeout(countdown, 250);
        } else {
          attempted.add(data.id);
          save(token);
        }
      };
      countdown();
    } else if (data.status === "closed") {
      message("订单已关闭", "此订单不能再付款");
      status.textContent = "支付平台确认订单已关闭。可重新选择支付方式下单。";
      order = null;
      select();
      create.hidden = false;
      create.disabled = !methods.includes(method);
    } else {
      lead.textContent = `用${names[method]}扫描订单码，支付 ¥9.90。`;
      if (data.qr?.startsWith("data:image/png;base64,")) {
        image.src = data.qr;
        image.alt = `${names[method]}订单支付码，金额 ¥9.90`;
        image.hidden = false;
        placeholder.hidden = true;
      } else message("正在核实订单", "暂勿重复转账");
      status.textContent = "等待支付确认。手机可保存二维码后在支付 App 中扫码，再返回本页；请保留当前浏览器。";
      timer = setTimeout(() => poll(token), 3000);
    }
  };
  const poll = async token => {
    if (!alive(token) || !order) return;
    try { render(await api(`/api/orders/${order.id}`), token); }
    catch {
      if (!alive(token)) return;
      status.textContent = "正在重新连接，付款结果尚未确认。请勿重复付款。";
      timer = setTimeout(() => poll(token), 5000);
    }
  };
  const load = async () => {
    const token = reset();
    dialog.querySelector(".dialog-body").scrollTop = 0;
    order = null;
    methods = [];
    select();
    create.hidden = download.hidden = orderLabel.hidden = true;
    lead.textContent = "核实 ¥9.90 支付成功后，自动下载安装包。";
    message("安全支付", "正在检查支付通道");
    status.textContent = "正在连接支付服务。";
    if (!window.AIPM_CHECKOUT_ORIGIN) {
      message("支付暂未开放", "请稍后再来");
      status.textContent = "收款确认服务尚未开通，当前页面暂不收款。";
      return;
    }
    try {
      const configured = new URL(window.AIPM_CHECKOUT_ORIGIN);
      if (configured.origin !== location.origin) {
        if (configured.protocol !== "https:") throw new Error("支付地址尚未正确配置。");
        configured.pathname = "/";
        configured.search = new URLSearchParams({ checkout: method }).toString();
        location.assign(configured.href);
        return;
      }
      const data = await api("/api/checkout");
      if (!alive(token)) return;
      methods = data.methods;
      if (data.order) return render(data.order, token);
      select();
      if (!methods.includes(method)) {
        message("通道暂未开放", "请稍后再来，或选择其他支付方式");
        status.textContent = "当前支付方式暂不可用，请勿通过个人转账付款。";
        return;
      }
      message("¥9.90", "生成当前订单专属二维码");
      status.textContent = "支付成功后显示 3 秒确认，再自动下载。";
      create.hidden = false;
      create.disabled = false;
    } catch (error) {
      if (!alive(token)) return;
      message("暂时无法连接", "请关闭后重新打开");
      status.textContent = error.message;
    }
  };
  create.addEventListener("click", async () => {
    const token = generation;
    create.disabled = true;
    options.forEach(option => { option.disabled = true; });
    status.textContent = "正在生成订单，请稍候。";
    try { render(await api("/api/orders", { method: "POST", body: JSON.stringify({ method }) }), token); }
    catch (error) {
      if (!alive(token)) return;
      status.textContent = `${error.message} 关闭后重新打开可恢复订单。`;
    }
  });
  download.addEventListener("click", () => save(generation));
  options.forEach(option => {
    option.addEventListener("click", () => { method = option.dataset.paymentOption; load(); });
    option.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key) || order) return;
      const next = options.find(item => item !== option && !item.disabled);
      if (!next) return;
      event.preventDefault();
      next.focus();
      next.click();
    });
  });
  document.querySelectorAll("[data-pay-open]").forEach((button, index) => {
    if (!button.id) button.id = `pay-open-${index + 1}`;
    button.addEventListener("click", () => {
      method = names[button.dataset.payOpen] ? button.dataset.payOpen : "wechat";
      openDialog(dialog, button);
      load();
    });
  });
  dialog.addEventListener("close", reset);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && dialog.open && order?.status === "pending") {
      const token = reset();
      poll(token);
    }
  });
  const initial = new URLSearchParams(location.search).get("checkout");
  if (names[initial]) {
    method = initial;
    openDialog(dialog);
    load();
  }
};
