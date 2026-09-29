import type { TripClosureInvoice } from '../types';

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

/**
 * Dispatches the Commercial Invoice PDF to the target email via FormSubmit with error resilience.
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

  const formData = new FormData();
  formData.append('_subject', `Commercial Invoice & Waybill: ${invoice.invoice_number} (${invoice.truck_registration})`);
  formData.append('_template', 'table');
  formData.append('_captcha', 'false');
  formData.append('Invoice Number', invoice.invoice_number);
  formData.append('Trip Reference', invoice.trip_number);
  formData.append('Truck Registration', invoice.truck_registration);
  formData.append('Driver Name', invoice.driver_name);
  formData.append('Quantity (Tonnes)', `${invoice.quantity_tonnes.toFixed(2)} tonnes`);
  formData.append('Loading Site', invoice.loading_site_name || 'Loading Yard');
  formData.append('Offloading Site', invoice.offloading_site_name || 'Offloading Yard');
  formData.append('Closed At', new Date(invoice.closed_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }));

  // Attach the generated PDF
  const pdfFile = new File([pdfBlob], `${invoice.invoice_number}.pdf`, { type: 'application/pdf' });
  formData.append('attachment', pdfFile, `${invoice.invoice_number}.pdf`);

  try {
    const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(targetEmail)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: formData,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      if (response.status === 500) {
        return {
          success: false,
          isServerError: true,
          message: 'FormSubmit.co returned 500 (remote server issue). Use "Open Email Client" or "Share PDF" below to send directly.',
        };
      }
      const errMsg = data?.message || `FormSubmit returned status ${response.status}`;
      return { success: false, message: errMsg };
    }

    return {
      success: true,
      message: `Invoice PDF successfully dispatched to ${targetEmail}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error connecting to email service';
    return {
      success: false,
      isServerError: true,
      message: `${message}. Use "Open Email Client" or "Share PDF" below to send directly.`,
    };
  }
}
