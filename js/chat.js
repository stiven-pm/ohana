function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appendChatBubble(role, text) {
  const log = document.getElementById("chat-log");
  if (!log) return;
  const safe = text && String(text).trim() ? String(text).trim() : "No tengo una respuesta clara. Prueba otra cosa.";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--" + role;
  bubble.innerHTML = escapeHtml(safe).replace(/\n/g, "<br>");
  log.appendChild(bubble);
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const body = document.getElementById("chat-widget-body");
  if (body) body.scrollTop = body.scrollHeight;
}

function clearSuggestions() {
  const wrap = document.getElementById("chat-suggestions");
  if (wrap) wrap.innerHTML = "";
}

function hideIngredientChips() {
  const chipsEl = document.getElementById("chat-chips");
  if (!chipsEl) return;
  chipsEl.hidden = true;
  chipsEl.innerHTML = "";
}

function renderChatProducts(menu, productIds, limit = 3) {
  const wrap = document.getElementById("chat-suggestions");
  if (!wrap) return;

  clearSuggestions();
  const byId = Object.fromEntries(menu.products.map((p) => [p.id, p]));
  const products = productIds
    .map((id) => byId[id])
    .filter(Boolean)
    .slice(0, limit);

  if (!products.length) return;

  wrap.innerHTML =
    '<p class="chat-suggest-label">Toca para agregar: </p>' +
    '<div class="chat-suggest-row">' +
    products
      .map(
        (product) => `
        <button type="button" class="chat-suggest-pill" data-add="${product.id}">
          <span>${escapeHtml(product.name)}</span>
          <strong>${formatCop(product.price)}</strong>
        </button>`
      )
      .join("") +
    "</div>";

  scrollChatToBottom();
}

function setChatLoading(loading) {
  const btn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");
  if (btn) {
    btn.disabled = loading;
    btn.textContent = loading ? "…" : "➤";
  }
  if (input) input.disabled = loading;
}

const CHAT_STOPWORDS = new Set([
  "hola", "como", "que", "te", "me", "un", "una", "el", "la", "de", "por", "con", "si", "no",
  "ya", "muy", "mas", "llamas", "nombre", "quien", "eres", "buenas", "gracias", "ayuda",
]);

function localFallback(menu, query) {
  const tokens = tokenizeQuery(query).filter((t) => !CHAT_STOPWORDS.has(t));
  if (!tokens.length) return null;

  const matches = recommendProducts(menu, tokens.join(" "), 3);
  if (!matches.length || matches[0].score < 2) return null;

  return {
    ok: true,
    message: "Del menú te va bien:",
    productIds: matches.map((m) => m.product.id),
  };
}

function normalizeChatPayload(data) {
  if (!data || typeof data !== "object") return null;
  if (data.type === "ohana-chat") {
    if (data.message) {
      return {
        ok: data.ok !== false,
        message: data.message,
        productIds: data.productIds || [],
      };
    }
    if (data.error) {
      return { ok: false, error: data.error };
    }
  }
  if (data.message) {
    return {
      ok: true,
      message: data.message,
      productIds: data.productIds || [],
    };
  }
  return null;
}

function requestChatJsonp(message) {
  return new Promise((resolve, reject) => {
    if (!OHANA_CONFIG.checkoutUrl) {
      reject(new Error("Falta checkoutUrl"));
      return;
    }

    const cb = "ohanaChat_" + Date.now();
    const url =
      OHANA_CONFIG.checkoutUrl +
      (OHANA_CONFIG.checkoutUrl.includes("?") ? "&" : "?") +
      "action=chat&message=" +
      encodeURIComponent(message) +
      "&callback=" +
      encodeURIComponent(cb);

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[cb];
      if (script.parentNode) script.remove();
    }

    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };

    const script = document.createElement("script");
    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error("jsonp error"));
    };
    document.head.appendChild(script);
  });
}

