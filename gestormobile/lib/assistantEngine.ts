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

async function findVariant(
  product: string,
  size: string,
): Promise<VariantMatch> {
  const { data, error } = await supabase
    .from("product_variants")
    .select("id,size,stock_quantity,base_price,products!inner(name)")
    .ilike("products.name", `%${product}%`)
    .ilike("size", size)
    .eq("is_active", true)
    .limit(3);
  if (error) throw error;
  const matches = (data ?? []) as unknown as VariantMatch[];
  if (!matches.length)
    throw new Error(`Não encontrei “${product}” no tamanho ${size}.`);
  if (matches.length > 1)
    throw new Error(
      `Encontrei mais do que um artigo para “${product}”. Indica um nome mais específico.`,
    );
  return matches[0];
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
      const { data, error } = await supabase
        .from("products")
        .select(
          "name,category,product_variants(size,stock_quantity,base_price)",
        )
        .ilike("name", `%${intent.query}%`)
        .eq("is_active", true)
        .limit(5);
      if (error) throw error;
      if (!data?.length)
        return {
          type: "message",
          text: `Não encontrei artigos para “${intent.query}”.`,
        };
      const text = data
        .map(
          (product: any) =>
            `• ${product.name} (${product.category})\n  ${(product.product_variants ?? []).map((variant: any) => `${variant.size}: ${variant.stock_quantity} un. · ${Number(variant.base_price).toFixed(2)} €`).join("; ") || "Sem variantes"}`,
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
  const { error } = await supabase
    .from("reservations")
    .insert({
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
