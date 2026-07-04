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

function buildChatCatalog(menu) {
  return menu.products.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    ingredients: p.ingredients || [],
    tags: p.tags || [],
    description: p.description || "",
  }));
}

function buildChatPrompt(message, catalog) {
  return (
    'Eres "Asistente Ohana", el chat de Ohana Heladería (Colombia). Saluda, conversa con naturalidad ' +
    "y recomienda del menú cuando el cliente lo pida o mencione antojos.\n" +
    'Responde SOLO JSON válido: {"message":"...","productIds":[]}. ' +
    "productIds: hasta 3 ids del menú (vacío si no recomiendas productos). Español colombiano, 1-3 frases.\n\n" +
    "Menú: " +
    JSON.stringify(catalog) +
    "\n\nCliente: " +
    message
  );
}

function parseGeminiErrorBody(body, status) {
  try {
    const err = JSON.parse(body).error;
    if (err?.message) return err.message;
  } catch (_) {
    /* ignore */
  }
  return "Gemini HTTP " + status;
}

function parseGeminiResponse(raw, catalog) {
  let text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const parsed = JSON.parse(text);
  const validIds = (parsed.productIds || []).filter((id) => catalog.some((p) => p.id === id));
  const message = String(parsed.message || "").trim();
  if (!message) throw new Error("Gemini devolvió respuesta vacía");
  return {
    ok: true,
    message,
    productIds: validIds.slice(0, 3),
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

  const catalog = buildChatCatalog(menu);
  const prompt = buildChatPrompt(message, catalog);
  const models = ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
  let lastError = "Gemini no respondió";

  for (const model of models) {
    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          model +
          ":generateContent?key=" +
          encodeURIComponent(apiKey),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.8,
              maxOutputTokens: 500,
            },
          }),
        }
      );

      const body = await res.text();
      if (!res.ok) throw new Error(parseGeminiErrorBody(body, res.status));

      const payload = JSON.parse(body);
      const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      return parseGeminiResponse(raw, catalog);
    } catch (err) {
      lastError = err.message || String(err);
      console.warn("Gemini " + model + ":", err);
    }
  }

  throw new Error(lastError);
}

async function requestChat(message, menu) {
  if (OHANA_CONFIG.geminiApiKey) {
    try {
      return await callGeminiClient(message, menu);
    } catch (err) {
      console.warn("Gemini cliente:", err);
      return {
        ok: false,
        message:
          "No pude usar la IA (" +
          (err.message || err) +
          "). Revisa geminiApiKey en config.js o GEMINI_API_KEY en Apps Script.",
        productIds: [],
      };
    }
  }

  try {
    const raw = await requestChatJsonp(message);
    const normalized = normalizeChatPayload(raw);
    if (normalized?.ok && normalized.message) return normalized;
    if (normalized?.error) {
      return {
        ok: false,
        message: "No pude usar la IA: " + normalized.error,
        productIds: [],
      };
    }
  } catch (err) {
    console.warn("JSONP chat:", err);
    return {
      ok: false,
      message: "No pude conectar con la IA. Revisa GEMINI_API_KEY en Apps Script.",
      productIds: [],
    };
  }

  return {
    ok: false,
    message: "No pude obtener respuesta de la IA.",
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
