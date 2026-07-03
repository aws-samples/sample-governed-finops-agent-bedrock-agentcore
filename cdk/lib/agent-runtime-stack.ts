import * as cdk from 'aws-cdk-lib';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface AgentRuntimeStackProps extends cdk.StackProps {
  repository: ecr.IRepository;
  gatewayArn: string;
  // From AuthStack
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  // From RemediatorGatewayStack
  remediatorGatewayArn?: string;
}

export class AgentRuntimeStack extends cdk.Stack {
  public readonly mainRuntimeArn: string;
  public readonly memoryId: string;

  constructor(scope: Construct, id: string, props: AgentRuntimeStackProps) {
    super(scope, id, props);

    const foundationModel = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

    // ========================================
    // Auth values come from AuthStack (no inline Cognito)

    // ========================================
    // Memory
    // ========================================
    const memory = new agentcore.Memory(this, 'CostOptMemory', {
      memoryName: 'costopt_memory_v2',
      description: 'Memory for Cost Optimizer agent conversations (v2 - clean slate)',
      expirationDuration: cdk.Duration.days(30),
    });
    this.memoryId = memory.memoryId;

    // ========================================
    // Runtime IAM Role
    // ========================================
    const runtimeRole = new iam.Role(this, 'RuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    // ECR token
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));

    // CloudWatch Logs
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:DescribeLogGroups'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
    }));
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
    }));
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
    }));

    // Bedrock model invocation
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream',
        'bedrock:ConverseStream', 'bedrock:Converse',
      ],
      resources: [
        `arn:aws:bedrock:*::foundation-model/${foundationModel}`,
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/${foundationModel}`,
      ],
    }));

    // AgentCore Memory
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateEvent', 'bedrock-agentcore:GetLastKTurns',
        'bedrock-agentcore:GetMemory', 'bedrock-agentcore:ListEvents',
      ],
      resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/*`],
    }));

    // AgentCore Gateway invocation
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:InvokeGateway',
        'bedrock-agentcore:GetGateway',
        'bedrock-agentcore:ListGatewayTargets',
      ],
      resources: [props.gatewayArn, `${props.gatewayArn}/*`],
    }));

    // Remediator Gateway (tools/list only - for dynamic action discovery)
    if (props.remediatorGatewayArn) {
      runtimeRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:InvokeGateway',
          'bedrock-agentcore:GetGateway',
          'bedrock-agentcore:ListGatewayTargets',
        ],
        resources: [props.remediatorGatewayArn, `${props.remediatorGatewayArn}/*`],
      }));
    }

    // X-Ray and CloudWatch for OTEL observability
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
        'xray:GetSamplingRules',
        'xray:GetSamplingTargets',
      ],
      resources: ['*'],
    }));

    // EC2 DescribeInstances for real-time resource visibility
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ec2:DescribeInstances', 'ec2:DescribeTags'],
      resources: ['*'],
    }));

    // ECR pull
    props.repository.grantPull(runtimeRole);

    // ========================================
    // Agent Runtime
    // ========================================
    const runtime = new agentcore.Runtime(this, 'CostOptRuntime', {
      runtimeName: 'costopt_runtime',
      description: 'Cost Optimizer Agent Runtime with Gateway integration',
      executionRole: runtimeRole,
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromEcrRepository(
        props.repository, 'latest',
      ),
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        MEMORY_ID: memory.memoryId,
        MODEL_ID: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        AWS_REGION: this.region,
        AWS_ACCOUNT_ID: this.account,
        GATEWAY_ARN: props.gatewayArn,
        REMEDIATOR_GATEWAY_ARN: props.remediatorGatewayArn || '',
        PHASE: '2',
        AGENT_OBSERVABILITY_ENABLED: 'true',
        OTEL_PYTHON_DISTRO: 'aws_distro',
        OTEL_PYTHON_CONFIGURATOR: 'aws_configurator',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        OTEL_RESOURCE_ATTRIBUTES: 'service.name=costopt-recommender',
        DEPLOY_VERSION: '2026-06-30T15:50',
      },
    });

    this.mainRuntimeArn = runtime.agentRuntimeArn;

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'AgentCoreArn', { value: this.mainRuntimeArn });
    new cdk.CfnOutput(this, 'MemoryIdOutput', { value: this.memoryId });
    new cdk.CfnOutput(this, 'UserPoolId', { value: props.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: props.userPoolClientId });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: props.identityPoolId });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions(runtimeRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ECR auth, CloudWatch, Bedrock model, AgentCore memory and gateway.' },
    ], true);
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions for AgentCore agent runtime.' },
    ]);
  }
}
