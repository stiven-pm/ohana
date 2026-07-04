function formatCopFromCents(cents) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const THANKS_DELIVERY_IDS = {
  name: "thanks-name",
  phone: "thanks-phone",
  email: "thanks-email",
  address: "thanks-address",
  notes: "thanks-notes",
};

let pageState = {
  transactionId: "",
  mode: "now",
  payment: null,
  deliveryConfirmed: false,
};

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function show(el) {
  if (el) el.hidden = false;
}

function hide(el) {
  if (el) el.hidden = true;
}

function normalizeVerifyResult(payload) {
  const tx = payload.data || payload;
  return {
    ok: true,
    id: tx.id,
    status: tx.status,
    reference: tx.reference,
    amountInCents: tx.amount_in_cents,
    currency: tx.currency,
    approved: tx.status === "APPROVED",
  };
}

async function verifyPayment(transactionId) {
  const publicKey = OHANA_CONFIG.wompiPublicKey;
  const apiBase = OHANA_CONFIG.wompiApiBase || "https://production.wompi.co/v1";

  if (!publicKey) {
    throw new Error("Falta wompiPublicKey en js/config.js");
  }

  const url =
    apiBase +
    "/transactions/" +
    encodeURIComponent(transactionId) +
    "?fields=id,status,reference,amount_in_cents,currency";

  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + publicKey },
  });

  if (!res.ok) {
    throw new Error("Wompi respondió " + res.status);
  }

  const payload = await res.json();
  return normalizeVerifyResult(payload);
}

