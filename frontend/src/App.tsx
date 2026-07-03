import { useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { configureAmplify, agentCoreConfig, remediatorConfig, auditApiConfig } from './config';
import { ChatView } from './components/chat/ChatView';
import type { RemediationOptionData } from './components/chat/RemediationOption';
import { RecommendationList } from './components/dashboard/RecommendationList';
import { ExecutionHistory } from './components/analytics/ExecutionHistory';
import { useAuth } from './hooks/useAuth';
import { useAgentCore } from './hooks/useAgentCore';
import { useAuditHistory } from './hooks/useAuditHistory';
import { useRecommendations } from './hooks/useRecommendations';
import { invokeRemediator } from './api/remediator';
import type { RecommendationData } from './components/dashboard/RecommendationCard';
import type { RemediationStatus } from './types';
import './components/dashboard/dashboard.css';
import './components/analytics/analytics.css';

configureAmplify();

function AppContent() {
  const { userId, email, handleSignOut } = useAuth();
  const effectiveUserId = userId || email || 'anonymous';
  const { messages, loading, sendMessage } = useAgentCore(agentCoreConfig, effectiveUserId);
  // Pass undefined as userEmail to fetch ALL records regardless of user
  const { records: auditRecords, loading: auditLoading, error: auditError } = useAuditHistory(undefined, auditApiConfig.apiUrl);
  const {
    recommendations,
    loading: recLoading,
    error: recError,
    lastScanAt,
    scan: scanRecommendations,
  } = useRecommendations(agentCoreConfig, effectiveUserId);
  const [activeTab, setActiveTab] = useState<'chat' | 'recommendations' | 'history'>('chat');
  const [recStatuses, setRecStatuses] = useState<Record<string, RemediationStatus>>({});

  async function handleExecuteRemediation(option: RemediationOptionData): Promise<RemediationStatus> {
    try {
      const session = await import('@aws-amplify/auth').then(m => m.fetchAuthSession());
      const jwtToken = session.tokens?.idToken?.toString() ?? '';

      const response = await invokeRemediator({
        runtimeArn: remediatorConfig.runtimeArn,
        region: remediatorConfig.region,
        action_type: option.action_type,
        resource_id: option.resource_id,
        parameters: option.parameters,
        risk_level: option.risk_level,
        jwt_token: jwtToken,
      });

      if (response.decision === 'ALLOW') return 'success';
      if (response.decision === 'REQUIRES_APPROVAL') return 'pending_approval';
      return 'denied';
    } catch {
      return 'error';
    }
  }

  async function handleExecuteRecommendation(rec: RecommendationData) {
    setRecStatuses(prev => ({ ...prev, [rec.id]: 'loading' }));
    try {
      const session = await import('@aws-amplify/auth').then(m => m.fetchAuthSession());
      const jwtToken = session.tokens?.idToken?.toString() ?? '';

      const response = await invokeRemediator({
        runtimeArn: remediatorConfig.runtimeArn,
        region: remediatorConfig.region,
        action_type: rec.actionType,
        resource_id: rec.resourceId,
        parameters: { ...rec.parameters, recommendation_id: rec.id },
        risk_level: rec.riskLevel || 'high',
        jwt_token: jwtToken,
      });

      if (response.decision === 'ALLOW') {
        // ALLOW means authorized, but the Lambda may still have failed
        const execOk = response.execution_result?.success !== false;
        setRecStatuses(prev => ({ ...prev, [rec.id]: execOk ? 'success' : 'error' }));
      } else if (response.decision === 'REQUIRES_APPROVAL') {
        setRecStatuses(prev => ({ ...prev, [rec.id]: 'pending_approval' }));
      } else {
        setRecStatuses(prev => ({ ...prev, [rec.id]: 'denied' }));
      }
    } catch {
      setRecStatuses(prev => ({ ...prev, [rec.id]: 'error' }));
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-primary)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px',
        background: 'linear-gradient(135deg, #232f3e 0%, #1a252f 100%)',
        borderBottom: '2px solid var(--color-aws-orange)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img
            src="https://a0.awsstatic.com/libra-css/images/logos/aws_smile-header-desktop-en-white_59x35.png"
            alt="AWS Logo" style={{ height: 28 }}
          />
          <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>Cost Optimizer</span>
        </div>
        <button onClick={handleSignOut} style={{
          background: 'transparent', border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)', padding: '6px 12px',
          borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
        }}>
          Sign Out
        </button>
      </header>

      <div className="dashboard-tabs" style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }}>
        <button
          className={`dashboard-tab ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        <button
          className={`dashboard-tab ${activeTab === 'recommendations' ? 'active' : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          Recommendations
        </button>
        <button
          className={`dashboard-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
      </div>

      {activeTab === 'chat' ? (
        <ChatView
          messages={messages}
          loading={loading}
          onSend={sendMessage}
          onExecuteRemediation={handleExecuteRemediation}
        />
      ) : activeTab === 'recommendations' ? (
        <div className="dashboard-container">
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 16, padding: '0 4px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={scanRecommendations}
                disabled={recLoading}
                style={{
                  background: recLoading ? 'var(--color-background-tertiary)' : 'var(--color-aws-orange)',
                  color: recLoading ? 'var(--color-text-secondary)' : '#000',
                  border: 'none', borderRadius: 6, padding: '8px 16px',
                  fontWeight: 600, cursor: recLoading ? 'not-allowed' : 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                {recLoading ? 'Scanning...' : 'Scan Account'}
              </button>
              {lastScanAt && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  Last scan: {new Date(lastScanAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
          {recError && recommendations.length === 0 && !recLoading && (
            <div style={{
              textAlign: 'center', padding: 40,
              color: 'var(--color-text-secondary)',
            }}>
              <p style={{ fontSize: '1rem', marginBottom: 8 }}>
                {recError === 'No optimization opportunities found in this scan.'
                  ? 'No optimization opportunities found.'
                  : `Error: ${recError}`}
              </p>
              <p style={{ fontSize: '0.85rem' }}>
                Click "Scan Account" to analyze your AWS resources for cost optimizations.
              </p>
            </div>
          )}
          {!recLoading && recommendations.length === 0 && !recError && (
            <div style={{
              textAlign: 'center', padding: 60,
              color: 'var(--color-text-secondary)',
            }}>
              <p style={{ fontSize: '1.1rem', marginBottom: 8 }}>No recommendations yet</p>
              <p style={{ fontSize: '0.85rem' }}>
                Click "Scan Account" to analyze your AWS resources and generate real-time cost optimization recommendations.
              </p>
            </div>
          )}
          {recommendations.length > 0 && (
            <RecommendationList
              recommendations={recommendations}
              onExecute={handleExecuteRecommendation}
              statuses={recStatuses}
            />
          )}
        </div>
      ) : (
        <div className="analytics-container">
          {auditLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <p>Loading execution history...</p>
            </div>
          ) : auditError ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#ff6b6b' }}>
              <p>Failed to load execution history: {auditError}</p>
            </div>
          ) : (
            <ExecutionHistory records={auditRecords} />
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Authenticator>
      <AppContent />
    </Authenticator>
  );
}
