import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

/**
 * AuthStack: Cognito User Pool with RBAC groups for frontend auth.
 * Both Gateway (for JWT validation) and AgentRuntime (for IAM credentials)
 * depend on this stack.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPoolId: string;
  public readonly userPoolArn: string;
  public readonly userPoolClientId: string;
  public readonly identityPoolId: string;
  public readonly cognitoDiscoveryUrl: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================================
    // Cognito User Pool
    // ========================================
    const userPool = new cognito.UserPool(this, 'CostOptUserPool', {
      userPoolName: 'costopt-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolId = userPool.userPoolId;
    this.userPoolArn = userPool.userPoolArn;
    this.cognitoDiscoveryUrl = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`;

    // ========================================
    // RBAC Groups (Phase 3)
    // ========================================
    new cognito.CfnUserPoolGroup(this, 'AnalystGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'CostOpt-Analyst',
      description: 'Read-only access to cost data and recommendations',
    });
    new cognito.CfnUserPoolGroup(this, 'EngineerGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'CostOpt-Engineer',
      description: 'Can execute low-risk optimizations on non-production resources',
    });
    new cognito.CfnUserPoolGroup(this, 'ManagerGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'CostOpt-Manager',
      description: 'Full access to all optimizations including production',
    });

    // ========================================
    // Cognito Domain (for Hosted UI OAuth flows)
    // ========================================
    userPool.addDomain('CostOptDomain', {
      cognitoDomain: { domainPrefix: `costopt-${this.account}` },
    });

    // ========================================
    // Frontend Client (browser-based, no secret)
    // ========================================
    const userPoolClient = userPool.addClient('FrontendClient', {
      userPoolClientName: 'costopt-frontend-client',
      generateSecret: false,
      authFlows: { userPassword: true, userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          'http://localhost:5173/',
          // After deployment, add your CloudFront URL here via CDK context or manually in Cognito console
        ],
        logoutUrls: [
          'http://localhost:5173/',
        ],
      },
    });
    this.userPoolClientId = userPoolClient.userPoolClientId;

    // ========================================
    // Identity Pool (for IAM credentials to invoke AgentCore Runtime)
    // ========================================
    const identityPool = new cognito.CfnIdentityPool(this, 'CostOptIdentityPool', {
      identityPoolName: 'costopt_identity_pool',
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: userPoolClient.userPoolClientId,
        providerName: userPool.userPoolProviderName,
      }],
    });
    this.identityPoolId = identityPool.ref;

    // Authenticated role - can invoke AgentCore Runtime
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:InvokeAgentRuntime',
        'bedrock-agentcore:InvokeAgentRuntimeForUser',
      ],
      resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`],
    }));

    // Unauthenticated role - deny all
    const unauthenticatedRole = new iam.Role(this, 'UnauthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
        unauthenticated: unauthenticatedRole.roleArn,
      },
    });

    // Admin user - CloudFormation will auto-generate username to allow stack updates
    // Update email before deploying
    new cognito.CfnUserPoolUser(this, 'AdminUser', {
      userPoolId: userPool.userPoolId,
      userAttributes: [
        { name: 'email', value: 'admin@example.com' },
        { name: 'email_verified', value: 'true' },
      ],
      desiredDeliveryMediums: ['EMAIL'],
    });

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClientId });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: this.identityPoolId });
    new cdk.CfnOutput(this, 'CognitoDiscoveryUrl', { value: this.cognitoDiscoveryUrl });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions(userPool, [
      { id: 'AwsSolutions-COG2', reason: 'MFA not enforced for capstone demo.' },
      { id: 'AwsSolutions-COG3', reason: 'Advanced security not required for capstone.' },
    ], true);
    NagSuppressions.addResourceSuppressions(authenticatedRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore runtime invocation.' },
    ], true);
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions for Cognito Identity Pool roles.' },
      { id: 'AwsSolutions-L1', reason: 'Lambda runtime managed by CDK for Cognito custom resource.' },
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.' },
    ]);
  }
}
