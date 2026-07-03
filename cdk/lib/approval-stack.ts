import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface ApprovalStackProps extends cdk.StackProps {
  approverEmail?: string;
  lambdaPrefix?: string;
}

export class ApprovalStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly tableName: string;
  public readonly topicArn: string;

  constructor(scope: Construct, id: string, props?: ApprovalStackProps) {
    super(scope, id, props);

    const approverEmail = props?.approverEmail || this.node.tryGetContext('approverEmail') || '';
    const lambdaPrefix = props?.lambdaPrefix || 'costopt-remediation';

    // ========================================
    // DynamoDB Table - PendingApprovals
    // ========================================
    const table = new dynamodb.Table(this, 'PendingApprovals', {
      tableName: 'PendingApprovals',
      partitionKey: { name: 'request_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expires_at',
      pointInTimeRecovery: true,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'approval-token-index',
      partitionKey: { name: 'approval_token', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // DynamoDB Table - RemediationAuditLog
    // Logs ALL remediation actions (ALLOW, DENY, REQUIRES_APPROVAL)
    // ========================================
    const auditTable = new dynamodb.Table(this, 'RemediationAuditLog', {
      tableName: 'RemediationAuditLog',
      partitionKey: { name: 'action_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    auditTable.addGlobalSecondaryIndex({
      indexName: 'user-timestamp-index',
      partitionKey: { name: 'user_email', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // SNS Topic - Approval Notifications
    // ========================================
    const topic = new sns.Topic(this, 'ApprovalNotifications', {
      topicName: 'costopt-approval-notifications',
      displayName: 'Cost Optimizer Approval Notifications',
    });

    if (approverEmail) {
      topic.addSubscription(new subscriptions.EmailSubscription(approverEmail));
    }

    // ========================================
    // Lambda - approval_handler
    // ========================================
    const handlerRole = new iam.Role(this, 'ApprovalHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    table.grantReadWriteData(handlerRole);
    auditTable.grantReadWriteData(handlerRole);
    topic.grantPublish(handlerRole);
    handlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${lambdaPrefix}-*`],
    }));

    const handlerFn = new lambda.Function(this, 'ApprovalHandlerFn', {
      functionName: 'costopt-approval-handler',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'approval_handler.handler',
      code: lambda.Code.fromAsset('../lambda/approval'),
      role: handlerRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        TABLE_NAME: table.tableName,
        AUDIT_TABLE_NAME: auditTable.tableName,
        SNS_TOPIC_ARN: topic.topicArn,
        LAMBDA_PREFIX: lambdaPrefix,
      },
    });

    // ========================================
    // Lambda - approval_timeout
    // ========================================
    const timeoutRole = new iam.Role(this, 'ApprovalTimeoutRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    table.grantReadWriteData(timeoutRole);
    auditTable.grantReadWriteData(timeoutRole);
    topic.grantPublish(timeoutRole);

    const timeoutFn = new lambda.Function(this, 'ApprovalTimeoutFn', {
      functionName: 'costopt-approval-timeout',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'approval_timeout.handler',
      code: lambda.Code.fromAsset('../lambda/approval'),
      role: timeoutRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        TABLE_NAME: table.tableName,
        AUDIT_TABLE_NAME: auditTable.tableName,
        SNS_TOPIC_ARN: topic.topicArn,
      },
    });

    // EventBridge rule - check for expired approvals every hour
    new events.Rule(this, 'ApprovalTimeoutRule', {
      ruleName: 'costopt-approval-timeout',
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(timeoutFn)],
    });

    // ========================================
    // Lambda - audit_query
    // ========================================
    const auditQueryRole = new iam.Role(this, 'AuditQueryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    auditTable.grantReadData(auditQueryRole);

    const auditQueryFn = new lambda.Function(this, 'AuditQueryFn', {
      functionName: 'costopt-audit-query',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'query_handler.handler',
      code: lambda.Code.fromAsset('../lambda/audit'),
      role: auditQueryRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        AUDIT_TABLE_NAME: auditTable.tableName,
      },
    });

    // ========================================
    // API Gateway HTTP API
    // ========================================
    const httpApi = new apigatewayv2.HttpApi(this, 'ApprovalApi', {
      apiName: 'costopt-approval-api',
      description: 'API for HITL approval signed URLs and audit queries',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET],
        allowHeaders: ['*'],
      },
    });

    const handlerIntegration = new integrations.HttpLambdaIntegration(
      'ApprovalHandlerIntegration', handlerFn,
    );

    httpApi.addRoutes({
      path: '/approve',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: handlerIntegration,
    });

    httpApi.addRoutes({
      path: '/reject',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: handlerIntegration,
    });

    const auditQueryIntegration = new integrations.HttpLambdaIntegration(
      'AuditQueryIntegration', auditQueryFn,
    );

    httpApi.addRoutes({
      path: '/audit',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: auditQueryIntegration,
    });

    // ========================================
    // Exports
    // ========================================
    this.apiUrl = httpApi.apiEndpoint;
    this.tableName = table.tableName;
    this.topicArn = topic.topicArn;

    new cdk.CfnOutput(this, 'ApprovalApiUrl', { value: this.apiUrl });
    new cdk.CfnOutput(this, 'ApprovalTableName', { value: this.tableName });
    new cdk.CfnOutput(this, 'ApprovalTopicArn', { value: this.topicArn });
    new cdk.CfnOutput(this, 'AuditLogTableName', { value: auditTable.tableName });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions([handlerRole, timeoutRole, auditQueryRole], [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS managed policy for CloudWatch Logs.' },
      { id: 'AwsSolutions-IAM5', reason: 'Lambda invoke requires wildcard for dynamic remediation function names.' },
    ], true);
    NagSuppressions.addResourceSuppressions(httpApi, [
      { id: 'AwsSolutions-APIG1', reason: 'Access logging not required for approval signed URLs endpoint.' },
      { id: 'AwsSolutions-APIG4', reason: 'No auth required - signed URLs contain unique tokens for validation.' },
    ], true);
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', reason: 'AWS managed policies used for Lambda basic execution.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions for Lambda invocation of remediation functions.' },
      { id: 'AwsSolutions-SNS2', reason: 'SNS encryption not required for non-sensitive approval notifications.' },
      { id: 'AwsSolutions-SNS3', reason: 'SSL enforcement handled at transport level.' },
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest available runtime.' },
    ]);
  }
}
