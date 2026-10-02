export type FieldSessionProbe =
  | { status: 'valid'; expiresInMs: number; operationalDate?: string }
  | { status: 'expired' | 'inactive' | 'not_field' }
  | { status: 'unavailable' };

type TimerWindow = Pick<Window, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'
  | 'addEventListener' | 'removeEventListener'>;
type VisibilityDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

export function watchFieldSession(
  probe: () => Promise<FieldSessionProbe>,
  onEnd: (status: 'expired' | 'inactive' | 'not_field') => void,
  browser: { window: TimerWindow; document: VisibilityDocument } = { window, document },
) {
  let stopped = false;
  let checking = false;
  let boundaryTimer: number | undefined;
  let retryTimer: number | undefined;

  const clearTimers = () => {
    if (boundaryTimer !== undefined) browser.window.clearTimeout(boundaryTimer);
    if (retryTimer !== undefined) browser.window.clearTimeout(retryTimer);
    boundaryTimer = undefined;
    retryTimer = undefined;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimers();
    browser.window.clearInterval(pollTimer);
    browser.window.removeEventListener('focus', onWake);
    browser.window.removeEventListener('pageshow', onWake);
    browser.document.removeEventListener('visibilitychange', onVisibility);
  };
  const scheduleRetry = () => {
    if (!stopped) retryTimer = browser.window.setTimeout(() => void check(), 15_000);
  };
  const check = async () => {
    if (stopped || checking) return;
    checking = true;
    clearTimers();
    try {
      const result = await probe();
      if (stopped) return;
      if (result.status === 'valid') {
        boundaryTimer = browser.window.setTimeout(() => {
          if (stopped) return;
          stop();
          onEnd('expired');
        }, Math.max(0, result.expiresInMs));
      } else if (result.status === 'unavailable') scheduleRetry();
      else {
        stop();
        onEnd(result.status);
      }
    } catch {
      scheduleRetry();
    } finally {
      checking = false;
    }
  };
  const onWake = () => void check();
  const onVisibility = () => {
    if (browser.document.visibilityState === 'visible') void check();
  };
  const pollTimer = browser.window.setInterval(() => {
    if (browser.document.visibilityState === 'visible') void check();
  }, 60_000);
  browser.window.addEventListener('focus', onWake);
  browser.window.addEventListener('pageshow', onWake);
  browser.document.addEventListener('visibilitychange', onVisibility);
  void check();
  return stop;
}
