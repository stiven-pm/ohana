function normalizeText(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function tokenizeQuery(query) {
  return normalizeText(query)
    .split(/[,;/]+|\s+y\s+|\s+con\s+|\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function scoreProduct(product, tokens) {
  if (!tokens.length) return 0;

  const haystack = [
    product.name,
    product.description || "",
    ...(product.ingredients || []),
    ...(product.tags || []),
  ]
    .map(normalizeText)
    .join(" ");

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 3 : 2;
    } else if (haystack.split(/\s+/).some((word) => word.startsWith(token))) {
      score += 1;
    }
  }

  return score;
}

function recommendProducts(menu, query, limit = 6) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];

  return menu.products
    .map((product) => ({ product, score: scoreProduct(product, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function ingredientChips(menu) {
  const counts = new Map();
  for (const product of menu.products) {
    for (const ing of product.ingredients || []) {
      const key = normalizeText(ing);
      if (key.length < 3) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([name]) => name);
}
