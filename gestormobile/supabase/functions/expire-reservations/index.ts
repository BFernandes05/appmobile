import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req) => {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Procurar reservas pendentes expiradas
    const { data: expiredReservations, error: fetchError } = await supabase
      .from('reservations')
      .select('*')
      .eq('status', 'Pendente')
      .lt('expires_at', new Date().toISOString());

    if (fetchError) throw fetchError;

    let processedCount = 0;

    for (const res of expiredReservations) {
      // 2. Mudar status para Cancelada
      const { error: updateError } = await supabase
        .from('reservations')
        .update({ status: 'Cancelada' })
        .eq('id', res.id);
        
      if (updateError) {
        console.error('Erro ao cancelar reserva:', updateError);
        continue;
      }

      // 3. Repor o stock na tabela product_variants
      const { data: variant, error: varError } = await supabase
        .from('product_variants')
        .select('stock_quantity')
        .eq('id', res.product_variant_id)
        .single();
        
      if (!varError && variant) {
        await supabase
          .from('product_variants')
          .update({ stock_quantity: variant.stock_quantity + res.quantity })
          .eq('id', res.product_variant_id);
      }
      
      processedCount++;
    }

    return new Response(
      JSON.stringify({ success: true, processed: processedCount }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
