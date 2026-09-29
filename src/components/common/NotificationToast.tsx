import React, { useEffect } from 'react';

export interface ToastMessage {
  id: string;
  type?: 'info' | 'success' | 'warning';
  title: string;
  detail?: string;
}

interface NotificationToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const NotificationToastContainer: React.FC<NotificationToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        maxWidth: '380px',
        width: 'calc(100vw - 3rem)',
        pointerEvents: 'none',
      }}
      aria-live="polite"
    >
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 4500);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const borderAccent =
    toast.type === 'success'
      ? '#059669'
      : toast.type === 'warning'
      ? '#d97706'
      : '#0f766e';

  return (
    <div
      style={{
        pointerEvents: 'auto',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderLeft: `4px solid ${borderAccent}`,
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.12), 0 2px 6px -1px rgba(15, 23, 42, 0.06)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '0.75rem',
        animation: 'slideIn 0.25s ease-out',
      }}
      role="status"
    >
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#172b3a', lineHeight: 1.3 }}>
          {toast.title}
        </div>
        {toast.detail && (
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem', lineHeight: 1.4 }}>
            {toast.detail}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        style={{
          background: 'none',
          border: 'none',
          color: '#94a3b8',
          cursor: 'pointer',
          padding: '0.2rem',
          fontSize: '0.9rem',
          lineHeight: 1,
          alignSelf: 'flex-start',
        }}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
};
