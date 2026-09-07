const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const phaseMap = {
  intent: "intent",
  discover: "discover",
  trust: "trust",
  policy: "policy",
  pay: "pay",
  service: "verify",
  verify: "verify",
  settle: "settle",
  receipt: "receipt",
};

const CIRCLE_CATEGORIES = [
  { id: "CREATIVE", label: "Creative" },
  { id: "DATA_ENRICHMENT", label: "Data Enrichment" },
  { id: "FINANCIAL_ANALYSIS", label: "Financial Analysis" },
  { id: "INFRASTRUCTURE", label: "Infrastructure" },
  { id: "PREDICTION_MARKETS", label: "Prediction Markets" },
  { id: "SOCIAL_INTELLIGENCE", label: "Social Intelligence" },
  { id: "WEB_SEARCH_RESEARCH", label: "Web Search Research" },
];

let identities = null;
let playing = false;
let clarifying = false;
let sessionId = null;
let sellerTab = "shopify";
let activeCategory = "";
let lastCatalog = { digital: [], shopify: [], digitalMeta: null };
let lastPrompt = "";
let pending = null;
let receipts = [];

function resetPhases() {
  document.querySelectorAll(".phase-step").forEach((el) => el.classList.remove("lit", "fail"));
}
function lightPhase(id, failed) {
  const el = document.querySelector(`.phase-step[data-phase="${id}"]`);
  if (!el) return;
  el.classList.add(failed ? "fail" : "lit");
}
function setRail(policy) {
  const badge = $("railBadge");
  badge.className = "rail-badge";
  if (!policy) {
    badge.textContent = "rail · idle";
    return;
  }
  if (policy.decision === "REJECT") {
    badge.textContent = "rejected";
    badge.classList.add("reject");
    return;
  }
  if (policy.rail === "DIRECT") {
    badge.textContent = "nano · instant";
    badge.classList.add("direct");
    return;
  }
  badge.textContent = "escrow · protected";
  badge.classList.add("protected");
}

function addBubble(feed, kind, text, label) {
  const wrap = document.createElement("div");
  wrap.className = `bwrap ${kind === "out" ? "sent" : kind === "sys" ? "mid" : "recv"}`;
  if (label) {
    const l = document.createElement("div");
    l.className = "blabel";
    l.textContent = label;
    wrap.appendChild(l);
  }
  const b = document.createElement("div");
  b.className = `bubble ${kind}`;
  b.textContent = text;
  wrap.appendChild(b);
  feed.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
  return wrap;
}

function addHtml(feed, html, kind = "inc", label = "ARC Agent") {
  const wrap = document.createElement("div");
  wrap.className = `bwrap ${kind === "out" ? "sent" : kind === "sys" ? "mid" : "recv"}`;
  if (label) {
    const l = document.createElement("div");
    l.className = "blabel";
    l.textContent = label;
    wrap.appendChild(l);
  }
  const b = document.createElement("div");
  b.className = `bubble ${kind === "sys" ? "sys" : kind}`;
  b.innerHTML = html;
  wrap.appendChild(b);
  feed.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
  return wrap;
}

function addCollapseCard(feed, title, summary, rows, extras) {
  const wrap = document.createElement("div");
  wrap.className = "bwrap recv";
  const details = document.createElement("details");
  details.className = "kv-details";
  const list = extras?.list?.filter(Boolean) || [];
  details.innerHTML =
    `<summary><span>${esc(title)}</span><strong>${esc(summary)}</strong></summary>` +
    `<div class="kv-details-body">` +
    Object.entries(rows)
      .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`)
      .join("") +
    (list.length
      ? `<div class="kv-list"><div class="kv-list-label">${esc(extras.listLabel || "Why")}</div><ul>${list
          .map((item) => `<li>${esc(item)}</li>`)
          .join("")}</ul></div>`
      : "") +
    `</div>`;
  wrap.appendChild(details);
  feed.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
}

function addQuoteHero(feed, body) {
  const wrap = document.createElement("div");
  wrap.className = "bwrap recv";
  const label = document.createElement("div");
  label.className = "blabel";
  label.textContent = "ARC Agent";
  wrap.appendChild(label);
  const hero = document.createElement("div");
  hero.className = "quote-hero";
  const change = body.change24h == null ? "" : `24h ${Number(body.change24h) >= 0 ? "+" : ""}${Number(body.change24h).toFixed(2)}%`;
  hero.innerHTML =
    `<div class="quote-kicker">Live from the Arc x402 seller</div>` +
    `<div class="quote-price">${esc(body.asset || "ETH")} ${Number(body.price).toFixed(2)} USD</div>` +
    (change ? `<div class="quote-chg">${esc(change)}</div>` : "") +
    (body.summary ? `<div class="quote-note">${esc(String(body.summary))}</div>` : "");
  wrap.appendChild(hero);
  feed.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
}

function scanLink(url) {
  if (!url) return "";
  return `<a class="scan-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Verify Identity of Agent ↗</a>`;
}

