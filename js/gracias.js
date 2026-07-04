function formatCopFromCents(cents) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function show(el) {
  if (el) el.hidden = false;
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
  const apiBase =
    OHANA_CONFIG.wompiApiBase || "https://production.wompi.co/v1";

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

function buildWhatsAppConfirm(reference, amountInCents) {
  const text = encodeURIComponent(
    `Hola Ohana, mi pago fue aprobado (ref: ${reference}, ${formatCopFromCents(amountInCents)}). Confirmo mi pedido.`
  );
  return `https://wa.me/${OHANA_CONFIG.whatsappNumber}?text=${text}`;
}

async function initThanksPage() {
  const params = new URLSearchParams(window.location.search);
  const transactionId = params.get("id");
  const mode = params.get("mode") === "scheduled" ? "scheduled" : "now";

  const nextSection = document.getElementById("thanks-next");
  const calendarWrap = document.getElementById("calendar-wrap");
  const calendarFrame = document.getElementById("calendar-embed");
  const waLink = document.getElementById("whatsapp-link");

  if (!transactionId) {
    setText("thanks-title", "Pago no encontrado");
    setText(
      "thanks-message",
      "No recibimos el comprobante de Wompi. Si ya pagaste, escríbenos por WhatsApp con tu referencia."
    );
    return;
  }

  try {
    const result = await pollPayment(transactionId);

    if (!result.approved) {
      setText("thanks-title", "Pago no completado");
      setText(
        "thanks-message",
        result.status === "PENDING"
          ? "El pago sigue en proceso. Si usaste PSE o Nequi, puede tardar unos minutos."
          : "El pago no fue aprobado. Puedes intentar de nuevo desde el menú."
      );
      show(nextSection);
      setText("next-title", "¿Qué puedes hacer?");
      setText(
        "next-message",
        "Vuelve al pedido e intenta otra vez, o contáctanos por WhatsApp si crees que hubo un error."
      );
      return;
    }

    clearCartMaybe();
    setText("thanks-title", "¡Pago confirmado!");
    setText(
      "thanks-message",
      `Recibimos ${formatCopFromCents(result.amountInCents)}. Referencia: ${result.reference}.`
    );

    show(nextSection);

    if (mode === "scheduled" && OHANA_CONFIG.calendarEmbedUrl) {
      setText("next-title", "Elige la hora de entrega");
      setText(
        "next-message",
        "Reserva un hueco en el calendario. Solo verás esto después de pagar."
      );
      calendarFrame.src = OHANA_CONFIG.calendarEmbedUrl;
      show(calendarWrap);
    } else if (mode === "scheduled") {
      setText("next-title", "Programa tu entrega");
      setText(
        "next-message",
        "Pago listo. Escríbenos por WhatsApp para coordinar la hora de entrega."
      );
    } else {
      setText("next-title", "Pedido para llevar ya");
      setText(
        "next-message",
        "Estamos preparando tu pedido. Si quieres, confirma por WhatsApp con la referencia."
      );
    }

    if (waLink && result.reference) {
      waLink.href = buildWhatsAppConfirm(
        result.reference,
        result.amountInCents || 0
      );
      show(waLink);
    }
  } catch (err) {
    console.error(err);
    setText("thanks-title", "No pudimos verificar el pago");
    setText(
      "thanks-message",
      "Intenta recargar esta página en un momento o escríbenos por WhatsApp con el ID: " +
        transactionId
    );
  }
}

function clearCartMaybe() {
  try {
    sessionStorage.removeItem("ohana-cart");
  } catch {
    /* ignore */
  }
}

document.addEventListener("DOMContentLoaded", initThanksPage);
