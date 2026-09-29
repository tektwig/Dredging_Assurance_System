import { NavLink } from 'react-router-dom';
import type { PortalNavigationItem } from '../routing/roleRoutes';

export function PortalNavigation({ basePath, label, items }: {
  basePath: string;
  label: string;
  items: readonly PortalNavigationItem[];
}) {
  return <nav className="portal-navigation" aria-label={`${label} navigation`}>
    <ul>
      {items.map(item => {
        const to = item.route ? `${basePath}/${item.route}` : basePath;
        return <li key={item.route || 'dashboard'}>
          <NavLink to={to} end={!item.route} className={({ isActive }) =>
            isActive ? 'portal-navigation-link active' : 'portal-navigation-link'}>
            {item.label}
          </NavLink>
        </li>;
      })}
    </ul>
  </nav>;
}