function kvHtml(title, rows) {
  return `<div class="pop-title">${title}</div>` +
    Object.entries(rows)
      .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`)
      .join("");
}

function walletSectionHtml(title, rows) {
  return `<div class="pop-section">${esc(title)}</div>` +
    Object.entries(rows)
      .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`)
      .join("");
}

function renderWalletPop(role) {
  const wallet = role === "buyer" ? identities?.wallets?.buyer : identities?.wallets?.seller;
  const el = role === "buyer" ? $("buyerWalletPop") : $("sellerWalletPop");
  const usdc = wallet?.usdc == null ? "—" : `${Number(wallet.usdc).toFixed(2)} USDC`;
  el.innerHTML =
    `<div class="pop-title">${role === "buyer" ? "BUYER · AGENT WALLET" : "SELLER · AGENT WALLET"}</div>` +
    walletSectionHtml("Balance", {
      USDC: usdc,
      Source: wallet?.source === "adapter" || identities?.paymentMode === "adapter" ? "adapter overlay" : wallet?.source || "—",
    }) +
    walletSectionHtml("Wallet", {
      Product: wallet?.product || "Circle Agent Wallet",
      Custody: wallet?.custody || "user-controlled 2-of-2 MPC",
      Chain: wallet?.chain || "Arc Testnet",
      Id: wallet?.walletId || "unassigned",
      Address: wallet?.address || "unassigned",
    }) +
    walletSectionHtml("Spend policy", {
      Rule: wallet?.spendPolicy?.note || "—",
      x402: wallet?.spendPolicy?.x402 ? "enabled" : "receive",
      Escrow:
        role === "buyer"
          ? "AuthCapture holds USDC until you confirm delivery"
          : "Seller cannot spend escrowed USDC until capture",
    }) +
    `<div class="pop-section">Last 3 transactions</div>` +
    txListHtml(role);
}

function shortAddr(addr) {
  if (!addr) return "unassigned";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHash(hash) {
  if (!hash || hash === "pending") return "pending";
  return `${hash.slice(0, 8)}…`;
}

function money(n) {
  if (n == null) return "—";
  if (n === 0) return "$0";
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

function productThumb(url) {
  return url
    ? `<img class="p-ph" src="${esc(url)}" alt="" onerror="this.style.visibility='hidden'" />`
    : `<div class="p-ph"></div>`;
}

function txListHtml(role) {
  const rows = receipts.slice(0, 3);
  if (!rows.length) return `<div class="tx-empty">No transactions yet</div>`;
  return rows
    .map((tx) => {
      const outbound = role === "buyer";
      const cls = outbound ? "tx-out" : "tx-in";
      const sign = outbound ? "−" : "+";
      const href = esc(tx.explorerUrl || "#");
      const when = tx.createdAt ? new Date(tx.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      return `<div class="tx-row">
        <div class="${cls}">${sign}$${esc(tx.amount)} · ${esc(tx.rail || "USDC")}</div>
        <div class="tx-meta"><span>${esc(tx.service || "")}</span><span>${esc(when)}</span></div>
        <div class="tx-meta"><span>${esc(tx.outcome || "")}</span><a href="${href}" target="_blank" rel="noreferrer">${esc(shortHash(tx.paymentTxHash))}</a></div>
      </div>`;
    })
    .join("");
}

async function refreshReceipts() {
  try {
    receipts = await fetch("/api/receipts").then((r) => r.json());
  } catch {
    receipts = [];
  }
}

function fillCategories() {
  const row = $("categoryRow");
  row.innerHTML = CIRCLE_CATEGORIES.map(
    (c) => `<button type="button" class="cat-chip" data-cat="${c.id}">${esc(c.label)}</button>`,
  ).join("");
  row.querySelectorAll(".cat-chip").forEach((btn) => {
    btn.addEventListener("click", () => browseCategory(btn.dataset.cat));
  });
}

function setSellerTab(tab, opts = {}) {
  sellerTab = tab;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  $("categoryRow").hidden = true;
  $("sellerName").textContent = tab === "shopify" ? "Shopify Agent" : "Arc x402 seller";
  if (!opts.skipRender) return renderSellerCatalog(opts);
}

function highlightRow(row) {
  $("feedSeller").querySelectorAll(".product-row").forEach((el) => el.classList.remove("glow"));
  if (row) row.classList.add("glow");
}

async function renderSellerCatalog(opts = {}) {
  const feed = $("feedSeller");
  const items = sellerTab === "shopify" ? lastCatalog.shopify : lastCatalog.digital;
  if (!items?.length) {
    feed.innerHTML = `<div class="empty-hint">${sellerTab === "shopify" ? "Waiting on ARC Agent" : "Pick a category or ask ARC Agent"}</div>`;
    return;
  }
  feed.innerHTML = "";
  const status = document.createElement("div");
  status.className = "merchant-status";
  if (sellerTab === "shopify") status.textContent = `UCP · ${items.length} matching offers`;
  else {
    const meta = lastCatalog.digitalMeta || {};
    status.textContent = `${(meta.category || "Arc x402").replace(/_/g, " ")} · ${items.length} of ${meta.total ?? "?"}`;
  }
  feed.appendChild(status);
  const rows = items.slice(0, 5);
  for (let i = 0; i < rows.length; i++) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "product-row";
    if (sellerTab === "shopify") {
      const offer = rows[i];
      row.innerHTML = `
        ${productThumb(offer.imageUrl)}
        <div>
          <div class="p-vendor">${esc(offer.merchantName)}</div>
          <div class="p-title">${esc(offer.title)}</div>
          <div class="p-price">$${(offer.priceCents / 100).toFixed(2)}</div>
        </div>
        <div class="p-bid"><div class="p-rail">Shopify UCP</div><span class="bid-amt">escrow on Arc</span></div>`;
      row.addEventListener("click", () => selectOffer("shopify", offer, row));
    } else {
      const listing = rows[i];
      const net = (listing.advertisedNetwork || listing.networks?.[0] || "unknown").replace("eip155:", "chain ");
      const rail = listing.priceUsd == null || listing.priceUsd === 0 ? "listed" : listing.priceUsd >= 100 ? "escrow" : "nano";
      row.innerHTML = `
        ${productThumb()}
        <div>
          <div class="p-vendor">${esc(listing.name)} · ${esc(listing.category)}</div>
          <div class="p-title">${esc(listing.description || listing.resource)}</div>
          <div class="p-price">${money(listing.priceUsd)}</div>
        </div>
        <div class="p-bid"><div class="p-rail">${rail}</div><span class="bid-amt">${esc(net)}</span></div>`;
      row.addEventListener("click", () => selectOffer("digital", listing, row));
    }
    feed.appendChild(row);
    if (opts.stagger) await sleep(70);
    row.classList.add("show");
    if (i === 0) row.classList.add("glow");
  }
}

function lockChoices(selected) {
  $("feedBuyer").querySelectorAll(".choice-chip:not(:disabled)").forEach((btn) => {
    btn.disabled = true;
    const q = String(btn.dataset.q || "").trim().toLowerCase();
    btn.classList.toggle("is-selected", Boolean(selected) && q === String(selected).trim().toLowerCase());
  });
}

function addAgentAsk(message, options) {
  const chips = (options || [])
    .map((opt) => `<button type="button" class="choice-chip" data-q="${esc(opt)}">${esc(opt)}</button>`)
    .join("");
  const wrap = addHtml(
    $("feedBuyer"),
    `${esc(message)}${chips ? `<div class="choice-row">${chips}</div>` : ""}`,
  );
  wrap.querySelectorAll(".choice-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (playing) return;
      onSubmit(btn.dataset.q);
    });
  });
}

