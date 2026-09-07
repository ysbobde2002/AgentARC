async function load() {
  const [arch, health] = await Promise.all([
    fetch("/api/architecture").then((r) => r.json()),
    fetch("/api/health").then((r) => r.json()),
  ]);
  document.getElementById("modePill").textContent = health.paymentMode || "adapter";
  document.getElementById("footMode").textContent = `${health.paymentMode || "adapter"} mode · ${health.network}`;

  const boundaries = document.getElementById("boundaries");
  if (boundaries && arch.boundaries?.length) {
    const table = document.createElement("table");
    table.className = "lld-table";
    table.innerHTML =
      "<thead><tr><th>Boundary</th><th>Owner</th><th>Contract</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const row of arch.boundaries) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.boundary}</td><td><code>${row.owner}</code></td><td>${row.contract}</td>`;
      body.appendChild(tr);
    }
    table.appendChild(body);
    boundaries.appendChild(table);
  }

  const products = document.getElementById("products");
  if (products) {
    for (const [k, v] of Object.entries(arch.products || {})) {
      const el = document.createElement("article");
      el.className = "paper";
      el.innerHTML = `<div class="paper-head"><strong>${k}</strong></div><p>${v}</p>`;
      products.appendChild(el);
    }
  }
}

load().catch((err) => {
  document.getElementById("modePill").textContent = "offline";
  console.error(err);
});

function svgSize(svg) {
  try {
    const box = svg.getBBox();
    if (box.width && box.height) return { w: box.width, h: box.height };
  } catch {
    /* SVG not in DOM yet */
  }
  const vb = svg.viewBox?.baseVal;
  if (vb?.width && vb?.height) return { w: vb.width, h: vb.height };
  return { w: svg.clientWidth || 800, h: svg.clientHeight || 400 };
}

function bindBoard(board) {
  if (board.dataset.zoomBound) return;
  const viewport = board.querySelector(".arch-viewport");
  const zoomEl = board.querySelector(".arch-zoom");
  const sizer = board.querySelector(".arch-sizer") || zoomEl?.parentElement;
  const svgs = [...(zoomEl?.querySelectorAll("svg") || [])];
  if (!viewport || !zoomEl || !sizer || !svgs.length) return;
  board.dataset.zoomBound = "1";

  const sizes = svgs.map((svg) => {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.maxWidth = "none";
    const sz = svgSize(svg);
    svg.setAttribute("width", String(Math.ceil(sz.w)));
    svg.setAttribute("height", String(Math.ceil(sz.h)));
    return sz;
  });
  const gap = svgs.length > 1 ? 16 : 0;
  const w = sizes.reduce((sum, sz) => sum + sz.w, 0) + gap * Math.max(0, svgs.length - 1);
  const h = Math.max(...sizes.map((sz) => sz.h));

  let scale = 1;
  let fit = 1;
  let drag = null;

  const apply = (anchor) => {
    const prevCx = anchor
      ? (viewport.scrollLeft + viewport.clientWidth / 2) / (anchor.prev || scale)
      : null;
    const prevCy = anchor
      ? (viewport.scrollTop + viewport.clientHeight / 2) / (anchor.prev || scale)
      : null;
    sizer.style.width = `${Math.max(Math.ceil(w * scale), viewport.clientWidth)}px`;
    sizer.style.height = `${Math.max(Math.ceil(h * scale), viewport.clientHeight)}px`;
    zoomEl.style.transform = `scale(${scale})`;
    if (prevCx != null) {
      viewport.scrollLeft = prevCx * scale - viewport.clientWidth / 2;
      viewport.scrollTop = prevCy * scale - viewport.clientHeight / 2;
    } else {
      viewport.scrollLeft = Math.max(0, (w * scale - viewport.clientWidth) / 2);
      viewport.scrollTop = Math.max(0, (h * scale - viewport.clientHeight) / 2);
    }
  };

  const fitToView = () => {
    const rect = viewport.getBoundingClientRect();
    const pad = 20;
    const mode = board.getAttribute("data-fit") || "contain";
    const fitW = (rect.width - pad) / w;
    const fitH = (rect.height - pad) / h;
    if (mode === "width") fit = fitW;
    else fit = Math.min(fitW, fitH);
    if (!Number.isFinite(fit) || fit <= 0) fit = 1;
    scale = fit;
    if (board.classList.contains("arch-board-compact") || board.closest(".arch-pair")) {
      const cap = board.closest(".arch-pair")
        ? Math.min(520, Math.max(280, window.innerHeight - 280))
        : 480;
      viewport.style.height = `${Math.min(cap, Math.max(160, Math.ceil(h * scale) + 16))}px`;
    }
    apply();
  };

  const bump = (dir) => {
    const prev = scale;
    scale = Math.min(3, Math.max(0.25, scale * (dir > 0 ? 1.2 : 1 / 1.2)));
    apply({ prev });
  };

  board.querySelectorAll("[data-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const z = btn.getAttribute("data-zoom");
      if (z === "fit") fitToView();
      else if (z === "+") bump(1);
      else bump(-1);
    });
  });

  viewport.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        bump(e.deltaY < 0 ? 1 : -1);
      }
    },
    { passive: false },
  );

  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button, a")) return;
    drag = { x: e.clientX, y: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop };
    viewport.classList.add("is-panning");
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!drag) return;
    viewport.scrollLeft = drag.sl - (e.clientX - drag.x);
    viewport.scrollTop = drag.st - (e.clientY - drag.y);
  });
  const endDrag = () => {
    drag = null;
    viewport.classList.remove("is-panning");
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  fitToView();
  board._fit = fitToView;
}

window.setupArchZoom = function setupArchZoom() {
  document.querySelectorAll(".arch-board").forEach(bindBoard);
  if (!window.__archZoomResize) {
    window.__archZoomResize = true;
    window.addEventListener("resize", () => {
      document.querySelectorAll(".arch-board").forEach((board) => board._fit?.());
    });
  }
};
if (document.querySelector(".arch-zoom svg")) window.setupArchZoom();
