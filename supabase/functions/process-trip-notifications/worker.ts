export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  resendApiKey: string;
  sender: string;
  financeRecipients: string[];
}

interface Job {
  id: string;
  lease_token: string;
  email_request: Record<string, unknown>;
}

export async function processNotifications(config: WorkerConfig, http: typeof fetch = fetch) {
  const rpc = async <T>(name: string, body: unknown): Promise<T> => {
    const response = await http(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Database operation failed (${response.status})`);
    return await response.json() as T;
  };

  const jobs = await rpc<Job[]>('claim_trip_notifications', {
    p_finance_recipients: config.financeRecipients,
    p_sender: config.sender,
    p_limit: 5,
  });
  let sent = 0, deferred = 0, unacknowledged = 0;
  for (const job of jobs) {
    let providerId: string | null = null;
    let failure = 'Email provider unavailable or acceptance uncertain';
    try {
      const response = await http('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `trip-notification/${job.id}`,
        },
        body: JSON.stringify(job.email_request),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const data: unknown = await response.json();
        if (data && typeof data === 'object' && 'id' in data && typeof data.id === 'string' && data.id) providerId = data.id;
      } else {
        failure = `Email provider HTTP ${response.status}`;
      }
    } catch {
      // A timeout may occur after provider acceptance: retry with the same key.
    }
    try {
      const acknowledged = await rpc<boolean>('finish_trip_notification', {
        p_id: job.id,
        p_lease_token: job.lease_token,
        p_sent: providerId !== null,
        p_provider_message_id: providerId,
        p_error: providerId ? null : failure,
      });
      if (!acknowledged) unacknowledged++;
      else if (providerId) sent++;
      else deferred++;
    } catch {
      // Lease expiry makes work reclaimable if database acknowledgement fails.
      unacknowledged++;
    }
  }
  return { claimed: jobs.length, sent, deferred, unacknowledged };
}