function offerTitle(kind, item) {
  if (kind === "shopify") return item.title;
  return item.description || item.name;
}

function offerPrice(kind, item) {
  if (kind === "shopify") return item.priceCents / 100;
  return item.priceUsd;
}

function renderChatOffers(kind, items) {
  const ranked = [...items].sort((a, b) => (offerPrice(kind, a) ?? 999) - (offerPrice(kind, b) ?? 999));
  const pick = ranked[0] || items[0];
  const cards = ranked
    .slice(0, 5)
    .map((item) => {
      const title = offerTitle(kind, item);
      const price = offerPrice(kind, item);
      const thumb = kind === "shopify" ? productThumb(item.imageUrl) : productThumb();
      const vendor = kind === "shopify" ? item.merchantName : item.name;
      const selected = item === pick || (kind === "shopify" ? item.productId === pick.productId : item.resource === pick.resource);
      const idx = items.indexOf(item);
      return `<button type="button" class="chat-offer${selected ? " pick" : ""}" data-i="${idx}">${thumb}<div><div class="p-vendor">${esc(vendor)}</div><div class="p-title">${esc(title)}</div></div><div class="p-price">${kind === "shopify" ? `$${Number(price).toFixed(2)}` : money(price)}</div></button>`;
    })
    .join("");
  const wrap = addHtml(
    $("feedBuyer"),
    `I found ${ranked.length}. I recommend <b>${esc(offerTitle(kind, pick))}</b> — tap to choose, then approve.<div class="chat-offers">${cards}</div>`,
  );
  wrap.querySelectorAll(".chat-offer").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".chat-offer").forEach((el) => el.classList.remove("pick"));
      btn.classList.add("pick");
      const item = items[Number(btn.dataset.i)];
      selectOffer(kind, item);
    });
  });
}

function selectOffer(kind, item, row) {
  if (playing) return;
  if (kind === "digital" && (item.priceUsd == null || item.priceUsd === 0)) {
    addBubble($("feedBuyer"), "sys", `${item.name} is listed at $0 — catalog only.`);
    return;
  }
  pending = { kind, item };
  if (row) highlightRow(row);
  askApproval();
}

