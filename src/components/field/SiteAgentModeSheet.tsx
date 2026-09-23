import React from 'react';
import { Truck, Scale, ArrowRight, Shield, X } from 'lucide-react';

interface SiteAgentModeSheetProps {
  isOpen: boolean;
  onSelectMode: (mode: 'pickup' | 'delivery') => void;
  onClose?: () => void;
  isMandatory?: boolean;
}

export const SiteAgentModeSheet: React.FC<SiteAgentModeSheetProps> = ({
  isOpen,
  onSelectMode,
  onClose,
  isMandatory = false,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        zIndex: 1100,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        display: 'flex',
        alignItems: 'flex-end', // Bottom sheet positioning
        justifyContent: 'center',
        padding: 0,
        backdropFilter: 'blur(3px)',
      }}
      onClick={(e) => {
        // When mandatory, background clicks NEVER dismiss the sheet
        if (!isMandatory && e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div
        className="bottom-sheet"
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.25)',
          padding: '1.25rem 1.25rem 2rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Drag / Pull handle bar */}
        <div
          style={{
            width: '40px',
            height: '4px',
            backgroundColor: '#CBD5E1',
            borderRadius: '999px',
            alignSelf: 'center',
            marginBottom: '0.25rem',
          }}
        />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.25rem' }}>
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  backgroundColor: '#FEF3C7',
                  color: '#B45309',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '999px',
                  border: '1px solid #FCD34D',
                }}
              >
                SITE AGENT DISPATCH
              </span>
            </div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
              Are you working on Pickup or Delivery today?
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Select your active terminal post to load the relevant scanner & forms.
            </p>
          </div>

          {!isMandatory && onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '0.25rem',
                minWidth: '36px',
                minHeight: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* The 2 Primary Action Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Pickup Button Card */}
          <button
            type="button"
            onClick={() => onSelectMode('pickup')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '1.15rem 1rem',
              borderRadius: 'var(--radius-lg)',
              border: '2px solid #FCD34D',
              backgroundColor: '#FFFDF5',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              minHeight: '74px',
              transition: 'all 0.15s ease',
              boxShadow: 'var(--shadow-xs)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#FEF3C7';
              e.currentTarget.style.borderColor = '#B45309';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#FFFDF5';
              e.currentTarget.style.borderColor = '#FCD34D';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: '#FEF3C7',
                  color: '#B45309',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1.5px solid #FCD34D',
                  flexShrink: 0,
                }}
              >
                <Truck size={24} />
              </div>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#92400E', lineHeight: 1.2 }}>
                  Pickup
                </div>
                <div style={{ fontSize: '0.78rem', color: '#B45309', fontWeight: 600, marginTop: '0.15rem' }}>
                  Gate 1 Dredge Pit
                </div>
                <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Truck license plate scan & digital dispatch waybill issuance
                </div>
              </div>
            </div>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#FEF3C7',
                color: '#B45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <ArrowRight size={16} />
            </div>
          </button>

          {/* Delivery Button Card */}
          <button
            type="button"
            onClick={() => onSelectMode('delivery')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '1.15rem 1rem',
              borderRadius: 'var(--radius-lg)',
              border: '2px solid #BAE6FD',
              backgroundColor: '#F0F9FF',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              minHeight: '74px',
              transition: 'all 0.15s ease',
              boxShadow: 'var(--shadow-xs)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#E0F2FE';
              e.currentTarget.style.borderColor = '#0369A1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#F0F9FF';
              e.currentTarget.style.borderColor = '#BAE6FD';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: '#E0F2FE',
                  color: '#0369A1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1.5px solid #BAE6FD',
                  flexShrink: 0,
                }}
              >
                <Scale size={24} />
              </div>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#075985', lineHeight: 1.2 }}>
                  Delivery
                </div>
                <div style={{ fontSize: '0.78rem', color: '#0369A1', fontWeight: 600, marginTop: '0.15rem' }}>
                  Gate 2 Weighbridge
                </div>
                <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Scale ticket photo, tonnage verification & trip closure
                </div>
              </div>
            </div>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#E0F2FE',
                color: '#0369A1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <ArrowRight size={16} />
            </div>
          </button>
        </div>

        {/* Footer info note */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            fontSize: '0.725rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
            paddingTop: '0.25rem',
          }}
        >
          <Shield size={12} color="#0284C7" />
          <span>Locked operational post for shift integrity and fraud prevention</span>
        </div>
      </div>
    </div>
  );
};
