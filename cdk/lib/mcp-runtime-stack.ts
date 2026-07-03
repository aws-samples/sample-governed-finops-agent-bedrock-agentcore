import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface MCPRuntimeStackProps extends cdk.StackProps {
  billingMcpRepository: ecr.IRepository;
  pricingMcpRepository: ecr.IRepository;
}

export class MCPRuntimeStack extends cdk.Stack {
  public readonly billingMcpRuntimeArn: string;
  public readonly pricingMcpRuntimeArn: string;
  public readonly billingMcpRuntimeEndpoint: string;
  public readonly pricingMcpRuntimeEndpoint: string;
  // Cognito outputs for downstream stacks (Gateway needs these for OAuth)
  public readonly userPoolId: string;
  public readonly userPoolArn: string;
  public readonly m2mClientId: string;

  constructor(scope: Construct, id: string, props: MCPRuntimeStackProps) {
    super(scope, id, props);

    // ========================================
    // Inline Cognito for M2M JWT auth (no separate AuthStack)
    // ========================================
    const userPool = new cognito.UserPool(this, 'McpUserPool', {
      userPoolName: 'costopt-mcp-auth',
      selfSignUpEnabled: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
    });
    this.userPoolId = userPool.userPoolId;
    this.userPoolArn = userPool.userPoolArn;

    // Cognito domain for OAuth token endpoint
    userPool.addDomain('McpDomain', {
      cognitoDomain: { domainPrefix: `costopt-mcp-${this.account}` },
    });

    // Resource server for MCP runtime invoke scope
    const resourceServer = userPool.addResourceServer('McpResourceServer', {
      identifier: 'mcp-runtime-server',
      userPoolResourceServerName: 'costopt-mcp-resource-server',
      scopes: [{ scopeName: 'invoke', scopeDescription: 'Invoke MCP runtime tools' }],
    });

    // M2M client (client_credentials grant) for Gateway -> MCP auth
    const m2mClient = userPool.addClient('M2MClient', {
      userPoolClientName: 'costopt-m2m-client',
      generateSecret: true,
      authFlows: { userPassword: false, userSrp: false, custom: false },
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(resourceServer, { scopeName: 'invoke', scopeDescription: 'Invoke MCP runtime tools' })],
      },
    });
    this.m2mClientId = m2mClient.userPoolClientId;

    // ========================================
    // IAM Roles for MCP Runtimes
    // ========================================
    const billingRole = new iam.Role(this, 'BillingMcpRuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });
    this.addCommonPermissions(billingRole);
    props.billingMcpRepository.grantPull(billingRole);

    billingRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ce:*', 'budgets:*', 'compute-optimizer:*', 'savingsplans:*', 'freetier:*',
        'ec2:DescribeInstances', 'ec2:DescribeVolumes',
        'lambda:ListFunctions', 'lambda:GetFunction', 'lambda:ListProvisionedConcurrencyConfigs',
        'autoscaling:DescribeAutoScalingGroups',
        'rds:DescribeDBInstances', 'rds:DescribeDBClusters',
        'ecs:ListServices', 'ecs:ListClusters', 'ecs:DescribeServices',
        'cost-optimization-hub:*',
      ],
      resources: ['*'],
    }));

    const pricingRole = new iam.Role(this, 'PricingMcpRuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });
    this.addCommonPermissions(pricingRole);
    props.pricingMcpRepository.grantPull(pricingRole);

    pricingRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['pricing:*'],
      resources: ['*'],
    }));

    // ========================================
    // MCP Runtimes with JWT Authorization
    // ========================================
    const billingRuntime = new cdk.CfnResource(this, 'BillingMcpRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        AgentRuntimeName: 'costopt_billing_mcp_v1',
        Description: 'AWS Labs Billing MCP Server Runtime with JWT auth',
        RoleArn: billingRole.roleArn,
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            AllowedClients: [m2mClient.userPoolClientId],
            DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`,
          },
        },
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${props.billingMcpRepository.repositoryUri}:latest`,
          },
        },
        NetworkConfiguration: { NetworkMode: 'PUBLIC' },
        EnvironmentVariables: { AWS_REGION: this.region },
        ProtocolConfiguration: 'MCP',
        LifecycleConfiguration: {},
      },
    });
    billingRuntime.node.addDependency(billingRole);

    this.billingMcpRuntimeArn = billingRuntime.getAtt('AgentRuntimeArn').toString();
    this.billingMcpRuntimeEndpoint = this.buildRuntimeEndpoint(this.billingMcpRuntimeArn);

    const pricingRuntime = new cdk.CfnResource(this, 'PricingMcpRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        AgentRuntimeName: 'costopt_pricing_mcp_v1',
        Description: 'AWS Labs Pricing MCP Server Runtime with JWT auth',
        RoleArn: pricingRole.roleArn,
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            AllowedClients: [m2mClient.userPoolClientId],
            DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`,
          },
        },
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${props.pricingMcpRepository.repositoryUri}:latest`,
          },
        },
        NetworkConfiguration: { NetworkMode: 'PUBLIC' },
        EnvironmentVariables: { AWS_REGION: this.region },
        ProtocolConfiguration: 'MCP',
        LifecycleConfiguration: {},
      },
    });
    pricingRuntime.node.addDependency(pricingRole);

    this.pricingMcpRuntimeArn = pricingRuntime.getAtt('AgentRuntimeArn').toString();
    this.pricingMcpRuntimeEndpoint = this.buildRuntimeEndpoint(this.pricingMcpRuntimeArn);

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'BillingMcpRuntimeArnOutput', { value: this.billingMcpRuntimeArn });
    new cdk.CfnOutput(this, 'PricingMcpRuntimeArnOutput', { value: this.pricingMcpRuntimeArn });
    new cdk.CfnOutput(this, 'McpUserPoolId', { value: this.userPoolId });
    new cdk.CfnOutput(this, 'M2MClientId', { value: this.m2mClientId });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions(userPool, [
      { id: 'AwsSolutions-COG2', reason: 'MFA not needed for M2M-only user pool in capstone.' },
      { id: 'AwsSolutions-COG3', reason: 'Advanced security not required for capstone.' },
    ], true);
    NagSuppressions.addResourceSuppressions(billingRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard required for Cost Explorer, ECR auth, CloudWatch.' },
    ], true);
    NagSuppressions.addResourceSuppressions(pricingRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard required for Pricing API, ECR auth, CloudWatch.' },
    ], true);
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions for AgentCore MCP runtimes.' },
      { id: 'AwsSolutions-L1', reason: 'Lambda runtime managed by CDK for Cognito custom resource.' },
    ]);
  }

  private addCommonPermissions(role: iam.Role): void {
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:DescribeLogGroups'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
    }));
  }

  private buildRuntimeEndpoint(runtimeArn: string): string {
    const encodedArn = cdk.Fn.join('', [
      cdk.Fn.select(0, cdk.Fn.split(':', runtimeArn)), '%3A',
      cdk.Fn.select(1, cdk.Fn.split(':', runtimeArn)), '%3A',
      cdk.Fn.select(2, cdk.Fn.split(':', runtimeArn)), '%3A',
      cdk.Fn.select(3, cdk.Fn.split(':', runtimeArn)), '%3A',
      cdk.Fn.select(4, cdk.Fn.split(':', runtimeArn)), '%3A',
      cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', runtimeArn)))),
    ]);
    return `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;
  }
}