function askApproval() {
  if (!pending) return;
  const { kind, item } = pending;
  const title = offerTitle(kind, item);
  const price = offerPrice(kind, item);
  const wrap = addHtml(
    $("feedBuyer"),
    `<div>Approve <b>${esc(title)}</b> for ${esc(kind === "shopify" ? `$${price.toFixed(2)}` : money(price))} from your Agent Wallet?</div>
     <div class="approve-row">
       <button type="button" class="approve-btn" data-decision="approve">Approve</button>
       <button type="button" class="approve-btn reject" data-decision="reject">Reject</button>
     </div>`,
    "inc",
    "human",
  );
  wrap.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      wrap.querySelectorAll(".approve-btn").forEach((b) => (b.disabled = true));
      if (btn.dataset.decision !== "approve") {
        pending = null;
        addBubble($("feedBuyer"), "inc", "Rejected. Tap another listing or tell me what to get.", "ARC Agent");
        return;
      }
      addBubble($("feedBuyer"), "out", "Approved", "you");
      const extra =
        pending.kind === "shopify"
          ? { shopifyOffer: pending.item, maxSpendUsd: pending.item.priceCents / 100 }
          : {
              marketplaceListing: pending.item,
              maxSpendUsd: Math.max((pending.item.priceUsd || 0.01) * 2, 0.05),
            };
      const prompt =
        pending.kind === "shopify"
          ? lastPrompt || `Buy ${pending.item.title}`
          : `Buy ${offerTitle("digital", pending.item)}. Spend up to $${extra.maxSpendUsd}`;
      pending = null;
      await runTransaction(prompt, extra);
    });
  });
}

async function browseCategory(category) {
  if (playing) return;
  activeCategory = category;
  $("categoryRow").querySelectorAll(".cat-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cat === category);
  });
  await onSubmit("", { category, reset: true });
}

async function loadIdentities() {
  const res = await fetch("/api/identities");
  identities = await res.json();
  $("modePill").textContent = identities.paymentMode || "adapter";
  const buyerWallet = identities.wallets?.buyer;
  const sellerWallet = identities.wallets?.seller;
  const buyerUsdc = buyerWallet?.usdc == null ? null : Number(buyerWallet.usdc).toFixed(2);
  $("buyerSub").textContent = buyerUsdc == null ? "Circle Agent Wallet" : `${buyerUsdc} USDC`;
  $("buyerWalletChip").textContent = buyerUsdc == null
    ? shortAddr(buyerWallet?.address)
    : `${buyerUsdc} · ${shortAddr(buyerWallet?.address)}`;
  const sellerUsdc = sellerWallet?.usdc == null ? null : Number(sellerWallet.usdc).toFixed(2);
  $("sellerSub").textContent = sellerUsdc == null
    ? `Agent Wallet · ${sellerWallet?.address || "unassigned"}`
    : `${sellerUsdc} USDC · ${sellerWallet?.address || "unassigned"}`;
  $("buyerPopover").innerHTML = kvHtml("BUYER · ERC-8004", {
    Agent: `#${identities.buyer.agentId}`,
    Name: identities.buyer.name,
    Identity: identities.buyer.identityVerified ? "verified" : "missing",
    Source: identities.buyer.source || "adapter",
    x402: identities.buyer.x402Supported ? "yes" : "no",
    Feedback: identities.buyer.reputationSignals,
    Validations: identities.buyer.validationSignals,
  }) + scanLink(identities.buyer.scanUrl);
  $("sellerPopover").innerHTML = kvHtml("SELLER · ERC-8004", {
    Agent: `#${identities.seller.agentId}`,
    Name: identities.seller.name,
    Identity: identities.seller.identityVerified ? "verified" : "missing",
    Source: identities.seller.source || "adapter",
    x402: identities.seller.x402Supported ? "yes" : "no",
    Feedback: identities.seller.reputationSignals,
    Validations: identities.seller.validationSignals,
  }) + scanLink(identities.seller.scanUrl);
  await refreshReceipts();
  renderWalletPop("buyer");
  renderWalletPop("seller");
}

document.querySelectorAll(".popover, .wallet-sheet, .profile-sheet").forEach((el) => {
  el.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (link) {
      e.stopPropagation();
      if (link.classList.contains("scan-link")) {
        e.preventDefault();
        window.open(link.href, "_blank", "noopener,noreferrer");
      }
      return;
    }
    e.stopPropagation();
  });
});
document.querySelectorAll(".pop-wrap").forEach((wrap) => {
  wrap.querySelector("button").addEventListener("click", async (e) => {
    e.stopPropagation();
    const open = wrap.classList.contains("open");
    document.querySelectorAll(".pop-wrap").forEach((w) => w.classList.remove("open"));
    if (!open) {
      wrap.classList.add("open");
      if (wrap.id === "buyerWalletWrap" || wrap.id === "sellerWalletWrap") {
        await refreshReceipts();
        renderWalletPop(wrap.id === "buyerWalletWrap" ? "buyer" : "seller");
      }
    }
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".pop-wrap").forEach((w) => w.classList.remove("open"));
});
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => setSellerTab(btn.dataset.tab));
});
document.querySelectorAll(".prompt-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (playing) return;
    onSubmit(btn.dataset.q, { reset: true });
  });
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = $("q").value.trim();
  if (!prompt || playing) return;
  await onSubmit(prompt);
});

