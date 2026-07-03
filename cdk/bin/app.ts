#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ImageStack } from '../lib/image-stack';
import { AuthStack } from '../lib/auth-stack';
import { MCPRuntimeStack } from '../lib/mcp-runtime-stack';
import { GatewayStack } from '../lib/gateway-stack';
import { AgentRuntimeStack } from '../lib/agent-runtime-stack';
import { RemediatorRuntimeStack } from '../lib/remediator-runtime-stack';
import { RemediatorGatewayStack } from '../lib/remediator-gateway-stack';
import { RiskInterceptorStack } from '../lib/risk-interceptor-stack';
import { ApprovalStack } from '../lib/approval-stack';
// import { LearningStack } from '../lib/learning-stack';

const app = new cdk.App();
// cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || app.node.tryGetContext('account') || '123456789012',
  region: process.env.CDK_DEFAULT_REGION || app.node.tryGetContext('region') || 'us-east-1',
};

// === PHASE 1+3: Auth first (no dependencies) ===
const authStack = new AuthStack(app, 'CostOptAuthStack', { env });

// === PHASE 1: Image build (no dependencies) ===
const imageStack = new ImageStack(app, 'CostOptImageStack', { env });

// === PHASE 1: MCP Runtimes (depends on Image + has its own M2M Cognito) ===
const mcpRuntimeStack = new MCPRuntimeStack(app, 'CostOptMCPRuntimeStack', {
  env,
  billingMcpRepository: imageStack.billingMcpRepository,
  pricingMcpRepository: imageStack.pricingMcpRepository,
});
mcpRuntimeStack.addDependency(imageStack);

// === PHASE 1+3: Gateway (depends on MCP + Auth for JWT validation) ===
const gatewayStack = new GatewayStack(app, 'CostOptGatewayStack', {
  env,
  billingMcpRuntimeArn: mcpRuntimeStack.billingMcpRuntimeArn,
  billingMcpRuntimeEndpoint: mcpRuntimeStack.billingMcpRuntimeEndpoint,
  pricingMcpRuntimeArn: mcpRuntimeStack.pricingMcpRuntimeArn,
  pricingMcpRuntimeEndpoint: mcpRuntimeStack.pricingMcpRuntimeEndpoint,
  userPoolId: mcpRuntimeStack.userPoolId,
  userPoolArn: mcpRuntimeStack.userPoolArn,
  m2mClientId: mcpRuntimeStack.m2mClientId,
  // Phase 3: JWT auth for inbound (user -> Gateway)
  frontendUserPoolId: authStack.userPoolId,
  frontendCognitoDiscoveryUrl: authStack.cognitoDiscoveryUrl,
  frontendUserPoolClientId: authStack.userPoolClientId,
});
gatewayStack.addDependency(mcpRuntimeStack);
gatewayStack.addDependency(authStack);

// === PHASE 3c: Approval Stack (HITL) - created before Remediator so its API URL can be injected ===
const approvalStack = new ApprovalStack(app, 'CostOptApprovalStack', {
  env,
  approverEmail: app.node.tryGetContext('approverEmail') || 'admin@example.com',
  lambdaPrefix: 'costopt-remediation',
});

// === PHASE 3b: Remediator Agent Runtime (Runtime 2) ===
const remediatorStack = new RemediatorRuntimeStack(app, 'CostOptRemediatorStack', {
  env,
  remediatorRepository: imageStack.remediatorRepository,
  // Real approval API URL from ApprovalStack (cross-stack reference, no placeholder)
  approvalApiUrl: approvalStack.apiUrl,
});
remediatorStack.addDependency(imageStack);
remediatorStack.addDependency(approvalStack);

// === PHASE 3b: Remediator Gateway + Policy Engine + Cedar Policies ===
const lambdaPrefix = 'costopt-remediation';
const remediatorGatewayStack = new RemediatorGatewayStack(app, 'CostOptRemediatorGatewayStack', {
  env,
  frontendCognitoDiscoveryUrl: authStack.cognitoDiscoveryUrl,
  frontendUserPoolClientId: authStack.userPoolClientId,
  resizeLambdaArn: `arn:aws:lambda:${env.region}:${env.account}:function:${lambdaPrefix}-resize-instance`,
  stopLambdaArn: `arn:aws:lambda:${env.region}:${env.account}:function:${lambdaPrefix}-stop-instance`,
  terminateLambdaArn: `arn:aws:lambda:${env.region}:${env.account}:function:${lambdaPrefix}-terminate-instance`,
  modifyStorageLambdaArn: `arn:aws:lambda:${env.region}:${env.account}:function:${lambdaPrefix}-modify-storage`,
  addTagLambdaArn: `arn:aws:lambda:${env.region}:${env.account}:function:${lambdaPrefix}-add-tag`,
  deleteSnapshotLambdaArn: `arn:aws:lambda:${env.region}:${env.account}:function:${lambdaPrefix}-delete-snapshot`,
  deleteEbsVolumeLambdaArn: `arn:aws:lambda:${env.region}:${env.account}:function:${lambdaPrefix}-delete-ebs-volume`,
  riskInterceptorLambdaArn: `arn:aws:lambda:${env.region}:${env.account}:function:costopt-risk-interceptor`,
});
remediatorGatewayStack.addDependency(remediatorStack);
remediatorGatewayStack.addDependency(authStack);

// === PHASE 3b: Risk Interceptor (DynamoDB table + Lambda for risk classification) ===
const riskInterceptorStack = new RiskInterceptorStack(app, 'CostOptRiskInterceptorStack', {
  env,
  remediatorGatewayArn: remediatorGatewayStack.gatewayArn,
  remediatorGatewayId: remediatorGatewayStack.gatewayId,
  remediatorRuntimeRoleArn: remediatorStack.remediatorRuntimeRoleArn,
});
riskInterceptorStack.addDependency(remediatorGatewayStack);
riskInterceptorStack.addDependency(remediatorStack);

// === PHASE 1: Agent Runtime (depends on Image + Gateway + Auth + RemediatorGateway for dynamic tools/list) ===
const agentRuntimeStack = new AgentRuntimeStack(app, 'CostOptAgentRuntimeStack', {
  env,
  repository: imageStack.repository,
  gatewayArn: gatewayStack.gatewayArn,
  // Auth values from AuthStack
  userPoolId: authStack.userPoolId,
  userPoolClientId: authStack.userPoolClientId,
  identityPoolId: authStack.identityPoolId,
  // Remediator Gateway ARN for dynamic action discovery
  remediatorGatewayArn: remediatorGatewayStack.gatewayArn,
});
agentRuntimeStack.addDependency(gatewayStack);
agentRuntimeStack.addDependency(authStack);
agentRuntimeStack.addDependency(remediatorGatewayStack);

// === PHASE 4: Adaptive Learning (DynamoDB for user preferences) ===
// const learningStack = new LearningStack(app, 'CostOptLearningStack', {
//   env,
//   agentRoleArn: agentRuntimeStack.runtimeRoleArn,
// });
// learningStack.addDependency(agentRuntimeStack);

// Tags
cdk.Tags.of(app).add('Project', 'AgentCoreCostOptimizer');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
