/**
 * AuditLog - Table showing remediation action history.
 * Stores entries in React state (will connect to backend later).
 * Filterable by result: executed, denied, pending.
 */

import { useState } from 'react';
import type { AuditEntry } from '../../types';
import './governance.css';

type FilterValue = 'all' | 'executed' | 'denied' | 'pending';

interface AuditLogProps {
  entries: AuditEntry[];
}

export function AuditLog({ entries }: AuditLogProps) {
  const [filter, setFilter] = useState<FilterValue>('all');

  const filteredEntries = filter === 'all'
    ? entries
    : entries.filter(e => e.result === filter);

  const filters: { value: FilterValue; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'executed', label: 'Executed' },
    { value: 'denied', label: 'Denied' },
    { value: 'pending', label: 'Pending' },
  ];

  return (
    <div className="audit-log" aria-label="Remediation audit log">
      <div className="audit-log__filters">
        {filters.map(f => (
          <button
            key={f.value}
            className={`audit-log__filter-btn ${filter === f.value ? 'audit-log__filter-btn--active' : ''}`}
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <div className="audit-log__empty">No remediation actions recorded</div>
      ) : (
        <table className="audit-log__table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Environment</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.map(entry => (
              <tr key={entry.id}>
                <td>{new Date(entry.timestamp).toLocaleString()}</td>
                <td>{entry.user}</td>
                <td>{entry.role}</td>
                <td>{entry.action}</td>
                <td>{entry.resource}</td>
                <td>{entry.environment}</td>
                <td>
                  <span className={`audit-log__result audit-log__result--${entry.result}`}>
                    {entry.result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
