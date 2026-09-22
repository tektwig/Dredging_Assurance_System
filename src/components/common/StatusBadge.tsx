import React from 'react';
import { TripStatus } from '../../types';
import { Clock, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';

interface StatusBadgeProps {
  status: TripStatus | 'active' | 'in_review' | 'resolved' | 'verified' | 'pending';
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const getBadgeConfig = () => {
    switch (status) {
      case 'open':
        return {
          label: 'In Transit',
          icon: <Clock size={12} />,
          className: 'badge-open',
        };
      case 'closed':
      case 'resolved':
      case 'verified':
      case 'active':
        return {
          label: status === 'closed' ? 'Closed & Verified' : status.toUpperCase(),
          icon: <CheckCircle2 size={12} />,
          className: 'badge-closed',
        };
      case 'exception':
      case 'in_review':
        return {
          label: 'Exception Alert',
          icon: <AlertTriangle size={12} />,
          className: 'badge-exception',
        };
      case 'cancelled':
        return {
          label: 'Cancelled',
          icon: <XCircle size={12} />,
          className: 'badge-cancelled',
        };
      case 'draft_capture':
      case 'pending':
        return {
          label: 'Draft / Pending',
          icon: <RefreshCw size={12} />,
          className: 'badge-blue',
        };
      case 'sync_failed':
        return {
          label: 'Sync Retry',
          icon: <RefreshCw size={12} />,
          className: 'badge-exception',
        };
      default:
        return {
          label: String(status).toUpperCase(),
          icon: null,
          className: 'badge-cancelled',
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <span
      className={`badge ${config.className}`}
      style={{
        padding: size === 'sm' ? '0.15rem 0.45rem' : '0.25rem 0.65rem',
        fontSize: size === 'sm' ? '0.7rem' : '0.75rem',
      }}
    >
      {config.icon}
      {config.label}
    </span>
  );
};
