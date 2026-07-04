/**
 * OHANA API — pega en Code.gs y vuelve a Implementar → Nueva versión
 * Propiedades: WOMPI_*, MENU_JSON_URL, REDIRECT_URL, WOMPI_API_BASE, GEMINI_API_KEY
 */

const PROP = {
  PUBLIC_KEY: "WOMPI_PUBLIC_KEY",
  INTEGRITY: "WOMPI_INTEGRITY_SECRET",
  MENU_URL: "MENU_JSON_URL",
  REDIRECT: "REDIRECT_URL",
  API_BASE: "WOMPI_API_BASE",
  GEMINI: "GEMINI_API_KEY",
};

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : "";
  const callback = e && e.parameter ? e.parameter.callback : "";

  if (action === "chat") {
    return handleChatGet_(e.parameter.message, callback);
  }

  if (action === "verify") {
    return handleVerify_(e.parameter.id, callback);
  }

  return respondJson_({ ok: true, service: "ohana-api" }, callback);
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    return handleCheckout_(body);
  } catch (err) {
    return htmlError_(String(err.message || err));
  }
}

function handleChatGet_(message, callback) {
  const text = String(message || "").trim().slice(0, 500);
  if (!text) {
    return respondJson_({ type: "ohana-chat", ok: false, error: "Mensaje vacío" }, callback);
  }

  try {
    const menu = fetchMenu_();
    const result = callGemini_(text, menu);
    return respondJson_(
      {
        type: "ohana-chat",
        ok: true,
        message: result.message,
        productIds: result.productIds,
      },
      callback
    );
  } catch (err) {
    return respondJson_(
      { type: "ohana-chat", ok: false, error: String(err.message || err) },
      callback
    );
  }
}

function parseBody_(e) {
  if (e.postData && e.postData.type === "application/json") {
    return JSON.parse(e.postData.contents);
  }
  if (e.parameter && e.parameter.items) {
    return {
      items: JSON.parse(e.parameter.items),
      mode: e.parameter.mode,
    };
  }
  throw new Error("Solicitud inválida");
}

function callGemini_(userMessage, menu) {
  const apiKey = getProp_(PROP.GEMINI);
  const catalog = (menu.products || []).map(function (p) {
    return {
      id: p.id,
      name: p.name,
      price: p.price,
      ingredients: p.ingredients || [],
      tags: p.tags || [],
      description: p.description || "",
    };
  });

  const prompt =
    "Eres el asistente de Ohana Heladería (Colombia). Recomienda solo del menú. " +
    'Responde SOLO JSON: {"message":"...","productIds":["id"]}. Máximo 3 ids. Español colombiano, breve.\n\n' +
    "Menú: " +
    JSON.stringify(catalog) +
    "\n\nCliente: " +
    userMessage;

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
    encodeURIComponent(apiKey);

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
        maxOutputTokens: 400,
      },
    }),
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error("Gemini no respondió");
  }

  const payload = JSON.parse(res.getContentText());
  const raw =
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts[0]
      ? payload.candidates[0].content.parts[0].text
      : "";

  const parsed = JSON.parse(raw);
  const ids = (parsed.productIds || []).filter(function (id) {
    return catalog.some(function (p) {
      return p.id === id;
    });
  });

  return {
    message: String(parsed.message || "Aquí van mis sugerencias."),
    productIds: ids.slice(0, 3),
  };
}

function handleCheckout_(body) {
  const items = body.items || [];
  const mode = body.mode === "scheduled" ? "scheduled" : "now";
  if (!items.length) throw new Error("El carrito está vacío");

  const menu = fetchMenu_();
  const catalog = buildCatalog_(menu);
  let totalCents = 0;
  const summary = [];

  items.forEach(function (item) {
    const product = catalog[item.id];
    if (!product) throw new Error("Producto no válido: " + item.id);
    const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
    totalCents += product.priceCents * qty;
    summary.push(qty + "x " + product.name);
  });

  if (totalCents < 500000) throw new Error("El pedido mínimo es $5.000 COP");

  const reference = "OHANA-" + Date.now() + "-" + randomSuffix_(4);
  const integrity = getProp_(PROP.INTEGRITY);
  const signature = sha256Hex_(reference + totalCents + "COP" + integrity);

  return autoSubmitWompi_(
    {
      "public-key": getProp_(PROP.PUBLIC_KEY),
      currency: "COP",
      "amount-in-cents": String(totalCents),
      reference: reference,
      "signature:integrity": signature,
      "redirect-url":
        getProp_(PROP.REDIRECT) +
        (getProp_(PROP.REDIRECT).indexOf("?") >= 0 ? "&" : "?") +
        "mode=" +
        encodeURIComponent(mode),
    },
    summary.join(", ")
  );
}

function handleVerify_(transactionId, callback) {
  if (!transactionId) {
    return respondJson_({ ok: false, error: "Falta id" }, callback);
  }
  const apiBase = getProp_(PROP.API_BASE) || "https://production.wompi.co/v1";
  const res = UrlFetchApp.fetch(
    apiBase +
      "/transactions/" +
      encodeURIComponent(transactionId) +
      "?fields=id,status,reference,amount_in_cents,currency",
    {
      method: "get",
      headers: { Authorization: "Bearer " + getProp_(PROP.PUBLIC_KEY) },
      muteHttpExceptions: true,
    }
  );
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    return respondJson_({ ok: false, error: "No se pudo verificar" }, callback);
  }
  const tx = JSON.parse(res.getContentText()).data || {};
  return respondJson_(
    {
      ok: true,
      id: tx.id,
      status: tx.status,
      reference: tx.reference,
      amountInCents: tx.amount_in_cents,
      approved: tx.status === "APPROVED",
    },
    callback
  );
}

function respondJson_(obj, callback) {
  const text = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + text + ")").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

function fetchMenu_() {
  const res = UrlFetchApp.fetch(getProp_(PROP.MENU_URL), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("No se pudo leer menu.json");
  return JSON.parse(res.getContentText());
}

function buildCatalog_(menu) {
  const catalog = {};
  (menu.products || []).forEach(function (p) {
    catalog[p.id] = { name: p.name, priceCents: Math.round(Number(p.price) * 100) };
  });
  return catalog;
}

function autoSubmitWompi_(params, orderSummary) {
  const inputs = Object.keys(params)
    .map(function (key) {
      return (
        '<input type="hidden" name="' +
        escapeHtml_(key) +
        '" value="' +
        escapeHtml_(params[key]) +
        '">'
      );
    })
    .join("");
  return HtmlService.createHtmlOutput(
    "<!DOCTYPE html><html><body><form id='w' action='https://checkout.wompi.co/p/' method='GET'>" +
      inputs +
      "</form><script>document.getElementById('w').submit()</script></body></html>"
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function htmlError_(message) {
  return HtmlService.createHtmlOutput("<p>" + escapeHtml_(message) + "</p>");
}

function getProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error("Falta propiedad: " + key);
  return v;
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
}

function randomSuffix_(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}
