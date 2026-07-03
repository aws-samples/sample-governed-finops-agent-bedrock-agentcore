/**
 * RoleBadge - Displays the user role extracted from JWT.
 * Color coded: Analyst=blue, Engineer=orange, Manager=green.
 */

import type { UserRole } from '../../types';
import './governance.css';

interface RoleBadgeProps {
  role: UserRole;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const className = `role-badge role-badge--${role.toLowerCase()}`;

  return (
    <span className={className} aria-label={`Role: ${role}`}>
      {role}
    </span>
  );
}
