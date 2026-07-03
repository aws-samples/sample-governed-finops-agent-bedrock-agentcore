import * as cdk from 'aws-cdk-lib';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface RemediatorRuntimeStackProps extends cdk.StackProps {
  policyStoreId?: string;
  remediatorRepository: ecr.IRepository;
  approvalApiUrl?: string;
}

export class RemediatorRuntimeStack extends cdk.Stack {
  public readonly remediatorRuntimeArn: string;
  public readonly remediatorRuntimeRoleArn: string;
  public readonly remediatorRepository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: RemediatorRuntimeStackProps) {
    super(scope, id, props);

    const foundationModel = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
    const lambdaPrefix = 'costopt-remediation';
    const repository = props.remediatorRepository;

    // Repository provided by ImageStack (image already built)
    this.remediatorRepository = repository;

    // ========================================
    // Lambda Functions - Remediation Tools
    // ========================================

    // --- resize_instance ---
    const resizeRole = new iam.Role(this, 'ResizeInstanceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    resizeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:StopInstances', 'ec2:StartInstances', 'ec2:ModifyInstanceAttribute', 'ec2:DescribeInstances'],
      resources: ['*'],
    }));

    const resizeFn = new lambda.Function(this, 'ResizeInstanceFn', {
      functionName: `${lambdaPrefix}-resize-instance`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'resize_instance.handler',
      code: lambda.Code.fromAsset('../lambda/remediation'),
      role: resizeRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 128,
    });

    // --- stop_instance ---
    const stopRole = new iam.Role(this, 'StopInstanceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    stopRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:StopInstances', 'ec2:DescribeInstances'],
      resources: ['*'],
    }));

    const stopFn = new lambda.Function(this, 'StopInstanceFn', {
      functionName: `${lambdaPrefix}-stop-instance`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'stop_instance.handler',
      code: lambda.Code.fromAsset('../lambda/remediation'),
      role: stopRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 128,
    });

    // --- terminate_instance ---
    const terminateRole = new iam.Role(this, 'TerminateInstanceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    terminateRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:TerminateInstances', 'ec2:DescribeInstances'],
      resources: ['*'],
    }));

    const terminateFn = new lambda.Function(this, 'TerminateInstanceFn', {
      functionName: `${lambdaPrefix}-terminate-instance`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'terminate_instance.handler',
      code: lambda.Code.fromAsset('../lambda/remediation'),
      role: terminateRole,
      timeout: cdk.Duration.minutes(2),
      memorySize: 128,
    });

    // --- modify_storage ---
    const storageRole = new iam.Role(this, 'ModifyStorageRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    storageRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:ModifyVolume', 'ec2:DescribeVolumes'],
      resources: ['*'],
    }));

    const storageFn = new lambda.Function(this, 'ModifyStorageFn', {
      functionName: `${lambdaPrefix}-modify-storage`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'modify_storage.handler',
      code: lambda.Code.fromAsset('../lambda/remediation'),
      role: storageRole,
      timeout: cdk.Duration.minutes(2),
      memorySize: 128,
    });

    // --- add_tag ---
    const tagRole = new iam.Role(this, 'AddTagRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    tagRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:CreateTags', 'ec2:DescribeTags', 'rds:AddTagsToResource'],
      resources: ['*'],
    }));

    const tagFn = new lambda.Function(this, 'AddTagFn', {
      functionName: `${lambdaPrefix}-add-tag`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'add_tag.handler',
      code: lambda.Code.fromAsset('../lambda/remediation'),
      role: tagRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
    });

    // --- delete_snapshot ---
    const deleteSnapshotRole = new iam.Role(this, 'DeleteSnapshotRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    deleteSnapshotRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:DeleteSnapshot', 'ec2:DescribeSnapshots'],
      resources: ['*'],
    }));

    const deleteSnapshotFn = new lambda.Function(this, 'DeleteSnapshotFn', {
      functionName: `${lambdaPrefix}-delete-snapshot`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'delete_snapshot.handler',
      code: lambda.Code.fromAsset('../lambda/remediation'),
      role: deleteSnapshotRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
    });

    // --- delete_ebs_volume ---
    const deleteVolumeRole = new iam.Role(this, 'DeleteEbsVolumeRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    deleteVolumeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:DeleteVolume', 'ec2:DescribeVolumes'],
      resources: ['*'],
    }));

    const deleteVolumeFn = new lambda.Function(this, 'DeleteEbsVolumeFn', {
      functionName: `${lambdaPrefix}-delete-ebs-volume`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'delete_ebs_volume.handler',
      code: lambda.Code.fromAsset('../lambda/remediation'),
      role: deleteVolumeRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
    });

    // ========================================
    // Remediator Runtime IAM Role
    // Only lambda:InvokeFunction - NOT direct AWS API access
    // ========================================
    const runtimeRole = new iam.Role(this, 'RemediatorRuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    // Lambda invocation on the 7 remediation functions only
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        resizeFn.functionArn,
        stopFn.functionArn,
        terminateFn.functionArn,
        storageFn.functionArn,
        tagFn.functionArn,
        deleteSnapshotFn.functionArn,
        deleteVolumeFn.functionArn,
      ],
    }));

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
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:ConverseStream', 'bedrock:Converse'],
      resources: [
        `arn:aws:bedrock:*::foundation-model/${foundationModel}`,
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/${foundationModel}`,
      ],
    }));

    // EC2 DescribeTags for resource context checker
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ec2:DescribeTags', 'ec2:DescribeInstances'],
      resources: ['*'],
    }));

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

    // DynamoDB for HITL approval requests
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/PendingApprovals*`],
    }));

    // DynamoDB for Remediation Audit Log
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/RemediationAuditLog*`],
    }));

    // DynamoDB read for Risk Mapping Table (policy engine risk classification)
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/CostOptRiskMappings`],
    }));

    // SNS for HITL notifications
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sns:Publish'],
      resources: [`arn:aws:sns:${this.region}:${this.account}:costopt-approval-notifications`],
    }));

    // ECR pull
    repository.grantPull(runtimeRole);

    // Export runtime role ARN for cross-stack references
    this.remediatorRuntimeRoleArn = runtimeRole.roleArn;

    // ========================================
    // Remediator Agent Runtime
    // ========================================
    const runtime = new agentcore.Runtime(this, 'RemediatorRuntime', {
      runtimeName: 'costopt_remediator',
      description: 'Cost Optimizer Remediator Agent - executes remediation via Lambda tools',
      executionRole: runtimeRole,
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromEcrRepository(
        repository, 'latest',
      ),
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        MODEL_ID: foundationModel,
        AWS_REGION: this.region,
        POLICY_STORE_ID: props?.policyStoreId || '',
        LAMBDA_PREFIX: lambdaPrefix,
        APPROVAL_TABLE_NAME: 'PendingApprovals',
        SNS_TOPIC_ARN: `arn:aws:sns:${this.region}:${this.account}:costopt-approval-notifications`,
        APPROVAL_API_URL: props?.approvalApiUrl || '',
        RISK_MAPPING_TABLE_NAME: 'CostOptRiskMappings',
        RISK_CACHE_TTL_SECONDS: '300',
        RISK_CLASSIFICATION_FALLBACK: JSON.stringify({
          resize_instance: 'low',
          modify_storage: 'low',
          add_tag: 'low',
          stop_instance: 'medium',
          delete_snapshot: 'medium',
          terminate_instance: 'high',
          delete_ebs_volume: 'high',
        }),
        AGENT_OBSERVABILITY_ENABLED: 'true',
        OTEL_PYTHON_DISTRO: 'aws_distro',
        OTEL_PYTHON_CONFIGURATOR: 'aws_configurator',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        OTEL_RESOURCE_ATTRIBUTES: 'service.name=costopt-remediator',
        DEPLOY_VERSION: '2026-06-30T14:30',
      },
    });

    this.remediatorRuntimeArn = runtime.agentRuntimeArn;

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'RemediatorRuntimeArn', { value: this.remediatorRuntimeArn });
    new cdk.CfnOutput(this, 'RemediatorRepoUri', { value: repository.repositoryUri });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions(runtimeRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ECR auth, CloudWatch, Bedrock model, and EC2 describe (read-only).' },
    ], true);
    NagSuppressions.addResourceSuppressions([resizeRole, stopRole, terminateRole, storageRole, tagRole, deleteSnapshotRole, deleteVolumeRole], [
      { id: 'AwsSolutions-IAM5', reason: 'EC2/RDS actions require wildcard resources for dynamic instance/volume IDs.' },
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS managed policy for CloudWatch Logs.' },
    ], true);
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions for remediation Lambda roles and AgentCore runtime.' },
      { id: 'AwsSolutions-IAM4', reason: 'AWS managed policies used for Lambda basic execution.' },
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest available runtime.' },
    ]);
  }
}