async function callGeminiClient(message, menu) {
  const apiKey = OHANA_CONFIG.geminiApiKey;
  if (!apiKey) throw new Error("Sin geminiApiKey");

  const catalog = menu.products.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    ingredients: p.ingredients || [],
    tags: p.tags || [],
  }));

  const prompt =
    'Asistente Ohana Heladería (Colombia). JSON only: {"message":"...","productIds":["id"]}. Max 3 ids del menú.\n' +
    JSON.stringify(catalog) +
    "\n\n" +
    message;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
      encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 400 },
      }),
    }
  );

  if (!res.ok) throw new Error("Gemini " + res.status);

  const payload = await res.json();
  const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(raw);
  const validIds = (parsed.productIds || []).filter((id) => catalog.some((p) => p.id === id));

  return {
    ok: true,
    message: parsed.message || "Te recomiendo:",
    productIds: validIds.slice(0, 3),
  };
}

async function requestChat(message, menu) {
  if (OHANA_CONFIG.geminiApiKey) {
    try {
      return await callGeminiClient(message, menu);
    } catch (err) {
      console.warn("Gemini cliente:", err);
    }
  }

  let apiError = null;
  try {
    const raw = await requestChatJsonp(message);
    const normalized = normalizeChatPayload(raw);
    if (normalized?.ok && normalized.message) return normalized;
    if (normalized?.error) apiError = normalized.error;
  } catch (err) {
    console.warn("JSONP chat:", err);
  }

  const fb = localFallback(menu, message);
  if (fb) return fb;

  if (apiError) {
    return {
      ok: true,
      message:
        "La IA no respondió (revisa GEMINI_API_KEY en Apps Script). Mientras tanto prueba un sabor como «fresa» o «chocolate», o escríbenos por WhatsApp.",
      productIds: [],
    };
  }

  return {
    ok: true,
    message: "No encontré algo exacto. Mira el menú o escríbenos por WhatsApp.",
    productIds: [],
  };
}

async function sendChatMessage(menu, text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  hideIngredientChips();
  clearSuggestions();
  appendChatBubble("user", trimmed);
  setChatLoading(true);

  try {
    const result = await requestChat(trimmed, menu);
    appendChatBubble("bot", result.message);
    if (result.productIds?.length) {
      renderChatProducts(menu, result.productIds, 3);
    }
  } finally {
    setChatLoading(false);
  }
}

function openChatWidget() {
  const widget = document.getElementById("chat-widget");
  const toggle = document.getElementById("chat-toggle");
  if (!widget) return;
  widget.hidden = false;
  widget.setAttribute("aria-hidden", "false");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  document.getElementById("chat-input")?.focus();
}

function closeChatWidget() {
  const widget = document.getElementById("chat-widget");
  const toggle = document.getElementById("chat-toggle");
  if (!widget) return;
  widget.hidden = true;
  widget.setAttribute("aria-hidden", "true");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function initChat(menu) {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const chipsEl = document.getElementById("chat-chips");

  if (!input || !sendBtn) return;

  appendChatBubble("bot", "¡Hola! Cuéntame qué te provoque y te recomiendo del menú.");

  if (chipsEl) {
    chipsEl.innerHTML = ingredientChips(menu)
      .slice(0, 6)
      .map((name) => `<button type="button" class="chip" data-chip="${name}">${name}</button>`)
      .join("");
  }

  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendChatMessage(menu, text);
  };

  sendBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  document.body.addEventListener("click", (e) => {
    const chip = e.target.closest("#chat-chips [data-chip]");
    if (!chip) return;
    openChatWidget();
    input.value = chip.dataset.chip;
    submit();
  });

  document.getElementById("chat-toggle")?.addEventListener("click", () => {
    const widget = document.getElementById("chat-widget");
    if (widget?.hidden) openChatWidget();
    else closeChatWidget();
  });

  document.querySelectorAll("[data-close-chat]").forEach((btn) => {
    btn.addEventListener("click", closeChatWidget);
  });
}
