import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';
import { NagSuppressions } from 'cdk-nag';

export class ImageStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  public readonly billingMcpRepository: ecr.Repository;
  public readonly pricingMcpRepository: ecr.Repository;
  public readonly remediatorRepository: ecr.Repository;
  public readonly sourceBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- ECR Repositories ---
    this.repository = new ecr.Repository(this, 'RuntimeRepository', {
      repositoryName: 'costopt-agent-runtime',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    });

    this.billingMcpRepository = new ecr.Repository(this, 'BillingMcpRepository', {
      repositoryName: 'costopt-billing-mcp',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    });

    this.pricingMcpRepository = new ecr.Repository(this, 'PricingMcpRepository', {
      repositoryName: 'costopt-pricing-mcp',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    });

    this.remediatorRepository = new ecr.Repository(this, 'RemediatorRepository', {
      repositoryName: 'costopt-remediator',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    });

    // --- S3 Bucket for CodeBuild source ---
    this.sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Upload codebuild-scripts/ to S3
    const scriptsDeployment = new s3deploy.BucketDeployment(this, 'CodeBuildScriptsDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../codebuild-scripts'))],
      destinationBucket: this.sourceBucket,
      destinationKeyPrefix: 'codebuild-scripts/',
      extract: true,
      prune: false,
      retainOnDelete: false,
      memoryLimit: 512,
    });

    // Upload src/recommender/ to S3 for main runtime build
    const agentcoreDeployment = new s3deploy.BucketDeployment(this, 'AgentcoreSourceDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../src/recommender'))],
      destinationBucket: this.sourceBucket,
      destinationKeyPrefix: 'src/recommender/',
    });

    // --- Build Trigger Lambda ---
    const buildTriggerFn = new lambda.Function(this, 'BuildTriggerFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-trigger')),
      timeout: cdk.Duration.minutes(1),
      memorySize: 128,
      description: 'Triggers CodeBuild builds for MCP server containers',
    });

    // --- Build Waiter Lambda ---
    const buildWaiterFn = new lambda.Function(this, 'BuildWaiterFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-waiter')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      description: 'Polls CodeBuild build status until completion',
    });

    // --- Billing MCP Build ---
    const billingBuildProject = this.createTransformBuildProject(
      'BillingMcp', this.billingMcpRepository, 'codebuild-scripts/', 'buildspec-billing.yml',
    );
    billingBuildProject.node.addDependency(scriptsDeployment);

    buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:StartBuild'],
      resources: [billingBuildProject.projectArn],
    }));
    buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:BatchGetBuilds'],
      resources: [billingBuildProject.projectArn],
    }));

    const billingBuildTrigger = new cdk.CustomResource(this, 'BillingBuildTrigger', {
      serviceToken: buildTriggerFn.functionArn,
      properties: { ProjectName: billingBuildProject.projectName, Timestamp: new Date().toISOString() },
    });
    billingBuildTrigger.node.addDependency(scriptsDeployment);

    const billingBuildWaiter = new cdk.CustomResource(this, 'BillingBuildWaiter', {
      serviceToken: buildWaiterFn.functionArn,
      properties: { BuildId: billingBuildTrigger.getAttString('BuildId'), MaxWaitSeconds: '1200' },
    });
    billingBuildWaiter.node.addDependency(billingBuildTrigger);

    // --- Pricing MCP Build ---
    const pricingBuildProject = this.createTransformBuildProject(
      'PricingMcp', this.pricingMcpRepository, 'codebuild-scripts/', 'buildspec-pricing.yml',
    );
    pricingBuildProject.node.addDependency(scriptsDeployment);

    buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:StartBuild'],
      resources: [pricingBuildProject.projectArn],
    }));
    buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:BatchGetBuilds'],
      resources: [pricingBuildProject.projectArn],
    }));

    const pricingBuildTrigger = new cdk.CustomResource(this, 'PricingBuildTrigger', {
      serviceToken: buildTriggerFn.functionArn,
      properties: { ProjectName: pricingBuildProject.projectName, Timestamp: new Date().toISOString() },
    });
    pricingBuildTrigger.node.addDependency(scriptsDeployment);

    const pricingBuildWaiter = new cdk.CustomResource(this, 'PricingBuildWaiter', {
      serviceToken: buildWaiterFn.functionArn,
      properties: { BuildId: pricingBuildTrigger.getAttString('BuildId'), MaxWaitSeconds: '1200' },
    });
    pricingBuildWaiter.node.addDependency(pricingBuildTrigger);

    // --- Main Agent Runtime Build ---
    this.buildMainRuntimeImage(agentcoreDeployment);

    // --- Remediator Agent Build ---
    const remediatorDeployment = new s3deploy.BucketDeployment(this, 'RemediatorSourceDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../src/remediator'))],
      destinationBucket: this.sourceBucket,
      destinationKeyPrefix: 'src/remediator/',
    });
    this.buildRemediatorImage(remediatorDeployment);

    // --- Outputs ---
    new cdk.CfnOutput(this, 'MainRepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'Main Runtime ECR Repository URI',
    });
    new cdk.CfnOutput(this, 'BillingMcpRepositoryUri', {
      value: this.billingMcpRepository.repositoryUri,
      description: 'Billing MCP Runtime ECR Repository URI',
    });
    new cdk.CfnOutput(this, 'PricingMcpRepositoryUri', {
      value: this.pricingMcpRepository.repositoryUri,
      description: 'Pricing MCP Runtime ECR Repository URI',
    });
    new cdk.CfnOutput(this, 'RemediatorRepositoryUri', {
      value: this.remediatorRepository.repositoryUri,
      description: 'Remediator Agent ECR Repository URI',
    });

    // --- CDK-Nag Suppressions ---
    NagSuppressions.addResourceSuppressions(this.sourceBucket, [
      { id: 'AwsSolutions-S1', reason: 'Server access logging not needed for capstone/demo.' },
    ]);
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-L1', reason: 'Lambda runtime version managed by CDK.' },
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions required for S3, ECR, CloudWatch, CodeBuild.' },
      { id: 'AwsSolutions-CB4', reason: 'KMS encryption not needed for capstone/demo.' },
    ]);
  }

  private createTransformBuildProject(
    id: string,
    repository: ecr.Repository,
    sourcePath: string,
    buildspecFile: string,
  ): codebuild.Project {
    const codeBuildRole = new iam.Role(this, `${id}CodeBuildRole`, {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: `IAM role for CodeBuild to build ${id} container image`,
      inlinePolicies: {
        CloudWatchLogsPolicy: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [`arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/codebuild/*`],
          })],
        }),
        ECRPushPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage',
                'ecr:PutImage', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload',
              ],
              resources: [repository.repositoryArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ecr:GetAuthorizationToken'],
              resources: ['*'],
            }),
          ],
        }),
        S3ReadPolicy: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:GetObjectVersion'],
            resources: [this.sourceBucket.arnForObjects('*')],
          })],
        }),
      },
    });

    const project = new codebuild.Project(this, `${id}BuildProject`, {
      projectName: `costopt-${id.toLowerCase()}-build`,
      description: `Build ARM64 container for ${id}`,
      source: codebuild.Source.s3({ bucket: this.sourceBucket, path: sourcePath }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(buildspecFile),
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        environmentVariables: {
          AWS_DEFAULT_REGION: { value: cdk.Aws.REGION },
          AWS_ACCOUNT_ID: { value: cdk.Aws.ACCOUNT_ID },
          ECR_REPO_URI: { value: repository.repositoryUri },
        },
      },
      role: codeBuildRole,
      timeout: cdk.Duration.minutes(30),
    });

    NagSuppressions.addResourceSuppressions(codeBuildRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ecr:GetAuthorizationToken, S3, CloudWatch Logs.' },
    ], true);
    NagSuppressions.addResourceSuppressions(project, [
      { id: 'AwsSolutions-CB4', reason: 'KMS encryption not needed for capstone/demo.' },
    ]);

    return project;
  }

  private buildMainRuntimeImage(sourceDeployment: s3deploy.BucketDeployment): void {
    const buildProject = new codebuild.Project(this, 'MainRuntimeBuildProject', {
      projectName: 'costopt-mainruntime-build',
      source: codebuild.Source.s3({ bucket: this.sourceBucket, path: 'src/recommender/' }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        privileged: true,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        AWS_DEFAULT_REGION: { value: this.region },
        AWS_ACCOUNT_ID: { value: this.account },
        IMAGE_REPO_NAME: { value: this.repository.repositoryName },
        IMAGE_TAG: { value: 'latest' },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: { commands: [
            'echo Logging in to Amazon ECR...',
            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
          ]},
          build: { commands: [
            'echo Building the Docker image...',
            'docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
            'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
          ]},
          post_build: { commands: [
            'echo Pushing the Docker image...',
            'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
          ]},
        },
      }),
    });

    this.repository.grantPullPush(buildProject);
    this.sourceBucket.grantRead(buildProject);
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));

    const triggerFn = new lambda.Function(this, 'MainRuntimeBuildTriggerFn', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-trigger')),
      timeout: cdk.Duration.minutes(1),
    });
    triggerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:StartBuild'],
      resources: [buildProject.projectArn],
    }));
    triggerFn.node.addDependency(sourceDeployment);

    new cdk.CustomResource(this, 'MainRuntimeTriggerBuild', {
      serviceToken: triggerFn.functionArn,
      properties: {
        ProjectName: buildProject.projectName,
        Timestamp: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      },
    });

    NagSuppressions.addResourceSuppressions(buildProject, [
      { id: 'AwsSolutions-CB4', reason: 'KMS encryption not needed for capstone/demo.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ECR, S3, CloudWatch.' },
    ], true);
  }

  private buildRemediatorImage(sourceDeployment: s3deploy.BucketDeployment): void {
    const buildProject = new codebuild.Project(this, 'RemediatorBuildProject', {
      projectName: 'costopt-remediator-build',
      source: codebuild.Source.s3({ bucket: this.sourceBucket, path: 'src/remediator/' }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        privileged: true,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        AWS_DEFAULT_REGION: { value: this.region },
        AWS_ACCOUNT_ID: { value: this.account },
        IMAGE_REPO_NAME: { value: this.remediatorRepository.repositoryName },
        IMAGE_TAG: { value: 'latest' },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: { commands: [
            'echo Logging in to Amazon ECR...',
            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
          ]},
          build: { commands: [
            'echo Building the Remediator Docker image...',
            'docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
            'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
          ]},
          post_build: { commands: [
            'echo Pushing the Remediator Docker image...',
            'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
          ]},
        },
      }),
    });

    this.remediatorRepository.grantPullPush(buildProject);
    this.sourceBucket.grantRead(buildProject);
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));

    const triggerFn = new lambda.Function(this, 'RemediatorBuildTriggerFn', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-trigger')),
      timeout: cdk.Duration.minutes(1),
    });
    triggerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:StartBuild'],
      resources: [buildProject.projectArn],
    }));
    triggerFn.node.addDependency(sourceDeployment);

    new cdk.CustomResource(this, 'RemediatorTriggerBuild', {
      serviceToken: triggerFn.functionArn,
      properties: {
        ProjectName: buildProject.projectName,
        Timestamp: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      },
    });

    NagSuppressions.addResourceSuppressions(buildProject, [
      { id: 'AwsSolutions-CB4', reason: 'KMS encryption not needed for capstone/demo.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ECR, S3, CloudWatch.' },
    ], true);
  }
}
