import React from 'react';

interface TektwigLogoProps {
  height?: number;
  className?: string;
}

export const TektwigLogo: React.FC<TektwigLogoProps> = ({
  height = 44,
  className = '',
}) => {
  return (
    <div className={`tektwig-brand-container ${className}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <img
        src="/tektwig-logo.png"
        alt="Tektwig Logo"
        style={{
          height: `${height}px`,
          width: 'auto',
          objectFit: 'contain',
          display: 'block',
          filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.04))',
        }}
      />
    </div>
  );
};
