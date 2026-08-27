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

type Destination = Extract<
  AssistantIntent,
  { kind: "navigate" }
>["destination"];

const DESTINATIONS: Array<[RegExp, Destination]> = [
  [/\b(?:catalogo|produtos?|artigos?|inventario)\b/, "catalogo"],
  [/\b(?:reservas?|encomendas? reservadas?)\b/, "reservas"],
  [/\b(?:vendas?|caixa|pos)\b/, "vendas"],
  [/\b(?:clientes?|contactos?)\b/, "clientes"],
  [/\b(?:dashboard|painel|resumo|inicio|home page)\b/, "dashboard"],
];

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  um: "1",
  uma: "1",
  dois: "2",
  duas: "2",
  tres: "3",
  quatro: "4",
  cinco: "5",
  seis: "6",
  sete: "7",
  oito: "8",
  nove: "9",
  dez: "10",
  onze: "11",
  doze: "12",
  treze: "13",
  catorze: "14",
  quatorze: "14",
  quinze: "15",
  dezasseis: "16",
  dezessete: "17",
  dezassete: "17",
  dezoito: "18",
  dezanove: "19",
  dezenove: "19",
  vinte: "20",
  trinta: "30",
  quarenta: "40",
  cinquenta: "50",
  sessenta: "60",
  setenta: "70",
  oitenta: "80",
  noventa: "90",
};

export function normalizeAssistantText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/\ba\s+way\b/gi, "away")
    .replace(/\b(?:auei|auai)\b/gi, "away")
    .replace(/\b(2\d)[\s.-]+(2\d)\b/g, "$1/$2")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceNumberWords(value: string) {
  let result = value.toLowerCase();
  for (const [word, number] of Object.entries(NUMBER_WORDS))
    result = result.replace(new RegExp(`\\b${word}\\b`, "g"), number);
  return result;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStock(text: string): AssistantIntent | null {
  const addVerbs =
    "adiciona|adicionar|acrescenta|acrescentar|soma|somar|poe|por|coloca|colocar|mete|meter|repoe|repor|aumenta|aumentar|entrada de|da entrada a";
  const removeVerbs =
    "retira|retirar|remove|remover|subtrai|subtrair|tira|tirar|baixa|baixar|desconta|descontar|reduz|reduzir";
  const pattern = new RegExp(
    `(?:${addVerbs}|${removeVerbs})\\s+(?:mais\\s+|do stock\\s+|ao stock\\s+|stock\\s+)?(\\d+)\\s*(?:unidades?|un\\.?|pecas?|artigos?|camisolas?)?\\s+(?:no\\s+stock\\s+(?:do|da|de)|ao\\s+stock\\s+(?:do|da|de)|ao|a|no|na|do|da|de)?\\s*(.+?)\\s+(?:no\\s+|de\\s+)?(?:tamanho|tam\\.?|size)\\s+([^,\\s.]+)`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return null;
  return {
    kind: "adjust_stock",
    operation: new RegExp(`^(?:${removeVerbs})`, "i").test(text)
      ? "remove"
      : "add",
    quantity: positiveInteger(match[1], 1),
    product: match[2].trim(),
    size: match[3].toUpperCase(),
  };
}

function parseReservation(text: string): AssistantIntent | null {
  const header = text.match(
    /(?:cria|criar|faz|fazer|regista|registar|marca|marcar|agenda|agendar)\s+(?:(?:uma|1)\s+)?reserva\s+(?:para|em nome de)\s+(.+?)[,;]\s*(.+)$/i,
  );
  if (!header) return null;
  const details = header[2].match(
    /(.+?)\s+(?:no\s+|de\s+)?(?:tamanho|tam\.?|size)\s+([^,;\s.]+)[,;]?\s*(\d+)\s*(?:unidades?|un\.?|pecas?|artigos?|camisolas?)?[,;]?\s*(?:durante|por|valida por)?\s*(\d+)\s*dias?/i,
  );
  if (!details) return null;
  return {
    kind: "create_reservation",
    customer: header[1].trim(),
    product: details[1].trim(),
    size: details[2].toUpperCase(),
    quantity: positiveInteger(details[3], 1),
    days: positiveInteger(details[4], 1),
  };
}

export function parseAssistantCommand(original: string): AssistantIntent {
  const text = replaceNumberWords(normalizeAssistantText(original));
  const lower = text.toLowerCase();
  const reservation = parseReservation(text);
  if (reservation) return reservation;
  const stock = parseStock(text);
  if (stock) return stock;
  if (
    /\b(?:stock baixo|pouco stock|baixo stock|a acabar|quase sem stock|reposicao)\b/i.test(
      lower,
    )
  )
    return { kind: "low_stock", threshold: 5 };
  const lowStock = lower.match(
    /(?:menos de|abaixo de|inferior a|ate|maximo de)\s+(\d+)\s*(?:unidades?|un\.)?/i,
  );
  if (
    lowStock &&
    /\b(?:stock|produtos?|artigos?|variantes?|camisolas?)\b/i.test(lower)
  )
    return { kind: "low_stock", threshold: positiveInteger(lowStock[1], 5) };
  if (/\b(?:abre|abrir|vai|ir|leva me|mostra|ver|navega|muda)\b/i.test(lower)) {
    const match = DESTINATIONS.find(([pattern]) => pattern.test(lower));
    if (match) return { kind: "navigate", destination: match[1] };
  }
  if (
    /\b(?:vendas?|faturacao|faturado|faturei|faturo|receita|total vendido)\b.*\b(?:hoje|do dia)\b|\b(?:hoje|do dia)\b.*\b(?:vendas?|faturacao|faturado|faturei|faturo|receita)\b/i.test(
      lower,
    )
  )
    return { kind: "today_sales" };
  if (
    /\b(?:melhores|top|principais|maiores)\b.*\bclientes?\b|\bclientes?\b.*\b(?:melhores|top|mais compram)\b/i.test(
      lower,
    )
  )
    return { kind: "top_customers" };
  const productSearch = text.match(
    /(?:procura|procurar|pesquisa|pesquisar|encontra|encontrar|localiza|localizar|onde esta|informacao sobre|stock de)\s+(?:o\s+)?(?:produto|artigo|camisola)?\s*(.+)$/i,
  );
  if (productSearch?.[1])
    return { kind: "find_product", query: productSearch[1].trim() };
  return { kind: "unsupported", original };
}
