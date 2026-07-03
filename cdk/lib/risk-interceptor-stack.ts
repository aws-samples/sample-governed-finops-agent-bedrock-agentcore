import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

/**
 * Default risk classification mappings (7 actions).
 * Used as RISK_CLASSIFICATION_FALLBACK env var for the Remediator runtime.
 */
const DEFAULT_RISK_MAPPINGS: Record<string, string> = {
  'resize___resize_instance': 'low',
  'storage___modify_storage': 'low',
  'tag___add_tag': 'low',
  'stop___stop_instance': 'medium',
  'snapshot___delete_snapshot': 'medium',
  'terminate___terminate_instance': 'high',
  'volume___delete_ebs_volume': 'high',
};

export interface RiskInterceptorStackProps extends cdk.StackProps {
  /** ARN of the Remediator Gateway to wire the interceptor */
  remediatorGatewayArn: string;
  /** ID of the Remediator Gateway */
  remediatorGatewayId: string;
  /** ARN of the Remediator Runtime role (to grant DynamoDB read access) */
  remediatorRuntimeRoleArn: string;
}

/**
 * RiskInterceptorStack: Provisions the Risk Mapping DynamoDB table and
 * the Risk Level Interceptor Lambda that enriches Cedar policy context
 * with dynamic risk classification before authorization evaluation.
 *
 * The interceptor queries DynamoDB for the action's risk level and injects
 * it into the Cedar context. On any failure, it defaults to "high" (fail-closed).
 */
export class RiskInterceptorStack extends cdk.Stack {
  public readonly riskMappingTableName: string;
  public readonly riskMappingTableArn: string;
  public readonly interceptorFunctionArn: string;

  constructor(scope: Construct, id: string, props: RiskInterceptorStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. DynamoDB Table: Risk Mapping Table
    // ========================================
    const riskMappingTable = new dynamodb.Table(this, 'RiskMappingTable', {
      tableName: 'CostOptRiskMappings',
      partitionKey: { name: 'action', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.riskMappingTableName = riskMappingTable.tableName;
    this.riskMappingTableArn = riskMappingTable.tableArn;

    // ========================================
    // 2. Lambda Function: Risk Level Interceptor
    // ========================================
    const interceptorRole = new iam.Role(this, 'RiskInterceptorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Read-only access to the Risk Mapping Table (GetItem only)
    interceptorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [riskMappingTable.tableArn],
    }));

    // CloudWatch PutMetricData for custom metrics
    interceptorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'cloudwatch:namespace': 'CostOptimizer/RiskInterceptor',
        },
      },
    }));

    const interceptorFn = new lambda.Function(this, 'RiskInterceptorFn', {
      functionName: 'costopt-risk-interceptor',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('../lambda/risk_interceptor'),
      role: interceptorRole,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        RISK_MAPPING_TABLE_NAME: riskMappingTable.tableName,
      },
      description: 'Risk Level Interceptor - enriches Cedar context with dynamic risk classification',
    });

    this.interceptorFunctionArn = interceptorFn.functionArn;

    // ========================================
    // 3. Grant Remediator Runtime read-only access to the table
    // ========================================
    const remediatorRuntimeRole = iam.Role.fromRoleArn(
      this, 'RemediatorRuntimeRole', props.remediatorRuntimeRoleArn,
    );

    riskMappingTable.grantReadData(remediatorRuntimeRole);

    // ========================================
    // 4. Wire Lambda as interceptor on the Remediator Gateway
    //
    // NOTE: AgentCore Gateway does not currently support native pre-Cedar
    // interceptor Lambda configuration via CloudFormation/CDK. The Lambda
    // is created and ready to be wired manually via the AgentCore console
    // or API as a pre-authorization hook. When AgentCore adds native
    // interceptor support, update this stack to use the CfnResource
    // configuration below.
    //
    // Future configuration (uncomment when supported):
    // const interceptorConfig = new cdk.CfnResource(this, 'InterceptorConfig', {
    //   type: 'AWS::BedrockAgentCore::GatewayInterceptor',
    //   properties: {
    //     GatewayIdentifier: props.remediatorGatewayId,
    //     InterceptorType: 'PRE_AUTHORIZATION',
    //     LambdaArn: interceptorFn.functionArn,
    //   },
    // });
    // ========================================

    // ========================================
    // 5. Outputs
    // ========================================
    new cdk.CfnOutput(this, 'RiskMappingTableName', {
      value: riskMappingTable.tableName,
      description: 'Risk Mapping DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'RiskMappingTableArn', {
      value: riskMappingTable.tableArn,
      description: 'Risk Mapping DynamoDB table ARN',
    });

    new cdk.CfnOutput(this, 'RiskInterceptorFunctionArn', {
      value: interceptorFn.functionArn,
      description: 'Risk Level Interceptor Lambda ARN',
    });

    new cdk.CfnOutput(this, 'RiskCacheTtlSeconds', {
      value: '300',
      description: 'Default cache TTL for risk level lookups (seconds)',
    });

    new cdk.CfnOutput(this, 'RiskClassificationFallback', {
      value: JSON.stringify(DEFAULT_RISK_MAPPINGS),
      description: 'Default risk classification fallback JSON',
    });

    // ========================================
    // 6. Environment variables for Remediator Runtime
    //    These should be added to the Remediator Runtime configuration.
    //    Exported as CfnOutputs for cross-stack reference.
    // ========================================
    new cdk.CfnOutput(this, 'RemediatorEnvRiskTableName', {
      value: riskMappingTable.tableName,
      description: 'RISK_MAPPING_TABLE_NAME env var for Remediator Runtime',
      exportName: 'RiskMappingTableName',
    });

    new cdk.CfnOutput(this, 'RemediatorEnvRiskCacheTtl', {
      value: '300',
      description: 'RISK_CACHE_TTL_SECONDS env var for Remediator Runtime',
      exportName: 'RiskCacheTtlSeconds',
    });

    new cdk.CfnOutput(this, 'RemediatorEnvRiskFallback', {
      value: JSON.stringify(DEFAULT_RISK_MAPPINGS),
      description: 'RISK_CLASSIFICATION_FALLBACK env var for Remediator Runtime',
      exportName: 'RiskClassificationFallback',
    });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions(interceptorRole, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS managed policy for CloudWatch Logs.' },
      { id: 'AwsSolutions-IAM5', reason: 'CloudWatch PutMetricData requires wildcard resource with namespace condition.' },
    ], true);

    NagSuppressions.addResourceSuppressions(interceptorFn, [
      { id: 'AwsSolutions-L1', reason: 'Python 3.12 is the latest GA runtime. 3.13/3.14 are not yet GA in all regions.' },
    ], true);

    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', reason: 'AWS managed policies used for Lambda basic execution.' },
      { id: 'AwsSolutions-IAM5', reason: 'CloudWatch PutMetricData requires wildcard resource.' },
      { id: 'AwsSolutions-L1', reason: 'Python 3.12 is the latest GA runtime.' },
    ], true);
  }
}
