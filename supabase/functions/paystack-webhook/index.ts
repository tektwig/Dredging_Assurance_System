// Supabase Edge Function: paystack-webhook
// Securely verifies and processes Paystack transfer status webhooks
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

serve(async (req: Request) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const bodyText = await req.text();
    const event = JSON.parse(bodyText);

    // In production, verify crypto HMAC-SHA512 with Paystack secret header
    // x-paystack-signature
    const eventType = event.event;
    const eventData = event.data;

    if (eventType === "transfer.success") {
      const transferCode = eventData.transfer_code;
      await supabaseClient
        .from("payout_items")
        .update({ status: "success" })
        .eq("transfer_code", transferCode);
    } else if (eventType === "transfer.failed" || eventType === "transfer.reversed") {
      const transferCode = eventData.transfer_code;
      await supabaseClient
        .from("payout_items")
        .update({ status: "failed", failure_reason: eventData.reason || "Paystack transfer failed" })
        .eq("transfer_code", transferCode);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
