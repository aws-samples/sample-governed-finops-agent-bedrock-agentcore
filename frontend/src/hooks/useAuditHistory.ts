/**
 * React hook to fetch execution history from RemediationAuditLog table.
 * Queries the API Gateway endpoint connected to query_handler Lambda.
 */
import { useState, useEffect } from 'react';
import type { ExecutionRecord } from '../components/analytics/ExecutionHistory';

interface AuditHistoryResponse {
  records: ExecutionRecord[];
  lastKey?: string;
}

interface UseAuditHistoryResult {
  records: ExecutionRecord[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Fetch and manage execution history.
 * 
 * @param userEmail - Optional user email filter. If undefined, returns all records.
 * @param apiUrl - The API Gateway endpoint URL (from ApprovalStack output)
 * @returns Execution records, loading state, and pagination controls
 */
export function useAuditHistory(
  userEmail: string | undefined,
  apiUrl: string | undefined,
): UseAuditHistoryResult {
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  async function fetchRecords(isLoadMore = false) {
    if (!apiUrl) {
      setError('Missing API URL configuration');
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({ limit: '50' });
      // Only filter by user if userEmail is provided
      if (userEmail) {
        params.append('user_email', userEmail);
      }
      if (isLoadMore && lastKey) {
        params.append('lastKey', lastKey);
      }

      const url = `${apiUrl}/audit?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data: AuditHistoryResponse = await response.json();

      if (isLoadMore) {
        setRecords(prev => [...prev, ...data.records]);
      } else {
        setRecords(data.records);
      }

      setLastKey(data.lastKey);
      setHasMore(!!data.lastKey);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch audit history:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  // Initial fetch when user email or API URL changes
  useEffect(() => {
    if (apiUrl) {
      setLoading(true);
      fetchRecords(false);
    }
  }, [userEmail, apiUrl]);

  function loadMore() {
    if (!loading && hasMore) {
      fetchRecords(true);
    }
  }

  return { records, loading, error, hasMore, loadMore };
}
