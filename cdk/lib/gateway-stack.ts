import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface GatewayStackProps extends cdk.StackProps {
  billingMcpRuntimeArn: string;
  billingMcpRuntimeEndpoint: string;
  pricingMcpRuntimeArn: string;
  pricingMcpRuntimeEndpoint: string;
  // From MCPRuntimeStack - for OAuth provider (outbound auth to runtimes)
  userPoolId: string;
  userPoolArn: string;
  m2mClientId: string;
  // From AuthStack - for JWT inbound auth (user -> Gateway)
  frontendUserPoolId: string;
  frontendCognitoDiscoveryUrl: string;
  frontendUserPoolClientId: string;
}

export class GatewayStack extends cdk.Stack {
  public readonly gatewayArn: string;
  public readonly gatewayUrl: string;
  public readonly gatewayId: string;

  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props);

    // ========================================
    // Retrieve M2M client secret from Cognito
    // ========================================
    const describeM2MClient = new cr.AwsCustomResource(this, 'DescribeM2MClient', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'describeUserPoolClient',
        parameters: { UserPoolId: props.userPoolId, ClientId: props.m2mClientId },
        physicalResourceId: cr.PhysicalResourceId.of('m2m-client-secret'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['cognito-idp:DescribeUserPoolClient'],
          resources: [props.userPoolArn],
        }),
      ]),
    });
    const m2mClientSecret = describeM2MClient.getResponseField('UserPoolClient.ClientSecret');

    // ========================================
    // Gateway Service Role
    // ========================================
    const gatewayRole = new iam.Role(this, 'GatewayServiceRole', {
      description: 'Service role for Cost Optimizer AgentCore Gateway',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    gatewayRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:GetWorkloadAccessToken',
        'bedrock-agentcore:GetResourceOauth2Token',
      ],
      resources: ['*'],
    }));

    // ========================================
    // OAuth Credential Provider (Lambda custom resource)
    // ========================================
    const oauthProviderFn = new lambda.Function(this, 'OAuthProviderFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(2),
      code: lambda.Code.fromInline(`
import json, logging, urllib.request, boto3
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def send_cfn_response(event, status, data=None, reason=None, physical_id=None):
    body = json.dumps({
        'Status': status,
        'Reason': reason or 'See CloudWatch Logs',
        'PhysicalResourceId': physical_id or event.get('PhysicalResourceId', event['RequestId']),
        'StackId': event['StackId'], 'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'], 'Data': data or {},
    })
    req = urllib.request.Request(event['ResponseURL'], data=body.encode('utf-8'), headers={'Content-Type': ''}, method='PUT')
    urllib.request.urlopen(req)

def handler(event, context):
    logger.info(f'Event: {json.dumps(event)}')
    props = event['ResourceProperties']
    provider_name = props.get('ProviderName', '')
    region = props.get('Region', 'us-east-1')
    client = boto3.client('bedrock-agentcore-control', region_name=region)

    if event['RequestType'] == 'Delete':
        try:
            client.delete_oauth2_credential_provider(name=provider_name)
        except Exception:
            pass
        send_cfn_response(event, 'SUCCESS')
        return

    try:
        response = client.create_oauth2_credential_provider(
            name=provider_name,
            credentialProviderVendor='CustomOauth2',
            oauth2ProviderConfigInput={
                'customOauth2ProviderConfig': {
                    'oauthDiscovery': { 'discoveryUrl': props.get('DiscoveryUrl', '') },
                    'clientId': props.get('ClientId', ''),
                    'clientSecret': props.get('ClientSecret', ''),
                },
            },
        )
        send_cfn_response(event, 'SUCCESS', data={
            'ProviderArn': response.get('credentialProviderArn', ''),
            'SecretArn': response.get('clientSecretArn', {}).get('secretArn', ''),
        }, physical_id=provider_name)
    except Exception as e:
        logger.error(f'Create failed: {e}')
        send_cfn_response(event, 'FAILED', reason=str(e))
`),
    });

    oauthProviderFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateOauth2CredentialProvider',
        'bedrock-agentcore:DeleteOauth2CredentialProvider',
        'bedrock-agentcore:GetOauth2CredentialProvider',
        'bedrock-agentcore:CreateTokenVault',
        'bedrock-agentcore:GetTokenVault',
      ],
      resources: ['*'],
    }));
    oauthProviderFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:CreateSecret', 'secretsmanager:DeleteSecret', 'secretsmanager:PutSecretValue', 'secretsmanager:TagResource'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity*`],
    }));

    const oauthProvider = new cdk.CustomResource(this, 'OAuthProvider', {
      serviceToken: oauthProviderFn.functionArn,
      properties: {
        ProviderName: `${this.stackName}-oauth-provider`,
        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
        ClientId: props.m2mClientId,
        ClientSecret: m2mClientSecret,
        Region: this.region,
      },
    });

    const oauthProviderArn = oauthProvider.getAttString('ProviderArn');
    const oauthSecretArn = oauthProvider.getAttString('SecretArn');

    // Scope gateway role to OAuth provider resources
    gatewayRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:GetResourceOauth2Token',
        'bedrock-agentcore:GetWorkloadAccessToken',
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [oauthProviderArn, oauthSecretArn],
    }));

    // ========================================
    // Gateway (AWS_IAM auth)
    // ========================================
    const gateway = new cdk.CfnResource(this, 'McpGateway', {
      type: 'AWS::BedrockAgentCore::Gateway',
      properties: {
        Name: 'costopt-gateway',
        Description: 'Cost Optimizer Gateway with JWT auth for Cedar Policy evaluation',
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
            Instructions: 'Cost optimization gateway for billing and pricing MCP tools',
            SearchType: 'SEMANTIC',
            SupportedVersions: ['2025-03-26'],
          },
        },
        RoleArn: gatewayRole.roleArn,
      },
    });
    gateway.node.addDependency(oauthProvider);

    this.gatewayArn = gateway.getAtt('GatewayArn').toString();
    this.gatewayId = gateway.getAtt('GatewayIdentifier').toString();
    const gatewayId = this.gatewayId;
    this.gatewayUrl = gateway.getAtt('GatewayUrl').toString();

    // ========================================
    // Gateway Targets with OAuth credentials
    // ========================================
    const billingTarget = new cdk.CfnResource(this, 'BillingMcpTarget', {
      type: 'AWS::BedrockAgentCore::GatewayTarget',
      properties: {
        GatewayIdentifier: gatewayId,
        Name: 'billingMcp',
        Description: 'AWS Labs Billing MCP Server on AgentCore Runtime',
        TargetConfiguration: {
          Mcp: { McpServer: { Endpoint: props.billingMcpRuntimeEndpoint } },
        },
        CredentialProviderConfigurations: [{
          CredentialProviderType: 'OAUTH',
          CredentialProvider: {
            OauthCredentialProvider: {
              ProviderArn: oauthProviderArn,
              Scopes: ['mcp-runtime-server/invoke'],
            },
          },
        }],
      },
    });
    billingTarget.node.addDependency(gateway);

    const pricingTarget = new cdk.CfnResource(this, 'PricingMcpTarget', {
      type: 'AWS::BedrockAgentCore::GatewayTarget',
      properties: {
        GatewayIdentifier: gatewayId,
        Name: 'pricingMcp',
        Description: 'AWS Labs Pricing MCP Server on AgentCore Runtime',
        TargetConfiguration: {
          Mcp: { McpServer: { Endpoint: props.pricingMcpRuntimeEndpoint } },
        },
        CredentialProviderConfigurations: [{
          CredentialProviderType: 'OAUTH',
          CredentialProvider: {
            OauthCredentialProvider: {
              ProviderArn: oauthProviderArn,
              Scopes: ['mcp-runtime-server/invoke'],
            },
          },
        }],
      },
    });
    pricingTarget.node.addDependency(gateway);

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'GatewayArnOutput', { value: this.gatewayArn });
    new cdk.CfnOutput(this, 'GatewayUrlOutput', { value: this.gatewayUrl });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions(gatewayRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore Identity token exchange.' },
    ], true);
    NagSuppressions.addResourceSuppressions(oauthProviderFn, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard required for AgentCore Identity token vault and secrets.' },
    ], true);
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore Identity, OAuth provider management.' },
      { id: 'AwsSolutions-L1', reason: 'Lambda runtime version managed by CDK.' },
    ]);
  }
}
