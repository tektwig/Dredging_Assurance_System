import { useEffect, useState, useCallback } from 'react';
import { supabase, isSupabaseLive } from '../services/supabase';
import type { ToastMessage } from '../components/common/NotificationToast';

interface UseRealtimeTripsOptions {
  channelName: string;
  onTripChange?: () => void;
  showToasts?: boolean;
}

export function useRealtimeTrips({
  channelName,
  onTripChange,
  showToasts = true,
}: UseRealtimeTripsOptions) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    if (!showToasts) return;
    const id = crypto.randomUUID();
    setToasts(prev => [...prev.slice(-3), { ...toast, id }]);
  }, [showToasts]);

  useEffect(() => {
    if (!isSupabaseLive || !supabase) return;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips' },
        (payload: any) => {
          onTripChange?.();

          if (payload.eventType === 'INSERT') {
            const trip = payload.new;
            addToast({
              type: 'info',
              title: `Trip ${trip.trip_number || 'Opened'}`,
              detail: trip.truck_registration_at_loading
                ? `Vehicle: ${trip.truck_registration_at_loading}`
                : 'A new loading trip has been dispatched.',
            });
          } else if (payload.eventType === 'UPDATE') {
            const trip = payload.new;
            if (trip.status === 'closed') {
              addToast({
                type: 'success',
                title: `Trip ${trip.trip_number || ''} Closed`,
                detail: trip.quantity_tonnes
                  ? `Delivered: ${Number(trip.quantity_tonnes).toFixed(2)} tonnes`
                  : 'Trip has been verified and closed at offloading.',
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelName, onTripChange, addToast]);

  return {
    toasts,
    dismissToast,
    addToast,
  };
}
