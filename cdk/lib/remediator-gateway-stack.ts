import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface RemediatorGatewayStackProps extends cdk.StackProps {
  // JWT auth config (same Cognito as main gateway)
  frontendCognitoDiscoveryUrl: string;
  frontendUserPoolClientId: string;
  // Lambda ARNs for remediation tools
  resizeLambdaArn: string;
  stopLambdaArn: string;
  terminateLambdaArn: string;
  modifyStorageLambdaArn: string;
  addTagLambdaArn: string;
  deleteSnapshotLambdaArn: string;
  deleteEbsVolumeLambdaArn: string;
  // Risk Level Interceptor Lambda ARN (pre-Cedar enrichment)
  riskInterceptorLambdaArn?: string;
}

/**
 * RemediatorGatewayStack: Creates a dedicated Gateway for the Remediator Agent
 * with Lambda targets and Cedar Policy Engine for native authorization.
 *
 * Deploy order within stack:
 *   1. PolicyEngine (no dependencies)
 *   2. Gateway (references PolicyEngine ARN)
 *   3. Lambda Targets (depend on Gateway)
 *   4. Cedar Policies (depend on PolicyEngine + reference Gateway ARN)
 *
 * Cedar actions follow the naming convention:
 *   AgentCore::Action::"{targetName}___{toolName}"
 */
export class RemediatorGatewayStack extends cdk.Stack {
  public readonly gatewayArn: string;
  public readonly gatewayId: string;
  public readonly gatewayUrl: string;
  public readonly policyEngineId: string;
  public readonly policyEngineArn: string;