async function onSubmit(prompt, opts = {}) {
  playing = true;
  $("form").querySelector("button").disabled = true;
  const followUp = clarifying && sessionId && !opts.reset && !opts.category;
  if (!followUp) {
    $("feedBuyer").innerHTML = "";
    resetPhases();
    setRail(null);
    sessionId = null;
    pending = null;
  }
  if (prompt) {
    lastPrompt = prompt;
    addBubble($("feedBuyer"), "out", prompt, "you");
    lockChoices(prompt);
  }
  $("q").value = "";
  lightPhase("intent");

  let data;
  try {
    data = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        sessionId: followUp ? sessionId : null,
        category: opts.category || undefined,
      }),
    }).then((r) => r.json());
  } catch (err) {
    addBubble($("feedBuyer"), "sys", String(err));
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }

  sessionId = data.sessionId;
  if (data.stopReason !== "ready") {
    clarifying = true;
    addAgentAsk(data.agentMessage, data.options);
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }

  clarifying = false;
  lastCatalog = {
    digital: data.digital || [],
    shopify: data.shopify || [],
    digitalMeta: data.digitalMeta || null,
  };
  lightPhase("discover");

  if (data.shopify?.length) {
    await setSellerTab("shopify", { stagger: true });
    if (data.agentMessage && !/^Searching Shopify/i.test(data.agentMessage)) {
      addBubble($("feedBuyer"), "inc", data.agentMessage, "ARC Agent");
    }
    renderChatOffers("shopify", data.shopify);
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }
  const micro =
    data.parsed?.serviceType === "financial-data" ||
    (typeof data.parsed?.maxPriceCents === "number" && data.parsed.maxPriceCents <= 100 && data.parsed.channel === "digital");
  if (micro) {
    await setSellerTab("digital", { skipRender: true });
    const chart = /ohlc|candle|chart/i.test(lastPrompt || prompt);
    addBubble($("feedBuyer"), "inc", chart
      ? "Paying the Arc x402 seller for ETH OHLC…"
      : "Paying the Arc x402 seller for an ETH tick…", "ARC Agent");
    playing = false;
    await runTransaction(lastPrompt || prompt, {
      maxSpendUsd: data.parsed?.maxPriceCents ? data.parsed.maxPriceCents / 100 : 0.05,
    });
    return;
  }
  if (data.digital?.length) {
    if (data.parsed?.category) {
      activeCategory = data.parsed.category;
      $("categoryRow").querySelectorAll(".cat-chip").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.cat === activeCategory);
      });
    }
    await setSellerTab("digital", { stagger: true });
    addBubble($("feedBuyer"), "inc", data.agentMessage || `Found ${data.digital.length} Circle listings.`, "ARC Agent");
    renderChatOffers("digital", data.digital);
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }
  addBubble($("feedBuyer"), "inc", data.agentMessage || "Nothing matched that. Try another ask.", "ARC Agent");

  playing = false;
  $("form").querySelector("button").disabled = false;
}

function paymentCopy(result) {
  const rail = result.policy?.rail;
  const outcome = result.receipt?.outcome;
  const amount = result.payment?.amountUsd;
  const paid = Number(amount) > 0 || Boolean(result.payment?.settleTxHash || result.receipt?.paymentTxHash);
  if (result.policy?.decision === "REJECT") {
    return (result.policy.reasons || [])[0] || "Fail closed. No payment sent.";
  }
  if (rail === "DIRECT") {
    if (outcome === "FAILED") {
      return paid
        ? "Paid, but independent verification rejected the payload."
        : "Seller failed. Nanopayment was not sent — seller received 0 USDC.";
    }
    return `Paid ${amount} USDC from your Agent Wallet.`;
  }
  if (result.awaitingDelivery || outcome === "HELD") {
    return `${amount} USDC locked in operator escrow. Seller cannot spend until you confirm delivery.`;
  }
  if (outcome === "VOIDED") {
    return `Dispute raised. ${amount} USDC refunded to your Agent Wallet. Seller was not paid.`;
  }
  return `${amount} USDC released from escrow to the seller.`;
}

function lightStages(result) {
  setRail(result.policy);
  for (const stage of result.stages || []) {
    if (stage.status === "pending") continue;
    lightPhase(phaseMap[stage.id] || stage.id, stage.status === "failed");
  }
}

function showDeliverable(result) {
  if (result.policy?.decision === "REJECT") return;
  if (result.verification && !result.verification.verified) return;
  const delivered = result.seller?.body || {};
  if (delivered.price != null) {
    addQuoteHero($("feedBuyer"), delivered);
  } else if (delivered.summary) {
    addBubble($("feedBuyer"), "inc", String(delivered.summary), "ARC Agent");
  } else if (delivered.orderId) {
    addBubble($("feedBuyer"), "inc", `Order ${delivered.orderId} · ${delivered.title || "Shopify"}`, "ARC Agent");
  }
}

