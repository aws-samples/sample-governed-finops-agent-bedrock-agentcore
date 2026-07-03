export interface Message {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
}

export interface AgentCoreConfig {
  runtimeArn: string;
  region: string;
}

export interface CognitoConfig {
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
}

// Governance types

export type UserRole = 'Analyst' | 'Engineer' | 'Manager';
export type RiskLevel = 'low' | 'medium' | 'high';
export type AuthorizationDecision = 'ALLOW' | 'DENY' | 'REQUIRES_APPROVAL';
export type RemediationStatus = 'idle' | 'loading' | 'success' | 'denied' | 'pending_approval' | 'error';

export interface RemediationRequest {
  action_type: string;
  resource_id: string;
  parameters: Record<string, string>;
  risk_level: string;
  jwt_token: string;
}

export interface RemediationResponse {
  authorized: boolean;
  decision: AuthorizationDecision;
  reason: string;
  execution_result?: {
    success?: boolean;
    error?: string;
    [key: string]: unknown;
  };
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  role: UserRole;
  action: string;
  resource: string;
  environment: string;
  result: 'executed' | 'denied' | 'pending';
}

// HITL Approval types

export type ApprovalStatusType = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'EXECUTED';

export interface ApprovalRequest {
  request_id: string;
  action_type: string;
  resource_id: string;
  status: ApprovalStatusType;
  created_at: string;
  risk_level: RiskLevel;
}
