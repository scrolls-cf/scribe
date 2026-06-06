const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function pickPhrase(phrases) {
  return phrases[Math.floor(Math.random() * phrases.length)];
}

export function setLoadingText(el, phrases) {
  if (!el) return;
  el.textContent = pickPhrase(phrases);
}

export function toast(message, { duration = 2200 } = {}) {
  let root = document.getElementById("scribe-toast");
  if (!root) {
    root = document.createElement("div");
    root.id = "scribe-toast";
    root.className = "scribe-toast";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    document.body.append(root);
  }
  root.textContent = message;
  root.dataset.visible = "true";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    root.dataset.visible = "false";
  }, duration);
}

export function flashNode(el, className = "is-flash") {
  if (!el) return;
  el.classList.add(className);
  const ms = reducedMotion() ? 0 : 380;
  setTimeout(() => el.classList.remove(className), ms);
}

export function dismissNode(el, onDone) {
  if (!el) {
    onDone?.();
    return;
  }
  if (reducedMotion()) {
    el.remove();
    onDone?.();
    return;
  }
  el.classList.add("is-dismissing");
  el.addEventListener(
    "animationend",
    () => {
      el.remove();
      onDone?.();
    },
    { once: true },
  );
}

export function devNote() {
  if (sessionStorage.getItem("scribe-dev-note")) return;
  sessionStorage.setItem("scribe-dev-note", "1");
  console.info("scribe · devscrolls planning surface");
}