async function pollPayment(transactionId, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const result = await verifyPayment(transactionId);
    if (result.approved) return result;
    if (result.status && !["PENDING", "APPROVED"].includes(result.status)) {
      return result;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return verifyPayment(transactionId);
}

function buildWhatsAppConfirm(payment, delivery, mode) {
  const lines = [
    "Hola Ohana, mi pago fue aprobado.",
    `Ref: ${payment.reference}`,
    `Monto: ${formatCopFromCents(payment.amountInCents || 0)}`,
    `ID Wompi: ${payment.id}`,
    ...deliverySummaryLines(delivery, mode),
  ];
  return `https://wa.me/${OHANA_CONFIG.whatsappNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
}

function buildWhatsAppHelp(transactionId) {
  const lines = [
    "Hola Ohana, necesito ayuda con mi pago.",
    transactionId ? `ID Wompi: ${transactionId}` : "",
    "Wompi me cobró pero la página no confirmó. ¿Me ayudan?",
  ].filter(Boolean);
  return `https://wa.me/${OHANA_CONFIG.whatsappNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
}

function updateWhatsAppLink(payment, delivery, mode) {
  const waLink = document.getElementById("whatsapp-link");
  if (!waLink) return;

  if (payment?.reference && payment.reference !== payment.id) {
    waLink.href = buildWhatsAppConfirm(payment, delivery, mode);
    waLink.textContent = "Confirmar por WhatsApp";
  } else if (pageState.transactionId) {
    waLink.href = buildWhatsAppHelp(pageState.transactionId);
    waLink.textContent = "Ayuda por WhatsApp";
  } else {
    return;
  }
  show(waLink);
}

function showDeliveryStep(payment, mode) {
  const deliverySection = document.getElementById("thanks-delivery");
  const nextSection = document.getElementById("thanks-next");
  if (!deliverySection) return;

  fillDeliveryFields(loadDelivery(), THANKS_DELIVERY_IDS);
  show(deliverySection);
  hide(nextSection);

  setText("delivery-intro", "Confirma dónde entregamos tu pedido. Lo usamos para coordinar contigo y en el calendario.");
  updateWhatsAppLink(payment, loadDelivery() || {}, mode);
}

function showAfterDeliveryStep(payment, delivery, mode) {
  const deliverySection = document.getElementById("thanks-delivery");
  const nextSection = document.getElementById("thanks-next");
  const calendarWrap = document.getElementById("calendar-wrap");
  const calendarFrame = document.getElementById("calendar-embed");

  hide(deliverySection);
  show(nextSection);
  updateWhatsAppLink(payment, delivery, mode);

  if (mode === "scheduled" && OHANA_CONFIG.calendarEmbedUrl) {
    setText("next-title", "Elige la hora de entrega");
    setText(
      "next-message",
      "Reserva en el calendario. Ya tenemos tu dirección; si cambia algo, avísanos por WhatsApp."
    );
    calendarFrame.src = OHANA_CONFIG.calendarEmbedUrl;
    show(calendarWrap);
  } else if (mode === "scheduled") {
    setText("next-title", "Coordinamos tu entrega");
    setText(
      "next-message",
      "Pago y dirección recibidos. Escríbenos por WhatsApp para fijar la hora si aún no tienes calendario."
    );
  } else {
    setText("next-title", "Pedido en camino");
    setText(
      "next-message",
      "Preparamos tu pedido para entrega lo antes posible, según disponibilidad. Te contactamos al teléfono que dejaste."
    );
  }
}

function showPaymentError(transactionId, err) {
  const recovery = document.getElementById("thanks-recovery");
  const waLink = document.getElementById("whatsapp-link");

  setText("thanks-title", "No pudimos confirmar en línea");
  setText(
    "thanks-message",
    "Si Wompi ya te cobró, el pago está seguro. Guarda este ID y contáctanos; no vuelvas a pagar el mismo pedido."
  );

  if (recovery) {
    show(recovery);
    setText("recovery-id", transactionId || "—");
    if (err?.message) setText("recovery-detail", err.message);
  }

  if (waLink) {
    waLink.href = buildWhatsAppHelp(transactionId);
    waLink.textContent = "Ayuda por WhatsApp";
    show(waLink);
  }

  show(document.getElementById("thanks-next"));
  setText("next-title", "¿Qué hacer?");
  setText(
    "next-message",
    "Recarga esta página en un minuto. Si el pago aparece aprobado en Wompi, completa tus datos de entrega abajo o escríbenos."
  );

  showDeliveryStep(null, pageState.mode);
}

async function runVerification() {
  const { transactionId, mode } = pageState;
  const retryBtn = document.getElementById("btn-retry-verify");

  setText("thanks-title", "Verificando tu pago…");
  setText("thanks-message", "Espera un momento mientras confirmamos con Wompi.");
  hide(document.getElementById("thanks-recovery"));
  hide(document.getElementById("thanks-next"));
  hide(document.getElementById("thanks-delivery"));

  if (!transactionId) {
    setText("thanks-title", "Pago no encontrado");
    setText(
      "thanks-message",
      "No recibimos el comprobante de Wompi. Si ya pagaste, escríbenos por WhatsApp con tu referencia."
    );
    const waLink = document.getElementById("whatsapp-link");
    if (waLink) {
      waLink.href = buildWhatsAppHelp("");
      show(waLink);
    }
    return;
  }

  if (retryBtn) retryBtn.disabled = true;

  try {
    const result = await pollPayment(transactionId);
    pageState.payment = result;

    if (!result.approved) {
      setText("thanks-title", "Pago no completado");
      setText(
        "thanks-message",
        result.status === "PENDING"
          ? "El pago sigue en proceso. Si usaste PSE o Nequi, puede tardar unos minutos."
          : "El pago no fue aprobado. Puedes intentar de nuevo desde el menú."
      );
      show(document.getElementById("thanks-next"));
      setText("next-title", "¿Qué puedes hacer?");
      setText(
        "next-message",
        "Vuelve al menú e intenta otra vez, o contáctanos por WhatsApp si crees que hubo un error."
      );
      const waLink = document.getElementById("whatsapp-link");
      if (waLink) {
        waLink.href = buildWhatsAppHelp(transactionId);
        show(waLink);
      }
      return;
    }

    clearCartMaybe();
    setText("thanks-title", "¡Pago confirmado!");
    setText(
      "thanks-message",
      `Recibimos ${formatCopFromCents(result.amountInCents)}. Referencia: ${result.reference}.`
    );

    showDeliveryStep(result, mode);
  } catch (err) {
    console.error(err);
    showPaymentError(transactionId, err);
  } finally {
    if (retryBtn) retryBtn.disabled = false;
  }
}

function bindDeliveryForm() {
  const form = document.getElementById("thanks-delivery-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const delivery = readDeliveryFields(THANKS_DELIVERY_IDS);
    const error = validateDelivery(delivery);
    const errEl = document.getElementById("delivery-form-error");
    if (error) {
      if (errEl) {
        errEl.textContent = error;
        show(errEl);
      }
      return;
    }
    if (errEl) hide(errEl);

    saveDelivery(delivery);
    pageState.deliveryConfirmed = true;

    const payment = pageState.payment || {
      id: pageState.transactionId,
      reference: pageState.transactionId,
      amountInCents: 0,
    };

    showAfterDeliveryStep(payment, delivery, pageState.mode);
  });
}

function bindRetry() {
  document.getElementById("btn-retry-verify")?.addEventListener("click", runVerification);
}

function initThanksPage() {
  const params = new URLSearchParams(window.location.search);
  pageState.transactionId = params.get("id") || "";
  pageState.mode = params.get("mode") === "scheduled" ? "scheduled" : "now";

  fillDeliveryFields(loadDelivery(), THANKS_DELIVERY_IDS);
  bindDeliveryForm();
  bindRetry();
  runVerification();
}

function clearCartMaybe() {
  try {
    sessionStorage.removeItem("ohana-cart");
  } catch {
    /* ignore */
  }
}

document.addEventListener("DOMContentLoaded", initThanksPage);
