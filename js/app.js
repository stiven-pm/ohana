let menuCache = null;

async function loadMenu() {
  if (menuCache) return menuCache;
  const res = await fetch(OHANA_CONFIG.menuUrl);
  if (!res.ok) throw new Error("No se pudo cargar el menú");
  menuCache = await res.json();
  return menuCache;
}

function categoryName(menu, categoryId) {
  const cat = menu.categories.find((c) => c.id === categoryId);
  return cat ? cat.name : categoryId;
}

function renderMenu(menu) {
  const root = document.getElementById("menu-root");
  if (!root) return;

  const byCategory = new Map();
  for (const product of menu.products) {
    if (!byCategory.has(product.category)) {
      byCategory.set(product.category, []);
    }
    byCategory.get(product.category).push(product);
  }

  root.innerHTML = menu.categories
    .filter((cat) => byCategory.has(cat.id))
    .map((cat) => {
      const items = byCategory.get(cat.id);
      const list = items
        .map((product) => {
          const ing = (product.ingredients || []).slice(0, 4).join(", ");
          return `
            <li class="menu-item" data-product-id="${product.id}">
              <div class="menu-item-info">
                <span class="menu-item-name">${product.name}</span>
                ${ing ? `<span class="menu-item-ing">${ing}</span>` : ""}
              </div>
              <div class="menu-item-actions">
                <span class="menu-item-price">${formatCop(product.price)}</span>
                <button type="button" class="btn-add" data-add="${product.id}" aria-label="Agregar ${product.name}">
                  +
                </button>
              </div>
            </li>`;
        })
        .join("");

      const note =
        cat.id === "preparaciones-frutas"
          ? `<p class="menu-note">Jugos: mango, mora, fresa, piña, banano, maracuyá, lulo y manzana.</p>`
          : "";

      return `
        <div class="menu-column">
          <h3>${cat.name}</h3>
          ${note}
          <ul class="menu-list">${list}</ul>
        </div>`;
    })
    .join("");
}

