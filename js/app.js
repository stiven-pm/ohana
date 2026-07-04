let menuCache = null;

async function loadMenu() {
  if (menuCache) return menuCache;
  const res = await fetch(OHANA_CONFIG.menuUrl);
  if (!res.ok) throw new Error("No se pudo cargar el menú");
  menuCache = await res.json();
  return menuCache;
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
          const ing = (product.ingredients || []).slice(0, 3).join(", ");
          return `
            <li class="menu-item" data-product-id="${product.id}">
              <div class="menu-item-info">
                <span class="menu-item-name">${product.name}</span>
                ${ing ? `<span class="menu-item-ing">${ing}</span>` : ""}
              </div>
              <div class="menu-item-actions">
                <span class="menu-item-price">${formatCop(product.price)}</span>
                <button type="button" class="btn-add" data-add="${product.id}" aria-label="Agregar ${product.name}">+</button>
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

function updateCartChrome(menu) {
  const lines = getCartLines(menu);
  const total = cartTotal(menu);
  const count = cartCount(menu);

  const ids = [
    "cart-count",
    "cart-count-bar",
    "cart-total",
    "cart-total-bar",
  ];
  document.getElementById("cart-count") &&
    (document.getElementById("cart-count").textContent = String(count));
  document.getElementById("cart-count-bar") &&
    (document.getElementById("cart-count-bar").textContent = String(count));
  document.getElementById("cart-total") &&
    (document.getElementById("cart-total").textContent = formatCop(total));
  document.getElementById("cart-total-bar") &&
    (document.getElementById("cart-total-bar").textContent = formatCop(total));

  const bar = document.getElementById("cart-bar");
  if (bar) {
    bar.hidden = count === 0;
    document.body.classList.toggle("has-cart-bar", count > 0);
  }

  const payBtn = document.getElementById("btn-pay");
  const emptyEl = document.getElementById("cart-empty");
  const linesEl = document.getElementById("cart-lines");

  if (!linesEl) return;

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

function renderCart(menu) {
  updateCartChrome(menu);
}

function openCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  if (!drawer) return;
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("cart-open");
}

function closeCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  if (!drawer) return;
  drawer.hidden = true;
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("cart-open");
}

function getDeliveryMode() {
  const selected = document.querySelector('input[name="delivery-mode"]:checked');
  return selected ? selected.value : "now";
}

function submitCheckout(menu) {
  if (!OHANA_CONFIG.checkoutUrl) {
    alert("Falta configurar la URL de pago en js/config.js");
    return;
  }

  const lines = getCartLines(menu);
  if (!lines.length) return;

  const form = document.getElementById("api-form");
  document.getElementById("api-action").value = "";
  document.getElementById("api-message").value = "";
  document.getElementById("api-items").value = JSON.stringify(
    lines.map(({ product, qty }) => ({ id: product.id, qty }))
  );
  document.getElementById("api-mode").value = getDeliveryMode();
  form.action = OHANA_CONFIG.checkoutUrl;
  form.target = "_self";
  form.submit();
}

function bindEvents(menu) {
  document.body.addEventListener("click", (event) => {
    const addBtn = event.target.closest("[data-add]");
    if (addBtn) {
      addToCart(addBtn.dataset.add, 1);
      renderCart(menu);
      openCartDrawer();
      return;
    }

    const qtyBtn = event.target.closest("[data-qty]");
    if (qtyBtn) {
      addToCart(qtyBtn.dataset.qty, Number(qtyBtn.dataset.delta));
      renderCart(menu);
      return;
    }

    const openCart = event.target.closest("[data-open-cart]");
    if (openCart) {
      event.preventDefault();
      openCartDrawer();
      return;
    }

    const closeCart = event.target.closest("[data-close-cart]");
    if (closeCart) {
      closeCartDrawer();
    }
  });

  document.getElementById("cart-backdrop")?.addEventListener("click", closeCartDrawer);

  document.getElementById("btn-pay")?.addEventListener("click", () => {
    submitCheckout(menu);
  });

  document.getElementById("btn-whatsapp-cart")?.addEventListener("click", () => {
    const url = buildWhatsAppUrl(menu, getDeliveryMode());
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });

  document.getElementById("btn-clear-cart")?.addEventListener("click", () => {
    clearCart();
    renderCart(menu);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCartDrawer();
      closeChatWidget();
    }
  });
}

async function initApp() {
  try {
    const menu = await loadMenu();
    renderMenu(menu);
    renderCart(menu);
    initChat(menu);
    bindEvents(menu);
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
