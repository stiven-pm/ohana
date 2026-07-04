const CART_KEY = "ohana-cart";

function formatCop(amount) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function loadCart() {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function getCartLines(menu) {
  const cart = loadCart();
  const byId = Object.fromEntries(menu.products.map((p) => [p.id, p]));

  return Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => {
      const product = byId[id];
      if (!product) return null;
      return { product, qty, subtotal: product.price * qty };
    })
    .filter(Boolean);
}

function cartTotal(menu) {
  return getCartLines(menu).reduce((sum, line) => sum + line.subtotal, 0);
}

function cartCount(menu) {
  return getCartLines(menu).reduce((sum, line) => sum + line.qty, 0);
}

function setQty(productId, qty) {
  const cart = loadCart();
  if (qty <= 0) {
    delete cart[productId];
  } else {
    cart[productId] = Math.min(qty, 99);
  }
  saveCart(cart);
}

function addToCart(productId, delta = 1) {
  const cart = loadCart();
  const next = (cart[productId] || 0) + delta;
  setQty(productId, next);
}

function clearCart() {
  sessionStorage.removeItem(CART_KEY);
}

function cartSummaryText(menu) {
  const lines = getCartLines(menu);
  if (!lines.length) return "";
  const items = lines
    .map(({ product, qty }) => `${qty}× ${product.name}`)
    .join(", ");
  return `${items} — Total ${formatCop(cartTotal(menu))}`;
}

function buildWhatsAppUrl(menu, mode, delivery) {
  const text = cartSummaryText(menu);
  if (!text) return null;
  const lines = deliverySummaryLines(delivery || loadDelivery() || {}, mode);
  const prefix =
    mode === "scheduled"
      ? "Hola Ohana, quiero programar mi pedido:\n"
      : "Hola Ohana, quiero pedir para entrega:\n";
  const body = prefix + lines.join("\n") + "\n\nPedido: " + text;
  return `https://wa.me/${OHANA_CONFIG.whatsappNumber}?text=${encodeURIComponent(body)}`;
}
