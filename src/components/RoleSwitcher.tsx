import React from 'react';
import { useAppStore } from '../services/store';
import { UserRole } from '../types';
import {
  Camera,
  CheckCircle2,
  LayoutDashboard,
  AlertTriangle,
  CreditCard,
  FileCheck2,
  Database,
} from 'lucide-react';

interface TabItem {
  id: UserRole | 'master_data';
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export const RoleSwitcher: React.FC<{
  activeTab: string;
  setActiveTab: (tab: string) => void;
}> = ({ activeTab, setActiveTab }) => {
  const { setCurrentRole, exceptions, draftTrips } = useAppStore();

  const pendingExceptionsCount = exceptions.filter((e) => e.status === 'pending').length;

  const tabs: TabItem[] = [
    {
      id: 'loading_officer',
      label: 'Loading Gate (Capture)',
      icon: <Camera size={16} />,
      badge: draftTrips.length > 0 ? draftTrips.length : undefined,
    },
    {
      id: 'offloading_officer',
      label: 'Offload Depot (Verify)',
      icon: <CheckCircle2 size={16} />,
    },
    {
      id: 'operations_manager',
      label: 'Operations Command',
      icon: <LayoutDashboard size={16} />,
    },
    {
      id: 'exception_manager' as any,
      label: 'Exceptions & Triage',
      icon: <AlertTriangle size={16} />,
      badge: pendingExceptionsCount > 0 ? pendingExceptionsCount : undefined,
    },
    {
      id: 'finance_officer',
      label: 'Paystack & Finance',
      icon: <CreditCard size={16} />,
    },
    {
      id: 'audit_reviewer',
      label: 'Immutable Audit Log',
      icon: <FileCheck2 size={16} />,
    },
    {
      id: 'master_data',
      label: 'Master Data & Specs',
      icon: <Database size={16} />,
    },
  ];

  const handleSelect = (id: string) => {
    setActiveTab(id);
    if (id !== 'exception_manager' && id !== 'master_data') {
      setCurrentRole(id as UserRole);
    } else if (id === 'exception_manager') {
      setCurrentRole('operations_manager');
    }
  };

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.7)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0.4rem 1.25rem',
      }}
    >
      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'flex',
          gap: '0.5rem',
          overflowX: 'auto',
          paddingBottom: '0.2rem',
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleSelect(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.55rem 1rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.85rem',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#000' : 'var(--text-secondary)',
                background: isActive
                  ? 'linear-gradient(135deg, var(--accent-gold) 0%, #D97706 100%)'
                  : 'transparent',
                border: isActive ? '1px solid transparent' : '1px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  style={{
                    background: isActive ? '#000' : 'var(--accent-rose)',
                    color: isActive ? 'var(--accent-gold)' : '#fff',
                    borderRadius: '10px',
                    padding: '0.1rem 0.45rem',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
