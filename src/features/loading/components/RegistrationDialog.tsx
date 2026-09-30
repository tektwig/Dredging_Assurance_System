import { useEffect, useRef, type ReactNode } from 'react';

export function RegistrationDialog({ open, onCancel, children }: {
  open: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) element.querySelector<HTMLElement>('input, button')?.focus();
    return () => { if (element.open) element.close(); };
  }, [open]);

  if (!open) return null;
  return <dialog ref={dialog} className="loading-registration-dialog" aria-label="Register truck and driver"
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    {children}
  </dialog>;
}
