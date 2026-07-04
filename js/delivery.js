const DELIVERY_KEY = "ohana-delivery";

function loadDelivery() {
  try {
    const raw = sessionStorage.getItem(DELIVERY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDelivery(data) {
  sessionStorage.setItem(DELIVERY_KEY, JSON.stringify(data));
}

function clearDelivery() {
  sessionStorage.removeItem(DELIVERY_KEY);
}

function validateDelivery(data) {
  if (!data?.name?.trim()) return "Escribe tu nombre completo.";
  if (!data?.phone?.trim() || data.phone.replace(/\D/g, "").length < 7) {
    return "Escribe un teléfono o WhatsApp válido.";
  }
  if (!data?.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    return "Escribe un correo válido.";
  }
  if (!data?.address?.trim() || data.address.trim().length < 10) {
    return "Escribe la dirección de entrega (barrio, calle, referencia).";
  }
  return null;
}

function readDeliveryFields(ids) {
  return {
    name: document.getElementById(ids.name)?.value.trim() || "",
    phone: document.getElementById(ids.phone)?.value.trim() || "",
    email: document.getElementById(ids.email)?.value.trim() || "",
    address: document.getElementById(ids.address)?.value.trim() || "",
    notes: document.getElementById(ids.notes)?.value.trim() || "",
  };
}

function fillDeliveryFields(data, ids) {
  if (!data) return;
  const map = [
    [ids.name, data.name],
    [ids.phone, data.phone],
    [ids.email, data.email],
    [ids.address, data.address],
    [ids.notes, data.notes],
  ];
  for (const [id, value] of map) {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
  }
}

function deliverySummaryLines(data, mode) {
  const when =
    mode === "scheduled" ? "Entrega programada" : "Para ya (según disponibilidad)";
  const lines = [
    when,
    `Nombre: ${data.name}`,
    `Tel: ${data.phone}`,
    `Correo: ${data.email}`,
    `Dirección: ${data.address}`,
  ];
  if (data.notes) lines.push(`Notas: ${data.notes}`);
  return lines;
}