function showVerification(result) {
  if (!result.verification) return;
  const checks = result.verification.checks || {};
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const rows = {
    Result: result.verification.verified ? "PASSED" : "FAILED",
    Checks: `${passed}/${total} pass`,
    ...Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v ? "pass" : "fail"])),
  };
  addCollapseCard(
    $("feedBuyer"),
    "Verification",
    result.verification.verified ? `PASSED · ${passed}/${total}` : `FAILED · ${passed}/${total}`,
    rows,
  );
}

function showReceipt(result) {
  if (!result.receipt) return;
  addCollapseCard($("feedBuyer"), "Receipt", `${result.receipt.outcome} · ${result.receipt.amount} USDC`, {
    Service: result.receipt.service,
    Amount: `${result.receipt.amount} USDC`,
    Rail: result.receipt.rail,
    Status: result.receipt.outcome,
    Tx: result.receipt.paymentTxHash,
    Mode: result.receipt.paymentMode,
  });
}

function closeDeliveryModal() {
  const modal = $("deliveryModal");
  if (modal?.open) modal.close();
}

function askDelivery(result) {
  const modal = $("deliveryModal");
  const yes = $("deliveryYes");
  const no = $("deliveryNo");
  if (!modal || !yes || !no) return;
  yes.disabled = false;
  no.disabled = false;
  const pick = async (received) => {
    yes.disabled = true;
    no.disabled = true;
    closeDeliveryModal();
    addBubble($("feedBuyer"), "out", received ? "Yes" : "No", "you");
    await settleDelivery(result.runId, received);
  };
  yes.onclick = () => pick(true);
  no.onclick = () => pick(false);
  if (typeof modal.showModal === "function") {
    if (!modal.open) modal.showModal();
    return;
  }
  modal.setAttribute("open", "");
}

