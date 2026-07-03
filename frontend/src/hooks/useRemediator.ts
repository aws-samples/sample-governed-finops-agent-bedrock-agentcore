/**
 * Hook for interacting with the Remediator Agent Runtime.
 * Manages remediation state and authorization flow.
 */

import { useState, useCallback } from 'react';
import { fetchAuthSession } from '@aws-amplify/auth';
import { invokeRemediator } from '../api/remediator';
import { remediatorConfig } from '../config';
import type { RemediationStatus, RemediationResponse } from '../types';

interface UseRemediatorReturn {
  status: RemediationStatus;
  response: RemediationResponse | null;
  error: string | null;
  executeRemediation: (action_type: string, resource_id: string, parameters: Record<string, string>, risk_level?: string) => Promise<void>;
  reset: () => void;
}

export function useRemediator(): UseRemediatorReturn {
  const [status, setStatus] = useState<RemediationStatus>('idle');
  const [response, setResponse] = useState<RemediationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeRemediation = useCallback(async (
    action_type: string,
    resource_id: string,
    parameters: Record<string, string>,
    risk_level?: string,
  ) => {
    setStatus('loading');
    setError(null);
    setResponse(null);

    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString() ?? '';

      const result = await invokeRemediator({
        runtimeArn: remediatorConfig.runtimeArn,
        region: remediatorConfig.region,
        action_type,
        resource_id,
        parameters,
        risk_level: risk_level ?? 'high',
        jwt_token: idToken,
      });

      setResponse(result);

      switch (result.decision) {
        case 'ALLOW':
          setStatus('success');
          break;
        case 'DENY':
          setStatus('denied');
          break;
        case 'REQUIRES_APPROVAL':
          setStatus('pending_approval');
          break;
        default:
          setStatus('error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setResponse(null);
    setError(null);
  }, []);

  return { status, response, error, executeRemediation, reset };
}
