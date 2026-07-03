/**
 * Hook to fetch live recommendations from the AgentCore runtime.
 *
 * Sends a scan prompt to the recommender agent, parses the
 * REMEDIATION_OPTIONS JSON block from the response, and maps them
 * to RecommendationData for the dashboard.
 */

import { useState, useCallback } from 'react';
import { invokeAgent } from '../api/agentcore';
import type { AgentCoreConfig } from '../types';
import type { RecommendationData } from '../components/dashboard/RecommendationCard';
import type { RemediationOptionData } from '../components/chat/RemediationOption';

interface UseRecommendationsResult {
  recommendations: RecommendationData[];
  loading: boolean;
  error: string | null;
  lastScanAt: string | null;
  scan: () => void;
}

const SCAN_PROMPT = `Realiza un escaneo completo de la cuenta AWS. Identifica:
1. Instancias EC2 subutilizadas o detenidas (rightsizing, idle)
2. Volúmenes EBS no conectados
3. Snapshots huérfanos o expirados
4. Recursos sin tags obligatorios (Environment, CostCenter, Owner)
5. Recursos sin protección de eliminación habilitada

Para cada hallazgo, incluye una entrada en REMEDIATION_OPTIONS con el resource_id real, action_type, estimated_savings_monthly y risk_level.
No incluyas texto explicativo largo, solo el resumen breve y las REMEDIATION_OPTIONS.`;

/**
 * Derives category from action_type for dashboard filtering.
 */
function deriveCategory(actionType: string): string {
  switch (actionType) {
    case 'resize_instance':
    case 'modify_storage':
      return 'rightsizing';
    case 'stop_instance':
      return 'idle_resources';
    case 'terminate_instance':
    case 'delete_ebs_volume':
    case 'delete_snapshot':
      return 'cleanup';
    case 'add_tag':
      return 'best_practices';
    default:
      return 'other';
  }
}

/**
 * Derives resource type from resource_id prefix.
 */
function deriveResourceType(resourceId: string): string {
  if (resourceId.startsWith('i-')) return 'EC2';
  if (resourceId.startsWith('vol-')) return 'EBS';
  if (resourceId.startsWith('snap-')) return 'EBS Snapshot';
  if (resourceId.startsWith('arn:aws:rds')) return 'RDS';
  if (resourceId.startsWith('rds-') || resourceId.includes('rds')) return 'RDS';
  return 'AWS Resource';
}

/**
 * Parse REMEDIATION_OPTIONS JSON from agent response text.
 */
function parseRemediationOptions(responseText: string): RemediationOptionData[] {
  const regex = /<!--REMEDIATION_OPTIONS-->([\s\S]*?)<!--\/REMEDIATION_OPTIONS-->/;
  const match = responseText.match(regex);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    console.warn('Failed to parse REMEDIATION_OPTIONS from agent response');
    return [];
  }
}

/**
 * Convert RemediationOptionData (agent format) to RecommendationData (dashboard format).
 */
function toRecommendation(option: RemediationOptionData, index: number): RecommendationData {
  return {
    id: option.id || `rec-${index}`,
    resourceId: option.resource_id,
    resourceType: deriveResourceType(option.resource_id),
    category: deriveCategory(option.action_type),
    action: option.description,
    reason: option.description,
    estimatedSavings: option.estimated_savings_monthly,
    riskLevel: option.risk_level,
    priorityScore: computePriority(option),
    actionType: option.action_type,
    parameters: option.parameters || {},
  };
}

/**
 * Compute priority score (0-1) based on savings and risk.
 */
function computePriority(option: RemediationOptionData): number {
  const savingsScore = Math.min(option.estimated_savings_monthly / 200, 1);
  const riskMultiplier = option.risk_level === 'low' ? 1.0 : option.risk_level === 'medium' ? 0.8 : 0.6;
  return parseFloat((savingsScore * riskMultiplier).toFixed(2));
}

export function useRecommendations(
  config: AgentCoreConfig,
  userId: string,
): UseRecommendationsResult {
  const [recommendations, setRecommendations] = useState<RecommendationData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);

  // Stable session ID dedicated to recommendations scanning
  const sessionId = `costopt-recommendations-scan-${userId || 'anonymous'}`.padEnd(33, '-0');

  const scan = useCallback(async () => {
    if (!config.runtimeArn || loading) return;

    setLoading(true);
    setError(null);

    try {
      const response = await invokeAgent({
        runtimeArn: config.runtimeArn,
        region: config.region,
        prompt: SCAN_PROMPT,
        sessionId,
        userId,
      });

      const options = parseRemediationOptions(response);

      if (options.length === 0) {
        // Agent responded but no remediation options found
        setRecommendations([]);
        setError('No optimization opportunities found in this scan.');
      } else {
        const recs = options.map(toRecommendation);
        // Sort by priority (highest first)
        recs.sort((a, b) => b.priorityScore - a.priorityScore);
        setRecommendations(recs);
      }

      setLastScanAt(new Date().toISOString());
    } catch (err) {
      console.error('Recommendation scan failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to scan for recommendations');
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, [config, userId, sessionId, loading]);

  return { recommendations, loading, error, lastScanAt, scan };
}
