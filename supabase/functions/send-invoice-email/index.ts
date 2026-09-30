// Supabase Edge Function: send-invoice-email
// Dispatches Commercial Invoice and Waybill PDFs via email with audit logging
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvoicePayload {
  invoice_number: string;
  trip_number: string;
  truck_registration: string;
  driver_name: string;
  driver_email?: string;
  driver_phone?: string;
  quantity_tonnes: number;
  loading_site_name?: string;
  offloading_site_name?: string;
  closed_at: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    const { recipientEmail, invoice, pdfBase64 } = await req.json();

    const targetEmail = typeof recipientEmail === "string" ? recipientEmail.trim() : "";
    if (!targetEmail || !targetEmail.includes("@")) {
      return new Response(
        JSON.stringify({ success: false, error: "A valid recipient email address is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!invoice || !invoice.invoice_number) {
      return new Response(
        JSON.stringify({ success: false, error: "Invoice data is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const inv = invoice as InvoicePayload;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const sender = Deno.env.get("TRIP_NOTIFICATION_FROM") || "DredgeOps Assurance <onboarding@resend.dev>";

    const emailSubject = `Commercial Invoice & Waybill: ${inv.invoice_number} (${inv.truck_registration})`;
    const formattedDate = new Date(inv.closed_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
    const driverEmail = inv.driver_email || "Not provided";
    const driverPhone = inv.driver_phone || "Not provided";
    const bankName = inv.bank_name || "Not provided";
    const accountName = inv.account_name || "Not provided";
    const accountNumber = inv.account_number || "Not provided";

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0F766E; padding: 20px; color: #ffffff;">
          <h2 style="margin: 0; font-size: 20px;">DREDGEOPS — COMMERCIAL INVOICE</h2>
          <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Waybill & Revenue Assurance Dispatch</p>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 14px; margin-top: 0;">Please find attached the official commercial invoice for trip <strong>${inv.trip_number}</strong>.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Invoice Number</td><td style="padding: 8px 0; font-weight: bold; text-align: right;">${inv.invoice_number}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Trip Reference</td><td style="padding: 8px 0; font-weight: bold; text-align: right;">${inv.trip_number}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Truck Registration</td><td style="padding: 8px 0; font-weight: bold; text-align: right;">${inv.truck_registration}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Net Quantity</td><td style="padding: 8px 0; font-weight: bold; text-align: right;">${inv.quantity_tonnes} tonnes</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Loading Site</td><td style="padding: 8px 0; text-align: right;">${inv.loading_site_name || "Loading Yard"}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Offloading Site</td><td style="padding: 8px 0; text-align: right;">${inv.offloading_site_name || "Offloading Yard"}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Closed At</td><td style="padding: 8px 0; text-align: right;">${formattedDate}</td></tr>

            <!-- Driver & Payout Bank Details -->
            <tr style="background-color: #f8fafc;"><td colspan="2" style="padding: 12px 4px 4px; font-weight: bold; font-size: 11px; color: #0F766E; text-transform: uppercase; letter-spacing: 0.05em;">Driver &amp; Payout Bank Details</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Driver Name</td><td style="padding: 8px 0; font-weight: bold; text-align: right;">${inv.driver_name}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Driver Email</td><td style="padding: 8px 0; text-align: right;">${driverEmail}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Driver Phone</td><td style="padding: 8px 0; text-align: right;">${driverPhone}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Payout Bank</td><td style="padding: 8px 0; font-weight: bold; text-align: right;">${bankName}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Account Name</td><td style="padding: 8px 0; font-weight: bold; text-align: right;">${accountName}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Account Number (NUBAN)</td><td style="padding: 8px 0; font-family: monospace; font-size: 14px; font-weight: bold; color: #0F766E; text-align: right;">${accountNumber}</td></tr>
          </table>
          <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">This document was automatically generated upon verified weighbridge completion.</p>
        </div>
      </div>
    `;

    // 1. Try sending via Resend if API key is provided
    let providerSuccess = false;
    let providerMessageId: string | null = null;
    let providerError: string | null = null;

    if (resendApiKey) {
      try {
        const emailPayload: Record<string, unknown> = {
          from: sender,
          to: [targetEmail],
          subject: emailSubject,
          html: htmlBody,
        };

        if (pdfBase64 && typeof pdfBase64 === "string") {
          emailPayload.attachments = [
            {
              filename: `${inv.invoice_number}.pdf`,
              content: pdfBase64,
            },
          ];
        }

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(emailPayload),
        });

        if (resendRes.ok) {
          const resendData = await resendRes.json();
          providerSuccess = true;
          providerMessageId = resendData?.id ?? null;
        } else {
          const errData = await resendRes.json().catch(() => null);
          providerError = errData?.message || `Resend returned status ${resendRes.status}`;
        }
      } catch (err: unknown) {
        providerError = err instanceof Error ? err.message : "Error contacting email provider";
      }
    }

    // 2. Queue into notification_outbox for guaranteed persistence / scheduler delivery
    try {
      await supabaseClient.from("notification_outbox").insert({
        audience: "finance",
        recipients: [targetEmail],
        event_type: "waybill_ready",
        payload: {
          invoice_number: inv.invoice_number,
          trip_number: inv.trip_number,
          truck_registration: inv.truck_registration,
          driver_name: inv.driver_name,
          quantity_tonnes: inv.quantity_tonnes,
          sent_via: "send-invoice-email",
          provider_id: providerMessageId,
        },
        status: providerSuccess ? "sent" : "pending",
        sent_at: providerSuccess ? new Date().toISOString() : null,
      });
    } catch {
      // Outbox insert failure should not fail response
    }

    // 3. Log audit event
    try {
      await supabaseClient.from("audit_log").insert({
        entity_name: "invoice_email_dispatch",
        action: "INSERT",
        new_value: {
          invoice_number: inv.invoice_number,
          recipient: targetEmail,
          provider_sent: providerSuccess,
          message_id: providerMessageId,
        },
        reason: "User initiated invoice dispatch",
      });
    } catch {
      // Audit log silent fail
    }

    if (providerSuccess) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Invoice PDF successfully dispatched to ${targetEmail}`,
          messageId: providerMessageId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (resendApiKey && !providerSuccess) {
      return new Response(
        JSON.stringify({
          success: false,
          error: providerError || "Email delivery failed with provider",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If Resend API key is not configured, inform the user that notification is queued in Supabase outbox
    return new Response(
      JSON.stringify({
        success: true,
        queued: true,
        message: `Invoice delivery queued in Supabase for ${targetEmail}. Configure RESEND_API_KEY in Supabase secrets for direct SMTP delivery.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Edge Function error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
