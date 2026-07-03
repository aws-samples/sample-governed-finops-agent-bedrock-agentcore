/**
 * RemediationTest - Simple UI for testing the Remediator Agent.
 * Allows selecting an action, resource, and role to test authorization flows.
 */

import { useState } from 'react';
import { useRemediator } from '../../hooks/useRemediator';
import { RemediationModal } from './RemediationModal';
import { AuthorizationFeedback } from './AuthorizationFeedback';
import { ApprovalStatus } from './ApprovalStatus';
import type { RiskLevel, AuthorizationDecision, ApprovalRequest } from '../../types';
import './governance.css';

const TEST_INSTANCE = 'i-04e2391b8b6c0e2a9';

const ACTIONS = [
  { value: 'add_tag', label: 'Add Tag', risk: 'low' as RiskLevel },
  { value: 'resize_instance', label: 'Resize Instance', risk: 'low' as RiskLevel },
  { value: 'stop_instance', label: 'Stop Instance', risk: 'medium' as RiskLevel },
  { value: 'terminate_instance', label: 'Terminate Instance', risk: 'high' as RiskLevel },
];

export function RemediationTest() {
  const { status, response, error, executeRemediation, reset } = useRemediator();
  const [selectedAction, setSelectedAction] = useState(ACTIONS[0]);
  const [showModal, setShowModal] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);

  function handleConfirm() {
    setShowModal(false);
    const params: Record<string, string> = {};
    if (selectedAction.value === 'add_tag') {
      params.tags = JSON.stringify([{ Key: 'RemediationTest', Value: new Date().toISOString() }]);
    } else if (selectedAction.value === 'resize_instance') {
      params.target_type = 't3.small';
    }
    executeRemediation(selectedAction.value, TEST_INSTANCE, params);
  }

  function handleDismissFeedback() {
    if (response?.decision === 'REQUIRES_APPROVAL') {
      setApprovals(prev => [...prev, {
        request_id: `req-${Date.now()}`,
        action_type: selectedAction.value,
        resource_id: TEST_INSTANCE,
        status: 'PENDING',
        created_at: new Date().toISOString(),
        risk_level: selectedAction.risk,
      }]);
    }
    reset();
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px' }}>
      <h3 style={{ margin: '0 0 20px', fontSize: '1rem' }}>Remediation Testing</h3>

      <div style={{
        background: 'var(--color-background-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 8, padding: 20, marginBottom: 20,
      }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', margin: '0 0 16px' }}>
          Test instance: <code style={{ color: 'var(--color-aws-orange)' }}>{TEST_INSTANCE}</code> (t3.micro, Environment=development)
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {ACTIONS.map(action => (
            <button
              key={action.value}
              onClick={() => setSelectedAction(action)}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: selectedAction.value === action.value
                  ? '2px solid var(--color-aws-orange)'
                  : '1px solid var(--color-border)',
                background: selectedAction.value === action.value
                  ? 'var(--color-background-tertiary)'
                  : 'transparent',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              {action.label}
              <span style={{
                marginLeft: 8, fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4,
                background: action.risk === 'low' ? '#1a4d1a' : action.risk === 'medium' ? '#4d4d1a' : '#4d1a1a',
                color: action.risk === 'low' ? '#90ee90' : action.risk === 'medium' ? '#ffd700' : '#ff6b6b',
              }}>
                {action.risk}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowModal(true)}
          disabled={status === 'loading'}
          style={{
            padding: '10px 24px',
            background: 'var(--color-aws-orange)',
            color: '#000',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
            opacity: status === 'loading' ? 0.5 : 1,
          }}
        >
          {status === 'loading' ? 'Processing...' : `Execute ${selectedAction.label}`}
        </button>
      </div>

      {response && (
        <AuthorizationFeedback
          decision={response.decision as AuthorizationDecision}
          reason={response.reason}
          onDismiss={handleDismissFeedback}
        />
      )}

      {error && (
        <div style={{
          padding: 14, borderRadius: 8, background: '#4d1a1a',
          border: '1px solid #7a2d2d', color: '#ff6b6b', fontSize: '0.85rem', marginBottom: 16,
        }}>
          Error: {error}
        </div>
      )}

      {showModal && (
        <RemediationModal
          actionType={selectedAction.label}
          resourceId={TEST_INSTANCE}
          riskLevel={selectedAction.risk}
          estimatedSavings={selectedAction.value === 'resize_instance' ? 25.50 : 0}
          loading={status === 'loading'}
          onConfirm={handleConfirm}
          onCancel={() => setShowModal(false)}
        />
      )}

      <ApprovalStatus approvals={approvals} />
    </div>
  );
}
