import React, { useState } from 'react';
import { UserRole } from '../../types';
import { TektwigLogo } from '../common/TektwigLogo';
import { LoginScreen } from './LoginScreen';
import { ArrowRight, LogIn } from 'lucide-react';

interface LandingPageProps {
  onSignIn: (role: UserRole) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn }) => {
  const [isLoginScreenOpen, setIsLoginScreenOpen] = useState(false);

  if (isLoginScreenOpen) {
    return <LoginScreen onSignIn={onSignIn} onBack={() => setIsLoginScreenOpen(false)} />;
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        overflowX: 'hidden',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: '#FFFFFF',
          padding: '0.6rem 0',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <div
          className="app-container"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <TektwigLogo height={42} />
          </div>

          <div>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.45rem 1.15rem',
                fontSize: '0.875rem',
                fontWeight: 700,
                borderRadius: 'var(--radius-md)',
                minHeight: '40px',
                backgroundColor: 'var(--brand-primary)',
                color: '#FFFFFF',
                cursor: 'pointer',
              }}
              onClick={() => setIsLoginScreenOpen(true)}
            >
              <LogIn size={15} />
              <span>Sign In</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area — Clean, Mobile-First Headline & Access Terminal Button */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '2.5rem 1rem 3rem 1rem',
        }}
      >
        <div
          className="app-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: '680px',
            gap: '1.75rem',
          }}
        >
          {/* Subtle Tag */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: '#EFF6FF',
              color: 'var(--brand-primary)',
              padding: '0.3rem 0.85rem',
              borderRadius: '999px',
              fontSize: '0.75rem',
              fontWeight: 700,
              border: '1px solid #DBEAFE',
            }}
          >
            <span>OPERATIONAL ASSURANCE SYSTEM</span>
          </div>

          {/* Clean Main Headline */}
          <h1
            style={{
              fontSize: 'clamp(1.75rem, 5vw, 2.6rem)',
              fontWeight: 800,
              lineHeight: 1.18,
              color: '#0F172A',
              letterSpacing: '-0.03em',
            }}
          >
            Operational Assurance for Sand Dredging & Truck Haulage
          </h1>

          {/* Description */}
          <p
            style={{
              fontSize: 'clamp(0.925rem, 2.5vw, 1.05rem)',
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
              maxWidth: '560px',
            }}
          >
            <strong>Tektwig DredgeOps</strong> secures the sand haulage lifecycle with immutable, event-driven
            verification across pit pickup, weighbridge delivery, and revenue assurance.
          </p>

          {/* Primary Call to Action Button */}
          <div style={{ width: '100%', maxWidth: '360px', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={() => setIsLoginScreenOpen(true)}
              className="btn btn-primary"
              style={{
                width: '100%',
                minHeight: '52px',
                padding: '0.85rem 1.5rem',
                fontSize: '1rem',
                fontWeight: 700,
                borderRadius: 'var(--radius-lg)',
                backgroundColor: 'var(--brand-primary)',
                color: '#FFFFFF',
                boxShadow: 'var(--shadow-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.65rem',
                cursor: 'pointer',
              }}
            >
              <span>Access Terminal</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </main>

      {/* Clean Minimal Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: '#FFFFFF',
          padding: '1rem 0',
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
        }}
      >
        <div
          className="app-container"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Tektwig DredgeOps</span>
          <span>Operational Assurance & Revenue Protection</span>
        </div>
      </footer>
    </div>
  );
};