function renderCart(menu) {
  const linesEl = document.getElementById("cart-lines");
  const totalEl = document.getElementById("cart-total");
  const countEl = document.getElementById("cart-count");
  const payBtn = document.getElementById("btn-pay");
  const emptyEl = document.getElementById("cart-empty");
  if (!linesEl) return;

  const lines = getCartLines(menu);
  const total = cartTotal(menu);
  const count = cartCount(menu);

  if (countEl) countEl.textContent = String(count);
  if (totalEl) totalEl.textContent = formatCop(total);

  if (!lines.length) {
    linesEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    if (payBtn) payBtn.disabled = true;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (payBtn) payBtn.disabled = !OHANA_CONFIG.checkoutUrl;

  linesEl.innerHTML = lines
    .map(
      ({ product, qty, subtotal }) => `
      <li class="cart-line">
        <div class="cart-line-info">
          <strong>${product.name}</strong>
          <span>${formatCop(product.price)} c/u</span>
        </div>
        <div class="cart-line-controls">
          <button type="button" class="qty-btn" data-qty="${product.id}" data-delta="-1" aria-label="Quitar uno">−</button>
          <span class="qty-val">${qty}</span>
          <button type="button" class="qty-btn" data-qty="${product.id}" data-delta="1" aria-label="Agregar uno">+</button>
          <span class="cart-line-sub">${formatCop(subtotal)}</span>
        </div>
      </li>`
    )
    .join("");
}

function renderAssistantResults(menu, query) {
  const resultsEl = document.getElementById("assistant-results");
  if (!resultsEl) return;

  const matches = recommendProducts(menu, query);
  if (!query.trim()) {
    resultsEl.innerHTML =
      '<p class="assistant-hint">Escribe ingredientes o lo que te provoque: “algo ácido con lulo”, “fresa y crema”, “chocolate”…</p>';
    return;
  }

  if (!matches.length) {
    resultsEl.innerHTML =
      '<p class="assistant-hint">No encontramos algo exacto. Prueba con otra fruta o pide por WhatsApp.</p>';
    return;
  }

  resultsEl.innerHTML = matches
    .map(({ product }) => {
      const ing = (product.ingredients || []).join(", ");
      return `
        <article class="assistant-card">
          <div>
            <h4>${product.name}</h4>
            <p>${product.description || ""}</p>
            <p class="assistant-ing"><strong>Ingredientes:</strong> ${ing}</p>
          </div>
          <div class="assistant-card-actions">
            <span>${formatCop(product.price)}</span>
            <button type="button" class="btn-add" data-add="${product.id}">Agregar</button>
          </div>
        </article>`;
    })
    .join("");
}

function renderIngredientChips(menu) {
  const chipsEl = document.getElementById("ingredient-chips");
  if (!chipsEl) return;

  chipsEl.innerHTML = ingredientChips(menu)
    .map(
      (name) =>
        `<button type="button" class="chip" data-chip="${name}">${name}</button>`
    )
    .join("");
}

function getDeliveryMode() {
  const selected = document.querySelector('input[name="delivery-mode"]:checked');
  return selected ? selected.value : "now";
}

function submitCheckout(menu) {
  if (!OHANA_CONFIG.checkoutUrl) {
    alert(
      "Falta configurar la URL de pago (js/config.js y Google Apps Script). Mientras tanto puedes pedir por WhatsApp."
    );
    return;
  }

  const lines = getCartLines(menu);
  if (!lines.length) return;

  const form = document.getElementById("checkout-form");
  document.getElementById("checkout-items").value = JSON.stringify(
    lines.map(({ product, qty }) => ({ id: product.id, qty }))
  );
  document.getElementById("checkout-mode").value = getDeliveryMode();
  form.action = OHANA_CONFIG.checkoutUrl;
  form.submit();
}

function bindEvents(menu) {
  document.body.addEventListener("click", (event) => {
    const addBtn = event.target.closest("[data-add]");
    if (addBtn) {
      addToCart(addBtn.dataset.add, 1);
      renderCart(menu);
      return;
    }

    const qtyBtn = event.target.closest("[data-qty]");
    if (qtyBtn) {
      const id = qtyBtn.dataset.qty;
      const delta = Number(qtyBtn.dataset.delta);
      addToCart(id, delta);
      renderCart(menu);
      return;
    }

    const chip = event.target.closest("[data-chip]");
    if (chip) {
      const input = document.getElementById("assistant-input");
      if (input) {
        const current = input.value.trim();
        input.value = current ? `${current}, ${chip.dataset.chip}` : chip.dataset.chip;
        renderAssistantResults(menu, input.value);
      }
    }
  });

  const searchBtn = document.getElementById("assistant-search");
  const input = document.getElementById("assistant-input");
  if (searchBtn && input) {
    const runSearch = () => renderAssistantResults(menu, input.value);
    searchBtn.addEventListener("click", runSearch);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
    });
  }

  const payBtn = document.getElementById("btn-pay");
  if (payBtn) {
    payBtn.addEventListener("click", () => submitCheckout(menu));
  }

  const waBtn = document.getElementById("btn-whatsapp-cart");
  if (waBtn) {
    waBtn.addEventListener("click", () => {
      const url = buildWhatsAppUrl(menu, getDeliveryMode());
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  const clearBtn = document.getElementById("btn-clear-cart");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearCart();
      renderCart(menu);
    });
  }
}

async function initApp() {
  try {
    const menu = await loadMenu();
    renderMenu(menu);
    renderCart(menu);
    renderAssistantResults(menu, "");
    renderIngredientChips(menu);
    bindEvents(menu);

    const configWarning = document.getElementById("config-warning");
    if (configWarning && !OHANA_CONFIG.checkoutUrl) {
      configWarning.hidden = false;
    }
  } catch (err) {
    console.error(err);
    const root = document.getElementById("menu-root");
    if (root) {
      root.innerHTML =
        '<p class="menu-error">No se pudo cargar el menú. Recarga la página.</p>';
    }
  }
}

document.addEventListener("DOMContentLoaded", initApp);
