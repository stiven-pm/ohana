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

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--" + role;
  bubble.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
}

function renderChatProducts(menu, productIds) {
  const wrap = document.getElementById("chat-suggestions");
  if (!wrap || !productIds.length) {
    if (wrap) wrap.innerHTML = "";
    return;
  }

  const byId = Object.fromEntries(menu.products.map((p) => [p.id, p]));
  wrap.innerHTML = productIds
    .map((id) => byId[id])
    .filter(Boolean)
    .map(
      (product) => `
      <article class="chat-product">
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <span>${formatCop(product.price)}</span>
        </div>
        <button type="button" class="btn-add btn-add--sm" data-add="${product.id}">+</button>
      </article>`
    )
    .join("");
}

function setChatLoading(loading) {
  const btn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");
  if (btn) {
    btn.disabled = loading;
    btn.textContent = loading ? "Pensando…" : "Enviar";
  }
  if (input) input.disabled = loading;
}

function postToApiFrame(fields) {
  return new Promise((resolve, reject) => {
    if (!OHANA_CONFIG.checkoutUrl) {
      reject(new Error("Falta checkoutUrl en config.js"));
      return;
    }

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tiempo de espera agotado"));
    }, 45000);

    function onMessage(event) {
      if (!event.data || event.data.type !== "ohana-chat") return;
      cleanup();
      resolve(event.data);
    }

    function cleanup() {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    }

    window.addEventListener("message", onMessage);

    const form = document.getElementById("api-form");
    const actionInput = document.getElementById("api-action");
    const messageInput = document.getElementById("api-message");
    const itemsInput = document.getElementById("api-items");
    const modeInput = document.getElementById("api-mode");

    form.action = OHANA_CONFIG.checkoutUrl;
    actionInput.value = fields.action || "";
    messageInput.value = fields.message || "";
    itemsInput.value = fields.items || "";
    modeInput.value = fields.mode || "";
    form.submit();
  });
}

async function sendChatMessage(menu, text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  appendChatBubble("user", trimmed);
  setChatLoading(true);

  try {
    const result = await postToApiFrame({ action: "chat", message: trimmed });

    if (!result.ok) {
      const fallback = recommendProducts(menu, trimmed);
      if (fallback.length) {
        appendChatBubble(
          "bot",
          "La IA no está disponible ahora. Por ingredientes te sugiero:"
        );
        renderChatProducts(
          menu,
          fallback.map((m) => m.product.id)
        );
      } else {
        appendChatBubble(
          "bot",
          result.error || "No pude responder. Intenta de nuevo o elige del menú."
        );
      }
      return;
    }

    appendChatBubble("bot", result.message);
    renderChatProducts(menu, result.productIds || []);
  } catch (err) {
    console.error(err);
    const fallback = recommendProducts(menu, trimmed);
    if (fallback.length) {
      appendChatBubble("bot", "Sin conexión a la IA. Según el menú te va:");
      renderChatProducts(
        menu,
        fallback.map((m) => m.product.id)
      );
    } else {
      appendChatBubble(
        "bot",
        "No pude conectar con el asistente. Prueba otra vez en un momento."
      );
    }
  } finally {
    setChatLoading(false);
  }
}

function initChat(menu) {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const chipsEl = document.getElementById("chat-chips");

  if (!input || !sendBtn) return;

  appendChatBubble(
    "bot",
    "¡Hola! Soy el asistente de Ohana. Cuéntame qué te provoque: algo ácido, con fresa, para el calor… y te recomiendo del menú."
  );

  if (chipsEl) {
    chipsEl.innerHTML = ingredientChips(menu)
      .slice(0, 8)
      .map(
        (name) =>
          `<button type="button" class="chip" data-chip="${name}">${name}</button>`
      )
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
    input.value = chip.dataset.chip;
    submit();
  });
}
