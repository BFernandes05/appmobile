import { supabase } from "@/lib/supabase";
import type { AssistantIntent } from "@/lib/assistantParser";

export type PreparedAssistantAction =
  | {
      kind: "adjust_stock";
      title: string;
      description: string;
      variantId: string;
      previousStock: number;
      nextStock: number;
    }
  | {
      kind: "create_reservation";
      title: string;
      description: string;
      variantId: string;
      quantity: number;
      totalPrice: number;
      customer: string;
      days: number;
    };
export type AssistantOutcome =
  | { type: "message"; text: string }
  | { type: "navigate"; destination: string; text: string }
  | { type: "confirmation"; text: string; action: PreparedAssistantAction };
type VariantMatch = {
  id: string;
  size: string;
  stock_quantity: number;
  base_price: number;
  products: { name: string } | null;
};

type ProductMatch = {
  id: string;
  name: string;
  category: string;
  product_variants: Array<{
    id: string;
    size: string;
    stock_quantity: number;
    base_price: number;
    is_active: boolean;
  }>;
};

function comparableProductName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\ba\s+way\b|\b(?:auei|auai)\b/g, "away")
    .replace(/\b(2\d)[\s./-]+(2\d)\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length];
}

function productScore(candidate: string, requested: string) {
  const name = comparableProductName(candidate);
  const query = comparableProductName(requested);
  if (name === query) return 1;
  if (name.includes(query) || query.includes(name)) return 0.92;
  const nameTokens = new Set(name.split(" "));
  const queryTokens = new Set(query.split(" "));
  const common = [...queryTokens].filter((token) =>
    nameTokens.has(token),
  ).length;
  const tokenScore = common / Math.max(nameTokens.size, queryTokens.size, 1);
  const characterScore =
    1 - editDistance(name, query) / Math.max(name.length, query.length, 1);
  return tokenScore * 0.6 + characterScore * 0.4;
}

async function activeProducts(): Promise<ProductMatch[]> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id,name,category,product_variants!inner(id,size,stock_quantity,base_price,is_active)",
    )
    .eq("is_active", true)
    .eq("product_variants.is_active", true)
    .limit(250);
  if (error) throw error;
  return (data ?? []) as unknown as ProductMatch[];
}

async function findProduct(product: string) {
  const ranked = (await activeProducts())
    .map((candidate) => ({
      candidate,
      score: productScore(candidate.name, product),
    }))
    .sort((left, right) => right.score - left.score);
  if (!ranked.length || ranked[0].score < 0.48)
    throw new Error(`Não encontrei “${product}”.`);
  if (
    ranked[1] &&
    ranked[1].score >= ranked[0].score - 0.08 &&
    comparableProductName(ranked[1].candidate.name) !==
      comparableProductName(ranked[0].candidate.name)
  ) {
    throw new Error(
      `Encontrei resultados parecidos: “${ranked[0].candidate.name}” e “${ranked[1].candidate.name}”. Qual deles pretendes?`,
    );
  }
  return ranked[0].candidate;
}

