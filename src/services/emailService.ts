import type { TripClosureInvoice } from '../types';
import { supabase } from './supabase';

export interface EmailDispatchResult {
  success: boolean;
  message?: string;
  isServerError?: boolean;
}

/**
 * Open the user's default email client (Gmail, Outlook, etc.) with pre-filled invoice metadata.
 */
export function openInvoiceMailClient(invoice: TripClosureInvoice, recipientEmail: string) {
  const subject = encodeURIComponent(
    `Commercial Invoice & Waybill: ${invoice.invoice_number} (${invoice.truck_registration})`
  );
  const bodyText =
    `Commercial Invoice & Waybill\n` +
    `----------------------------------------\n` +
    `Invoice Number:      ${invoice.invoice_number}\n` +
    `Waybill / Trip Ref:  ${invoice.trip_number}\n` +
    `Truck Registration:  ${invoice.truck_registration}\n` +
    `Driver Name:         ${invoice.driver_name}\n` +
    `Quantity:            ${invoice.quantity_tonnes.toFixed(2)} Tonnes\n` +
    `Loading Site:        ${invoice.loading_site_name || 'Loading Yard'}\n` +
    `Offloading Site:     ${invoice.offloading_site_name || 'Offloading Yard'}\n` +
    `Closed At:           ${new Date(invoice.closed_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}\n` +
    `----------------------------------------\n\n` +
    `Note: Please find the downloaded PDF invoice (${invoice.invoice_number}.pdf) attached.`;

  window.open(`mailto:${encodeURIComponent(recipientEmail)}?subject=${subject}&body=${encodeURIComponent(bodyText)}`, '_blank');
}

/**
 * Share invoice PDF file directly using Web Share API (Gmail, Outlook, WhatsApp, AirDrop, etc.)
 */
export async function shareInvoicePdf(invoice: TripClosureInvoice, pdfBlob: Blob): Promise<boolean> {
  const pdfFile = new File([pdfBlob], `${invoice.invoice_number}.pdf`, { type: 'application/pdf' });
  if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
    try {
      await navigator.share({
        files: [pdfFile],
        title: `Commercial Invoice: ${invoice.invoice_number}`,
        text: `Commercial Invoice & Delivery Waybill for Truck ${invoice.truck_registration} (${invoice.invoice_number}).`,
      });
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return false; // User cancelled the share dialog
      }
    }
  }
  return false;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Dispatches the Commercial Invoice PDF to the target email via the Supabase Edge Function pipeline.
 */
export async function sendInvoicePdfEmail(
  invoice: TripClosureInvoice,
  pdfBlob: Blob,
  recipientEmail: string
): Promise<EmailDispatchResult> {
  const targetEmail = recipientEmail.trim();
  if (!targetEmail || !targetEmail.includes('@')) {
    return { success: false, message: 'Please provide a valid recipient email address.' };
  }

  try {
    const pdfBase64 = await blobToBase64(pdfBlob);
    const { data: supaData, error: supaErr } = await supabase.functions.invoke('send-invoice-email', {
      body: {
        recipientEmail: targetEmail,
        invoice,
        pdfBase64,
      },
    });

    if (!supaErr && supaData && supaData.success) {
      return {
        success: true,
        message: supaData.message || `Invoice PDF successfully dispatched via Supabase to ${targetEmail}`,
      };
    }

    if (supaErr) {
      const errContext = (supaErr as any)?.context;
      const status = errContext?.status;

      if (status === 404) {
        return {
          success: false,
          isServerError: true,
          message: 'Supabase Edge Function (send-invoice-email) is pending deployment on this project. Use "Open Mail App" or "Share PDF" below to send immediately.',
        };
      }

      if (status === 502 || status === 503) {
        return {
          success: false,
          isServerError: true,
          message: 'Supabase email provider unavailable. Use "Open Mail App" or "Share PDF" below.',
        };
      }
    }

    if (supaData && !supaData.success) {
      return {
        success: false,
        message: supaData.error || 'Failed to dispatch invoice email via Supabase.',
      };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error invoking Supabase email function';
    return {
      success: false,
      isServerError: true,
      message: `${message}. Use "Open Mail App" or "Share PDF" below to send directly.`,
    };
  }

  return {
    success: false,
    isServerError: true,
    message: 'Supabase Edge Function is pending deployment. Use "Open Mail App" or "Share PDF" below to deliver the invoice.',
  };
}
