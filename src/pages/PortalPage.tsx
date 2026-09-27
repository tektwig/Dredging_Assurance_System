import { PORTALS, type PortalRole } from '../routing/roleRoutes';

export function PortalPage({ role, title }: { role: PortalRole; title?: string }) {
  return <section className="card portal-card">
    <p className="eyebrow">Application foundation</p>
    <h1>{title ?? `${PORTALS[role].name} — Foundation Ready`}</h1>
    <p className="muted">This module is a Phase 1 placeholder. Its business functionality is not available yet.</p>
    <span className="status-badge">Account access verified</span>
  </section>;
}
