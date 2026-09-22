import React from 'react';

interface PlateDisplayProps {
  plate: string;
  size?: 'sm' | 'md' | 'lg';
  flagText?: string;
}

export const PlateDisplay: React.FC<PlateDisplayProps> = ({
  plate,
  size = 'md',
  flagText = 'NG',
}) => {
  const formattedPlate = plate.toUpperCase().replace(/\s+/g, '-');

  const sizeStyles = {
    sm: { fontSize: '0.85rem', padding: '0.15rem 0.5rem', flagSize: '0.55rem' },
    md: { fontSize: '1.1rem', padding: '0.25rem 0.75rem', flagSize: '0.65rem' },
    lg: { fontSize: '1.4rem', padding: '0.35rem 1rem', flagSize: '0.75rem' },
  }[size];

  return (
    <div className="plate-box" title={`Registration: ${formattedPlate}`}>
      <div
        className="plate-flag"
        style={{ fontSize: sizeStyles.flagSize }}
      >
        <span>{flagText}</span>
      </div>
      <div
        className="plate-text"
        style={{
          fontSize: sizeStyles.fontSize,
          padding: sizeStyles.padding,
        }}
      >
        {formattedPlate}
      </div>
    </div>
  );
};
