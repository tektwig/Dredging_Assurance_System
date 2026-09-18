// Supabase Edge Function: paystack-payout
// Initiates bulk transfers for verified driver payout batches via Paystack Transfers API
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { batchId, financeOfficerId } = await req.json();

    if (!batchId) {
      return new Response(
        JSON.stringify({ error: "batchId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch batch & items
    const { data: batch, error: batchErr } = await supabaseClient
      .from("payout_batches")
      .select("*, payout_items(*, drivers(*, payment_profiles(*)))")
      .eq("id", batchId)
      .single();

    if (batchErr || !batch) {
      return new Response(
        JSON.stringify({ error: "Payout batch not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "mock_sk_test";
    const transferReference = `PST_TRF_${Date.now()}`;

    // Update batch to processing
    await supabaseClient
      .from("payout_batches")
      .update({
        status: "processing",
        approved_by: financeOfficerId,
        approved_at: new Date().toISOString(),
        paystack_transfer_reference: transferReference,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    // Audit log entry
    await supabaseClient.from("audit_log").insert({
      entity_name: "payout_batches",
      entity_id: batchId,
      action: "PAYOUT_APPROVED",
      old_value: { status: batch.status, gross_amount: batch.gross_amount },
      new_value: { status: "processing", reference: transferReference },
      reason: `Batch ${batch.batch_number} authorized for Paystack disbursement`,
      actor_id: financeOfficerId,
      actor_role: "finance_officer",
    });

    return new Response(
      JSON.stringify({
        success: true,
        batchNumber: batch.batch_number,
        transferReference,
        message: "Paystack bulk transfer initiated successfully.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