async function settleDelivery(runId, received) {
  playing = true;
  $("form").querySelector("button").disabled = true;
  addBubble(
    $("feedBuyer"),
    "inc",
    received ? "Releasing escrow to the seller…" : "Dispute raised. Refunding escrow to your Agent Wallet…",
    "ARC Agent",
  );
  try {
    const res = await fetch(`/api/transactions/${runId}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received }),
    });
    const result = await res.json();
    if (!res.ok || result.error) {
      addBubble($("feedBuyer"), "sys", result.error || `Settle failed (${res.status})`);
      playing = false;
      $("form").querySelector("button").disabled = false;
      return;
    }
    lightStages(result);
    if (result.payment) addBubble($("feedBuyer"), "inc", paymentCopy(result), "ARC Agent");
    showReceipt(result);
    await loadIdentities();
  } catch (err) {
    addBubble($("feedBuyer"), "sys", String(err));
  }
  playing = false;
  $("form").querySelector("button").disabled = false;
  sessionId = null;
}

async function runTransaction(prompt, extra = {}) {
  playing = true;
  $("form").querySelector("button").disabled = true;
  addBubble($("feedBuyer"), "inc", looksLikeLiveEth(prompt) ? "Paying the Arc x402 seller…" : "Checking whether the Arc seller can answer that…", "ARC Agent");

  let result;
  try {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        simulateFailure: $("failToggle").checked,
        maxSpendUsd: extra.maxSpendUsd,
        shopifyOffer: extra.shopifyOffer,
        marketplaceListing: extra.marketplaceListing,
      }),
    });
    result = await res.json();
    if (!res.ok || result.error) {
      addBubble($("feedBuyer"), "sys", result.error || `Payment failed (${res.status})`);
      playing = false;
      $("form").querySelector("button").disabled = false;
      return;
    }
  } catch (err) {
    addBubble($("feedBuyer"), "sys", String(err));
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }

  lightStages(result);
  if (result.policy) {
    const rail = result.policy.rail === "DIRECT" ? "Nanopayment" : "Escrow";
    addCollapseCard(
      $("feedBuyer"),
      "Policy",
      `${result.policy.decision} · ${rail}`,
      {
        Decision: result.policy.decision,
        Rail: result.policy.rail === "DIRECT" ? "Nanopayment" : "AuthCapture escrow",
      },
      { listLabel: "Why", list: result.policy.reasons },
    );
  }
  if (result.policy?.decision === "REJECT") {
    addBubble($("feedBuyer"), "sys", paymentCopy(result));
    showReceipt(result);
    await loadIdentities();
    playing = false;
    $("form").querySelector("button").disabled = false;
    sessionId = null;
    return;
  }
  if (result.payment) addBubble($("feedBuyer"), "inc", paymentCopy(result), "ARC Agent");
  showDeliverable(result);
  showVerification(result);
  if (result.awaitingDelivery) {
    showReceipt(result);
    await sleep(tourActive ? 4500 : 2500);
    askDelivery(result);
    await loadIdentities();
    return;
  }
  showReceipt(result);
  await loadIdentities();
  playing = false;
  $("form").querySelector("button").disabled = false;
  sessionId = null;
}

function looksLikeLiveEth(prompt) {
  const t = String(prompt || "");
  if (/\b(btc|bitcoin)\b/i.test(t)) return false;
  if (/\b20\d{2}\b/.test(t)) return false;
  return true;
}

let tourActive = false;
let tourResolveNext = null;
let tourToken = 0;

function clearTourHighlight() {
  document.querySelectorAll(".tour-pulse").forEach((el) => el.classList.remove("tour-pulse"));
  const spot = $("tourSpot");
  if (spot) {
    spot.style.opacity = "0";
  }
}

function placeTourTip(target) {
  const tip = $("tourTip");
  const spot = $("tourSpot");
  if (!tip || !spot) return;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (target) {
    const r = target.getBoundingClientRect();
    spot.style.opacity = "1";
    spot.style.top = `${Math.max(4, r.top - pad)}px`;
    spot.style.left = `${Math.max(4, r.left - pad)}px`;
    spot.style.width = `${Math.min(vw - 8, r.width + pad * 2)}px`;
    spot.style.height = `${Math.min(vh - 8, r.height + pad * 2)}px`;
    target.classList.add("tour-pulse");
    const tipW = Math.min(320, vw - 24);
    let left = Math.min(vw - tipW - 12, Math.max(12, r.left));
    let top = r.bottom + 14;
    if (top + 180 > vh) top = Math.max(12, r.top - 190);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  } else {
    spot.style.opacity = "0";
    tip.style.left = `${Math.max(12, (vw - 320) / 2)}px`;
    tip.style.top = `${Math.max(24, vh * 0.28)}px`;
  }
}

function openTourUi() {
  const root = $("tourRoot");
  if (!root) return;
  root.hidden = false;
}

function closeTourUi() {
  const root = $("tourRoot");
  if (root) root.hidden = true;
  clearTourHighlight();
  if (tourResolveNext) {
    tourResolveNext();
    tourResolveNext = null;
  }
}

async function waitForSelector(selector, { timeout = 45000, predicate } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!tourActive) throw new Error("tour-aborted");
    const el = document.querySelector(selector);
    if (el && (!predicate || predicate(el))) return el;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitWhileBusy(timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!tourActive) throw new Error("tour-aborted");
    if (!playing) return;
    await sleep(120);
  }
  throw new Error("Timed out waiting for the demo to finish a step");
}

function waitForTourNext(autoMs = 0) {
  return new Promise((resolve) => {
    tourResolveNext = () => {
      tourResolveNext = null;
      resolve("next");
    };
    if (autoMs > 0) {
      setTimeout(() => {
        if (tourResolveNext) {
          tourResolveNext();
        }
      }, autoMs);
    }
  });
}

async function runTourStep({ step, total, title, body, target, nextLabel = "Next", autoMs = 4500, action }) {
  if (!tourActive) return;
  clearTourHighlight();
  $("tourStep").textContent = `${step} / ${total}`;
  $("tourTitle").textContent = title;
  $("tourBody").textContent = body;
  $("tourNext").textContent = nextLabel;
  placeTourTip(target || null);
  // Let the highlight settle before the countdown feels urgent.
  await sleep(500);
  if (!tourActive) return;
  await waitForTourNext(autoMs);
  if (!tourActive) return;
  if (typeof action === "function") {
    await action();
    // Give people time to watch the UI react after each click.
    await sleep(1200);
  }
}

function closeAllPops() {
  document.querySelectorAll(".pop-wrap").forEach((w) => w.classList.remove("open"));
}

async function openBuyerProfile() {
  closeAllPops();
  $("buyerProfileWrap")?.classList.add("open");
}

async function openSellerProfile() {
  closeAllPops();
  $("sellerProfileWrap")?.classList.add("open");
}

async function openBuyerWallet() {
  closeAllPops();
  await refreshReceipts();
  renderWalletPop("buyer");
  $("buyerWalletWrap")?.classList.add("open");
}

async function startShopifyTutorial() {
  if (tourActive || playing) return;
  const token = ++tourToken;
  tourActive = true;
  $("tutorialBtn").disabled = true;
  const fail = $("failToggle");
  if (fail) fail.checked = false;
  closeDeliveryModal();
  closeAllPops();
  openTourUi();

  const total = 10;
  try {
    await runTourStep({
      step: 1,
      total,
      title: "Shopify walkthrough",
      body: "We will buy chocolates on Shopify with AuthCapture escrow, then open the wallet and agent profile so you can see settlement and ERC-8004 identity.",
      target: $("buyerPanel"),
      nextLabel: "Start",
      autoMs: 0,
    });
    if (!tourActive || token !== tourToken) return;

    const chip = document.querySelector('.prompt-chip[data-q="Find me chocolates under $10"]');
    await runTourStep({
      step: 2,
      total,
      title: "Ask for something",
      body: "Tap chocolates. ARC Agent searches Shopify with your spend cap.",
      target: chip,
      nextLabel: "Click chocolates",
      autoMs: 5500,
      action: () => chip?.click(),
    });
    if (!tourActive || token !== tourToken) return;

    clearTourHighlight();
    $("tourBody").textContent = "Searching Shopify… watch the seller panel fill with listings.";
    $("tourTitle").textContent = "Discovery";
    $("tourStep").textContent = `3 / ${total}`;
    placeTourTip($("sellerPanel"));
    await waitWhileBusy();
    await sleep(1500);
    const offer = await waitForSelector(".chat-offer.pick, .chat-offer");
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 3,
      total,
      title: "Pick a product",
      body: "Shopify listings appear here. We select the recommended item for you.",
      target: offer,
      nextLabel: "Select item",
      autoMs: 5500,
      action: () => offer?.click(),
    });
    if (!tourActive || token !== tourToken) return;

    const approve = await waitForSelector('button.approve-btn[data-decision="approve"]');
    await sleep(800);
    await runTourStep({
      step: 4,
      total,
      title: "Approve the spend",
      body: "Approve locks the order into policy and AuthCapture escrow. USDC does not leave until delivery is confirmed.",
      target: approve,
      nextLabel: "Approve",
      autoMs: 6000,
      action: () => approve?.click(),
    });
    if (!tourActive || token !== tourToken) return;

    clearTourHighlight();
    $("tourTitle").textContent = "Policy and escrow";
    $("tourBody").textContent = "Watch the top phases light up. Policy chooses PROTECTED escrow for Shopify. A receipt appears, then the delivery question.";
    $("tourStep").textContent = `5 / ${total}`;
    placeTourTip($("phases") || document.querySelector(".phases"));
    await waitForSelector("#deliveryModal", {
      timeout: 90000,
      predicate: (el) => el.open || el.hasAttribute("open"),
    });
    await sleep(1200);
    if (!tourActive || token !== tourToken) return;

    const yes = $("deliveryYes");
    const modal = $("deliveryModal");
    let inlineNote = null;
    if (modal) {
      inlineNote = document.createElement("div");
      inlineNote.className = "tour-inline-note";
      inlineNote.textContent = "Tutorial: click Yes to capture escrow to the seller. No would refund you.";
      modal.insertBefore(inlineNote, modal.firstChild);
    }
    await runTourStep({
      step: 5,
      total,
      title: "Did you receive the item?",
      body: "Yes captures escrow to the seller. No raises a dispute and refunds your Agent Wallet. We will click Yes.",
      target: yes,
      nextLabel: "Click Yes",
      autoMs: 6500,
      action: () => yes?.click(),
    });
    inlineNote?.remove();
    if (!tourActive || token !== tourToken) return;

    clearTourHighlight();
    $("tourTitle").textContent = "Settling";
    $("tourBody").textContent = "Escrow is capturing USDC to the seller. Watch the receipt update.";
    $("tourStep").textContent = `6 / ${total}`;
    placeTourTip($("feedBuyer"));
    await waitWhileBusy();
    await sleep(1800);
    if (!tourActive || token !== tourToken) return;

    const walletBtn = $("buyerWalletWrap")?.querySelector("button");
    await runTourStep({
      step: 7,
      total,
      title: "Open the wallet",
      body: "After payment, open the Circle Agent Wallet. Spend policy and last transactions show the escrow settlement.",
      target: walletBtn,
      nextLabel: "Open wallet",
      autoMs: 5500,
      action: async () => {
        await openBuyerWallet();
      },
    });
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 8,
      total,
      title: "Escrow in the wallet",
      body: "Check Spend policy (AuthCapture holds funds until delivery) and the latest transaction row for this purchase.",
      target: $("buyerWalletPop"),
      nextLabel: "Next",
      autoMs: 6500,
      action: () => closeAllPops(),
    });
    if (!tourActive || token !== tourToken) return;

    const profileBtn = $("buyerProfileWrap")?.querySelector("button");
    await runTourStep({
      step: 9,
      total,
      title: "Verify agent identity",
      body: "Open the ARC Agent profile. ERC-8004 identity is what policy checked before spending. Use Verify Identity of Agent to open 8004scan.",
      target: profileBtn,
      nextLabel: "Open profile",
      autoMs: 5500,
      action: async () => {
        await openBuyerProfile();
      },
    });
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 10,
      total,
      title: "ERC-8004 identity",
      body: "Agent ID, verified identity, x402, feedback, and validations. Missing identity fails closed. You can tap Verify Identity of Agent anytime.",
      target: $("buyerPopover"),
      nextLabel: "Done",
      autoMs: 0,
      action: () => closeAllPops(),
    });
  } catch (err) {
    if (String(err.message || err) !== "tour-aborted") {
      addBubble($("feedBuyer"), "sys", `Tutorial stopped: ${err.message || err}`);
    }
  } finally {
    tourActive = false;
    closeAllPops();
    closeTourUi();
    $("tutorialBtn").disabled = false;
  }
}

$("tutorialBtn")?.addEventListener("click", () => {
  startShopifyTutorial();
});
$("tourSkip")?.addEventListener("click", () => {
  tourActive = false;
  tourToken += 1;
  closeTourUi();
  $("tutorialBtn").disabled = false;
});
$("tourNext")?.addEventListener("click", () => {
  if (tourResolveNext) tourResolveNext();
});
window.addEventListener("resize", () => {
  if (!tourActive) return;
  const pulsed = document.querySelector(".tour-pulse");
  placeTourTip(pulsed);
});

fillCategories();
loadIdentities().catch(() => {
  $("modePill").textContent = "offline";
});
