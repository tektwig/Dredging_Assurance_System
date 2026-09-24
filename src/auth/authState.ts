import type { Session } from '@supabase/supabase-js';
import type { Profile } from '../types/profile';

export type AccountState =
  | { status: 'restoring' }
  | { status: 'unauthenticated' }
  | { status: 'session-error' }
  | { status: 'loading-profile'; session: Session }
  | { status: 'active'; session: Session; profile: Profile }
  | { status: 'inactive'; session: Session; profile: Profile }
  | { status: 'missing-profile'; session: Session }
  | { status: 'profile-error'; session: Session };

export const INVALID_CREDENTIALS = 'Invalid login credentials. Please check your login details and try again.';
export const DISABLED_ACCOUNT = 'Account Disabled. Your account has been disabled. Please contact your administrator.';