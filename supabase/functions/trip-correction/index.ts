// Supabase Edge Function: trip-correction
// Handles managerial dispute resolution with mandatory audit reason logging
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

    const { tripId, exceptionId, action, correctedQuantity, reason, managerId } = await req.json();

    if (!tripId || !reason || !action) {
      return new Response(
        JSON.stringify({ error: "tripId, action, and mandatory reason are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch current trip state
    const { data: trip, error: fetchErr } = await supabaseClient
      .from("trips")
      .select("*, trip_offloading_events(*)")
      .eq("id", tripId)
      .single();

    if (fetchErr || !trip) {
      return new Response(
        JSON.stringify({ error: "Trip record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const oldValue = { ...trip };
    let newStatus = trip.status;

    if (action === "resolve_discrepancy") {
      newStatus = "closed";
      if (correctedQuantity) {
        await supabaseClient
          .from("trip_offloading_events")
          .update({ quantity: correctedQuantity, operator_notes: `Correction: ${reason}` })
          .eq("trip_id", tripId);
      }
    } else if (action === "cancel_trip") {
      newStatus = "cancelled";
    }

    // Update trip status
    await supabaseClient
      .from("trips")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", tripId);

    // Resolve exception if provided
    if (exceptionId) {
      await supabaseClient
        .from("exceptions")
        .update({
          status: action === "cancel_trip" ? "dismissed" : "resolved",
          resolution_notes: reason,
          resolved_by: managerId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", exceptionId);
    }

    // Insert immutable audit log
    await supabaseClient.from("audit_log").insert({
      entity_name: "trips",
      entity_id: tripId,
      action: "CORRECTION_APPLIED",
      old_value: oldValue,
      new_value: { ...oldValue, status: newStatus, correctedQuantity },
      reason: `Managerial Correction: ${reason}`,
      actor_id: managerId,
      actor_role: "operations_manager",
    });

    return new Response(
      JSON.stringify({ success: true, newStatus, message: "Trip correction recorded to immutable ledger." }),
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