async function findVariant(
  product: string,
  size: string,
): Promise<VariantMatch> {
  const matchedProduct = await findProduct(product);
  const requestedSize = size.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const matches = matchedProduct.product_variants.filter(
    (variant) =>
      variant.size.replace(/[^a-z0-9]/gi, "").toUpperCase() === requestedSize,
  );
  if (!matches.length) {
    const sizes = matchedProduct.product_variants
      .map((variant) => variant.size)
      .join(", ");
    throw new Error(
      `“${matchedProduct.name}” não tem o tamanho ${size}. Disponíveis: ${sizes || "nenhum"}.`,
    );
  }
  if (matches.length > 1)
    throw new Error(
      `Existem variantes duplicadas de “${matchedProduct.name}” no tamanho ${size}. Corrige o duplicado no Catálogo antes de alterar o stock.`,
    );
  return { ...matches[0], products: { name: matchedProduct.name } };
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export async function prepareAssistantIntent(
  intent: AssistantIntent,
): Promise<AssistantOutcome> {
  switch (intent.kind) {
    case "navigate":
      return {
        type: "navigate",
        destination: intent.destination,
        text: `A abrir ${intent.destination}.`,
      };
    case "low_stock": {
      const { data, error } = await supabase
        .from("product_variants")
        .select("size,stock_quantity,products!inner(name)")
        .lt("stock_quantity", intent.threshold)
        .eq("is_active", true)
        .eq("products.is_active", true)
        .order("stock_quantity")
        .limit(10);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{
        size: string;
        stock_quantity: number;
        products: { name: string } | null;
      }>;
      if (!rows.length)
        return {
          type: "message",
          text: `Não existem variantes com menos de ${intent.threshold} unidades.`,
        };
      return {
        type: "message",
        text: `Stock abaixo de ${intent.threshold}:\n${rows.map((row) => `• ${row.products?.name ?? "Artigo"} · ${row.size}: ${row.stock_quantity} un.`).join("\n")}`,
      };
    }
    case "today_sales": {
      const { data, error } = await supabase
        .from("sales")
        .select("quantity,total_price")
        .gte("sale_date", startOfToday())
        .is("cancelled_at", null);
      if (error) throw error;
      const quantity = (data ?? []).reduce(
        (sum, sale) => sum + Number(sale.quantity),
        0,
      );
      const total = (data ?? []).reduce(
        (sum, sale) => sum + Number(sale.total_price),
        0,
      );
      return {
        type: "message",
        text: `Hoje foram vendidas ${quantity} unidade${quantity === 1 ? "" : "s"}, num total de ${total.toFixed(2)} €.`,
      };
    }
    case "top_customers": {
      const { data, error } = await supabase
        .from("sales")
        .select("customer_name,total_price")
        .is("cancelled_at", null)
        .not("customer_name", "is", null)
        .limit(500);
      if (error) throw error;
      const totals = new Map<string, number>();
      for (const sale of data ?? []) {
        const name = sale.customer_name?.trim();
        if (name)
          totals.set(name, (totals.get(name) ?? 0) + Number(sale.total_price));
      }
      const ranking = [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      if (!ranking.length)
        return {
          type: "message",
          text: "Ainda não existem vendas associadas a clientes.",
        };
      return {
        type: "message",
        text: `Melhores clientes por faturação:\n${ranking.map(([name, total], index) => `${index + 1}. ${name} · ${total.toFixed(2)} €`).join("\n")}`,
      };
    }
    case "find_product": {
      const ranked = (await activeProducts())
        .map((product) => ({
          product,
          score: productScore(product.name, intent.query),
        }))
        .filter((result) => result.score >= 0.42)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);
      if (!ranked.length)
        return {
          type: "message",
          text: `Não encontrei artigos para “${intent.query}”.`,
        };
      const text = ranked
        .map(
          ({ product }) =>
            `• ${product.name} (${product.category})\n  ${product.product_variants.map((variant) => `${variant.size}: ${variant.stock_quantity} un. · ${Number(variant.base_price).toFixed(2)} €`).join("; ") || "Sem variantes"}`,
        )
        .join("\n");
      return { type: "message", text };
    }
    case "adjust_stock": {
      const variant = await findVariant(intent.product, intent.size);
      const nextStock =
        variant.stock_quantity +
        (intent.operation === "add" ? intent.quantity : -intent.quantity);
      if (nextStock < 0)
        throw new Error(
          `Não é possível retirar ${intent.quantity}. O stock atual é ${variant.stock_quantity}.`,
        );
      const name = variant.products?.name ?? intent.product;
      return {
        type: "confirmation",
        text: "Confirma a alteração antes de atualizar o stock.",
        action: {
          kind: "adjust_stock",
          title: `${intent.operation === "add" ? "Adicionar" : "Retirar"} ${intent.quantity} unidade${intent.quantity === 1 ? "" : "s"}`,
          description: `${name} · tamanho ${variant.size}\nStock: ${variant.stock_quantity} → ${nextStock}`,
          variantId: variant.id,
          previousStock: variant.stock_quantity,
          nextStock,
        },
      };
    }
    case "create_reservation": {
      const variant = await findVariant(intent.product, intent.size);
      if (variant.stock_quantity < intent.quantity)
        throw new Error(
          `Stock insuficiente: existem ${variant.stock_quantity} unidades.`,
        );
      const totalPrice = variant.base_price * intent.quantity;
      return {
        type: "confirmation",
        text: "Confirma os dados antes de criar a reserva.",
        action: {
          kind: "create_reservation",
          title: `Reserva para ${intent.customer}`,
          description: `${variant.products?.name ?? intent.product} · tamanho ${variant.size}\n${intent.quantity} un. · ${totalPrice.toFixed(2)} € · ${intent.days} dia${intent.days === 1 ? "" : "s"}`,
          variantId: variant.id,
          quantity: intent.quantity,
          totalPrice,
          customer: intent.customer,
          days: intent.days,
        },
      };
    }
    case "unsupported":
      return {
        type: "message",
        text: "Ainda não reconheço esse pedido. Experimenta um dos exemplos apresentados abaixo.",
      };
  }
}

export async function executeAssistantAction(
  action: PreparedAssistantAction,
  userId?: string,
) {
  if (action.kind === "adjust_stock") {
    const { data, error } = await supabase
      .from("product_variants")
      .update({ stock_quantity: action.nextStock })
      .eq("id", action.variantId)
      .eq("stock_quantity", action.previousStock)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new Error(
        "O stock mudou entretanto. Volta a dar a instrução para confirmar os valores atuais.",
      );
    return "Stock atualizado com sucesso.";
  }
  const reservationDate = new Date();
  const expiresAt = new Date(reservationDate);
  expiresAt.setDate(expiresAt.getDate() + action.days);
  const { error } = await supabase.from("reservations").insert({
    customer_name: action.customer,
    customer_contact: null,
    product_variant_id: action.variantId,
    quantity: action.quantity,
    total_price: action.totalPrice,
    reservation_date: reservationDate.toISOString(),
    expires_at: expiresAt.toISOString(),
    created_by: userId ?? null,
  });
  if (error) throw error;
  return "Reserva criada com sucesso.";
}
