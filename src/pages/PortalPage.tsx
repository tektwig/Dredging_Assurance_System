import { PORTALS, type PortalRole } from '../routing/roleRoutes';

export function PortalPage({ role }: { role: PortalRole }) {
  return <section className="card portal-card">
    <p className="eyebrow">Application foundation</p>
    <h1>{PORTALS[role].name} — Foundation Ready</h1>
    <p className="muted">You are signed in to your assigned portal. Operational tools will be available in a later phase.</p>
    <span className="status-badge">Account access verified</span>
  </section>;
}