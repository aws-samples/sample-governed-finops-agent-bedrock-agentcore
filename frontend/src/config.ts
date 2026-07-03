import { Amplify } from 'aws-amplify';

/**
 * Configuration for the Cost Optimizer frontend.
 *
 * These values are populated from environment variables at build time.
 * Create a `.env` file in the frontend/ directory with your deployed values:
 *
 *   VITE_USER_POOL_ID=us-east-1_XXXXXXXXX
 *   VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
 *   VITE_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   VITE_AGENT_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:ACCOUNT:runtime/RUNTIME_ID
 *   VITE_REMEDIATOR_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:ACCOUNT:runtime/RUNTIME_ID
 *   VITE_REMEDIATOR_GATEWAY_URL=https://GATEWAY.gateway.bedrock-agentcore.REGION.amazonaws.com/mcp
 *   VITE_AWS_REGION=us-east-1
 */

export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID || 'us-east-1_PLACEHOLDER',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || 'PLACEHOLDER',
      identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID || 'us-east-1:00000000-0000-0000-0000-000000000000',
      loginWith: {
        email: true,
      },
    },
  },
};

export const agentCoreConfig = {
  runtimeArn: import.meta.env.VITE_AGENT_RUNTIME_ARN || 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/PLACEHOLDER',
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
};

export const remediatorConfig = {
  runtimeArn: import.meta.env.VITE_REMEDIATOR_RUNTIME_ARN || 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/PLACEHOLDER',
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  gatewayUrl: import.meta.env.VITE_REMEDIATOR_GATEWAY_URL || 'https://PLACEHOLDER.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp',
  fallbackActions: ['resize_instance', 'stop_instance', 'terminate_instance', 'modify_storage', 'add_tag', 'delete_snapshot', 'delete_ebs_volume'],
};

export const auditApiConfig = {
  apiUrl: import.meta.env.VITE_AUDIT_API_URL || 'https://PLACEHOLDER.execute-api.us-east-1.amazonaws.com',
};

export function configureAmplify(): void {
  Amplify.configure(amplifyConfig);
}