  constructor(scope: Construct, id: string, props: RemediatorGatewayStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. Policy Engine (created first, no dependencies)
    // ========================================
    const policyEngine = new cdk.CfnResource(this, 'PolicyEngine', {
      type: 'AWS::BedrockAgentCore::PolicyEngine',
      properties: {
        Name: 'costopt_policy_engine',
        Description: 'Cedar policy engine for Cost Optimizer - 3 level risk classification',
      },
    });

    this.policyEngineId = policyEngine.getAtt('PolicyEngineId').toString();
    this.policyEngineArn = policyEngine.getAtt('PolicyEngineArn').toString();

    // ========================================
    // 2. Gateway Service Role
    // ========================================
    const gatewayRole = new iam.Role(this, 'RemediatorGatewayRole', {
      description: 'Service role for Remediator AgentCore Gateway',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      inlinePolicies: {
        'GatewayPermissions': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [
                props.resizeLambdaArn,
                props.stopLambdaArn,
                props.terminateLambdaArn,
                props.modifyStorageLambdaArn,
                props.addTagLambdaArn,
                props.deleteSnapshotLambdaArn,
                props.deleteEbsVolumeLambdaArn,
                ...(props.riskInterceptorLambdaArn ? [props.riskInterceptorLambdaArn] : []),
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['bedrock-agentcore:*'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // ========================================
    // 3. Remediator Gateway (with PolicyEngine association)
    // ========================================
    const gateway = new cdk.CfnResource(this, 'RemediatorGateway', {
      type: 'AWS::BedrockAgentCore::Gateway',
      properties: {
        Name: 'costopt-remediator-gw',
        Description: 'Remediator Gateway - Lambda targets governed by Cedar policies',
        ProtocolType: 'MCP',
        AuthorizerType: 'CUSTOM_JWT',
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            DiscoveryUrl: props.frontendCognitoDiscoveryUrl,
            AllowedClients: [props.frontendUserPoolClientId],
          },
        },
        ProtocolConfiguration: {
          Mcp: {
            Instructions: 'Remediation gateway with Lambda tools governed by Cedar policies',
            SearchType: 'SEMANTIC',
            SupportedVersions: ['2025-03-26'],
          },
        },
        PolicyEngineConfiguration: {
          Arn: this.policyEngineArn,
          Mode: 'ENFORCE',
        },
        RoleArn: gatewayRole.roleArn,
      },
    });
    gateway.addDependency(policyEngine);

    this.gatewayArn = gateway.getAtt('GatewayArn').toString();
    this.gatewayId = gateway.getAtt('GatewayIdentifier').toString();
    this.gatewayUrl = gateway.getAtt('GatewayUrl').toString();

    // ========================================
    // 4. Lambda Targets (one per remediation action)
    // ========================================
    const targets = [
      {
        id: 'ResizeTarget',
        name: 'resize',
        lambdaArn: props.resizeLambdaArn,
        description: 'Resize EC2 instance to a different type (low risk)',
        toolName: 'resize_instance',
        toolDescription: 'Resize an EC2 instance. Stops it, changes type, restarts.',
        inputSchema: {
          Type: 'object',
          Properties: {
            resource_id: { Type: 'string', Description: 'EC2 instance ID' },
            target_type: { Type: 'string', Description: 'Target instance type (e.g., t3.small)' },
          },
          Required: ['resource_id', 'target_type'],
        },
      },
      {
        id: 'StopTarget',
        name: 'stop',
        lambdaArn: props.stopLambdaArn,
        description: 'Stop a running EC2 instance (medium risk)',
        toolName: 'stop_instance',
        toolDescription: 'Stop a running EC2 instance.',
        inputSchema: {
          Type: 'object',
          Properties: {
            resource_id: { Type: 'string', Description: 'EC2 instance ID to stop' },
          },
          Required: ['resource_id'],
        },
      },
      {
        id: 'TerminateTarget',
        name: 'terminate',
        lambdaArn: props.terminateLambdaArn,
        description: 'Terminate an EC2 instance permanently (high risk)',
        toolName: 'terminate_instance',
        toolDescription: 'Terminate an EC2 instance permanently. Requires HITL approval.',
        inputSchema: {
          Type: 'object',
          Properties: {
            resource_id: { Type: 'string', Description: 'EC2 instance ID to terminate' },
          },
          Required: ['resource_id'],
        },
      },
      {
        id: 'ModifyStorageTarget',
        name: 'storage',
        lambdaArn: props.modifyStorageLambdaArn,
        description: 'Modify EBS volume type or size (low risk)',
        toolName: 'modify_storage',
        toolDescription: 'Modify an EBS volume type or size.',
        inputSchema: {
          Type: 'object',
          Properties: {
            resource_id: { Type: 'string', Description: 'EBS volume ID' },
            target_type: { Type: 'string', Description: 'Target volume type (e.g., gp3)' },
            target_size: { Type: 'integer', Description: 'Target size in GiB' },
          },
          Required: ['resource_id'],
        },
      },
      {
        id: 'AddTagTarget',
        name: 'tag',
        lambdaArn: props.addTagLambdaArn,
        description: 'Add a cost optimization tag to a resource (low risk)',
        toolName: 'add_tag',
        toolDescription: 'Add a tag to an AWS resource for cost tracking.',
        inputSchema: {
          Type: 'object',
          Properties: {
            resource_id: { Type: 'string', Description: 'AWS resource ID' },
            tag_key: { Type: 'string', Description: 'Tag key' },
            tag_value: { Type: 'string', Description: 'Tag value' },
          },
          Required: ['resource_id', 'tag_key', 'tag_value'],
        },
      },
      {
        id: 'DeleteSnapshotTarget',
        name: 'snapshot',
        lambdaArn: props.deleteSnapshotLambdaArn,
        description: 'Delete an EBS snapshot (medium risk)',
        toolName: 'delete_snapshot',
        toolDescription: 'Delete an orphaned or unnecessary EBS snapshot to reduce storage costs.',
        inputSchema: {
          Type: 'object',
          Properties: {
            resource_id: { Type: 'string', Description: 'EBS snapshot ID (snap-xxx)' },
          },
          Required: ['resource_id'],
        },
      },
      {
        id: 'DeleteEbsVolumeTarget',
        name: 'volume',
        lambdaArn: props.deleteEbsVolumeLambdaArn,
        description: 'Delete an unattached EBS volume (high risk)',
        toolName: 'delete_ebs_volume',
        toolDescription: 'Delete an unattached EBS volume. Only works on volumes in available state.',
        inputSchema: {
          Type: 'object',
          Properties: {
            resource_id: { Type: 'string', Description: 'EBS volume ID (vol-xxx)' },
          },
          Required: ['resource_id'],
        },
      },
    ];

    for (const target of targets) {
      const cfnTarget = new cdk.CfnResource(this, target.id, {
        type: 'AWS::BedrockAgentCore::GatewayTarget',
        properties: {
          GatewayIdentifier: this.gatewayId,
          Name: target.name,
          Description: target.description,
          TargetConfiguration: {
            Mcp: {
              Lambda: {
                LambdaArn: target.lambdaArn,
                ToolSchema: {
                  InlinePayload: [
                    {
                      Name: target.toolName,
                      Description: target.toolDescription,
                      InputSchema: target.inputSchema,
                    },
                  ],
                },
              },
            },
          },
          CredentialProviderConfigurations: [{
            CredentialProviderType: 'GATEWAY_IAM_ROLE',
          }],
        },
      });
      cfnTarget.node.addDependency(gateway);
    }

    // ========================================
    // 5. Cedar Policies (RBAC based on JWT cognito:groups claim)
    //
    // Groups: CostOpt-Analyst (read-only), CostOpt-Engineer, CostOpt-Manager
    // Tags from JWT: principal.getTag("cognito:groups") contains group name
    //
    // NOTE: context.input.riskLevel policies will be added after the
    // interceptor is wired via AWS CLI (update-gateway API).
    // ========================================

    // Policy: Allow low-risk actions for Engineer and Manager
    const permitLowRisk = new cdk.CfnResource(this, 'PermitLowRisk', {
      type: 'AWS::BedrockAgentCore::Policy',
      properties: {
        PolicyEngineId: this.policyEngineId,
        Name: 'permit_low_risk',
        Description: 'Allow low-risk actions for Engineer and Manager roles',
        Definition: {
          Cedar: {
            Statement: `permit(\n  principal is AgentCore::OAuthUser,\n  action in [\n    AgentCore::Action::"resize___resize_instance",\n    AgentCore::Action::"storage___modify_storage",\n    AgentCore::Action::"tag___add_tag"\n  ],\n  resource == AgentCore::Gateway::"${this.gatewayArn}"\n)\nwhen {\n  principal.hasTag("cognito:groups") &&\n  (principal.getTag("cognito:groups") like "*Engineer*" ||\n   principal.getTag("cognito:groups") like "*Manager*")\n};`,
          },
        },
        ValidationMode: 'IGNORE_ALL_FINDINGS',
      },
    });
    permitLowRisk.addDependency(policyEngine);
    permitLowRisk.node.addDependency(gateway);

    // Policy: Allow medium-risk actions for Engineer and Manager
    const permitMediumRisk = new cdk.CfnResource(this, 'PermitMediumRisk', {
      type: 'AWS::BedrockAgentCore::Policy',
      properties: {
        PolicyEngineId: this.policyEngineId,
        Name: 'permit_medium_risk',
        Description: 'Allow medium-risk actions (stop, delete snapshot) for Engineer and Manager roles',
        Definition: {
          Cedar: {
            Statement: `permit(\n  principal is AgentCore::OAuthUser,\n  action in [\n    AgentCore::Action::"stop___stop_instance",\n    AgentCore::Action::"snapshot___delete_snapshot"\n  ],\n  resource == AgentCore::Gateway::"${this.gatewayArn}"\n)\nwhen {\n  principal.hasTag("cognito:groups") &&\n  (principal.getTag("cognito:groups") like "*Engineer*" ||\n   principal.getTag("cognito:groups") like "*Manager*")\n};`,
          },
        },
        ValidationMode: 'IGNORE_ALL_FINDINGS',
      },
    });
    permitMediumRisk.addDependency(policyEngine);
    permitMediumRisk.node.addDependency(gateway);

    // Policy: Allow high-risk actions ONLY for Manager
    const permitHighRisk = new cdk.CfnResource(this, 'PermitHighRisk', {
      type: 'AWS::BedrockAgentCore::Policy',
      properties: {
        PolicyEngineId: this.policyEngineId,
        Name: 'permit_high_risk',
        Description: 'Allow high-risk actions (terminate, delete volume) only for Manager role',
        Definition: {
          Cedar: {
            Statement: `permit(\n  principal is AgentCore::OAuthUser,\n  action in [\n    AgentCore::Action::"terminate___terminate_instance",\n    AgentCore::Action::"volume___delete_ebs_volume"\n  ],\n  resource == AgentCore::Gateway::"${this.gatewayArn}"\n)\nwhen {\n  principal.hasTag("cognito:groups") &&\n  principal.getTag("cognito:groups") like "*Manager*"\n};`,
          },
        },
        ValidationMode: 'IGNORE_ALL_FINDINGS',
      },
    });
    permitHighRisk.addDependency(policyEngine);
    permitHighRisk.node.addDependency(gateway);

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'RemediatorGatewayArn', {
      value: this.gatewayArn,
      description: 'Remediator Gateway ARN',
    });
    new cdk.CfnOutput(this, 'RemediatorGatewayUrl', {
      value: this.gatewayUrl,
      description: 'Remediator Gateway URL',
    });
    new cdk.CfnOutput(this, 'RemediatorGatewayId', {
      value: this.gatewayId,
      description: 'Remediator Gateway ID',
    });
    new cdk.CfnOutput(this, 'PolicyEngineId', {
      value: this.policyEngineId,
      description: 'AgentCore Policy Engine ID',
    });
    new cdk.CfnOutput(this, 'PolicyEngineArn', {
      value: this.policyEngineArn,
      description: 'AgentCore Policy Engine ARN',
    });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions(gatewayRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Lambda invoke scoped to specific function ARNs only.' },
    ], true);
  }
}
