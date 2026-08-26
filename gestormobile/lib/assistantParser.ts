export type AssistantIntent =
  | {
      kind: "navigate";
      destination:
        | "catalogo"
        | "reservas"
        | "vendas"
        | "clientes"
        | "dashboard";
    }
  | { kind: "low_stock"; threshold: number }
  | { kind: "today_sales" }
  | { kind: "top_customers" }
  | { kind: "find_product"; query: string }
  | {
      kind: "adjust_stock";
      operation: "add" | "remove";
      quantity: number;
      product: string;
      size: string;
    }
  | {
      kind: "create_reservation";
      customer: string;
      product: string;
      size: string;
      quantity: number;
      days: number;
    }
  | { kind: "unsupported"; original: string };

const DESTINATIONS: Array<
  [RegExp, "catalogo" | "reservas" | "vendas" | "clientes" | "dashboard"]
> = [
  [/\b(?:catalogo|produtos?|artigos?)\b/, "catalogo"],
  [/\breservas?\b/, "reservas"],
  [/\bvendas?\b/, "vendas"],
  [/\bclientes?\b/, "clientes"],
  [/\b(?:dashboard|painel|resumo)\b/, "dashboard"],
];

export function normalizeAssistantText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseAssistantCommand(original: string): AssistantIntent {
  const text = normalizeAssistantText(original);
  const lower = text.toLowerCase();
  const reservation = text.match(
    /(?:cria|faz|regista)\s+(?:uma\s+)?reserva\s+(?:para\s+)?(.+?),\s*(.+?)\s+(?:tamanho|tam\.?|size)\s+([^,\s]+),\s*(\d+)\s*(?:unidades?|un\.?|pecas?|artigos?)?(?:,|\s)+(?:por\s+)?(\d+)\s*dias?/i,
  );
  if (reservation)
    return {
      kind: "create_reservation",
      customer: reservation[1].trim(),
      product: reservation[2].trim(),
      size: reservation[3].toUpperCase(),
      quantity: positiveInteger(reservation[4], 1),
      days: positiveInteger(reservation[5], 1),
    };

  const stock = text.match(
    /(?:adiciona|acrescenta|soma|retira|remove|subtrai)\s+(\d+)\s*(?:unidades?|un\.?|pecas?|artigos?)?\s+(?:ao|a|do|de)\s+(.+?)\s+(?:tamanho|tam\.?|size)\s+([^,\s]+)$/i,
  );
  if (stock)
    return {
      kind: "adjust_stock",
      operation: /^(?:retira|remove|subtrai)/i.test(text) ? "remove" : "add",
      quantity: positiveInteger(stock[1], 1),
      product: stock[2].trim(),
      size: stock[3].toUpperCase(),
    };

  if (/\b(?:abre|abrir|vai para|mostra a seccao|navega para)\b/i.test(lower)) {
    const match = DESTINATIONS.find(([pattern]) => pattern.test(lower));
    if (match) return { kind: "navigate", destination: match[1] };
  }
  if (/\b(?:stock baixo|pouco stock|baixo stock)\b/i.test(lower))
    return { kind: "low_stock", threshold: 5 };
  const lowStock = lower.match(
    /(?:menos de|abaixo de|ate)\s+(\d+)\s*(?:unidades?|un\.)?/i,
  );
  if (lowStock && /\b(?:stock|produtos?|artigos?)\b/i.test(lower))
    return { kind: "low_stock", threshold: positiveInteger(lowStock[1], 5) };
  if (
    /\b(?:vendas?|faturacao|faturado)\b.*\bhoje\b|\bhoje\b.*\b(?:vendas?|faturacao|faturado)\b/i.test(
      lower,
    )
  )
    return { kind: "today_sales" };
  if (/\b(?:melhores|top|principais)\b.*\bclientes?\b/i.test(lower))
    return { kind: "top_customers" };
  const productSearch = text.match(
    /(?:procura|pesquisa|encontra|mostra)\s+(?:o\s+)?(?:produto|artigo)?\s*(.+)$/i,
  );
  if (productSearch?.[1])
    return { kind: "find_product", query: productSearch[1].trim() };
  return { kind: "unsupported", original };
}
