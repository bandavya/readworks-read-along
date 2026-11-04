import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwi from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { QualityGate } from './quality-gate';

export interface SoundAlongStackProps extends cdk.StackProps {
  envName: string;
  voiceId: string;
  engine: string;
  language: string;
}

export class SoundAlongStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SoundAlongStackProps) {
    super(scope, id, props);

    const { envName, voiceId, engine, language } = props;
    const removalPolicy =
      envName === 'sandbox' || envName === 'local'
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN;
    const autoDelete = removalPolicy === cdk.RemovalPolicy.DESTROY;

    // ---------------------------------------------------------------------
    // 9. Security: separate private buckets, block public access everywhere.
    // ---------------------------------------------------------------------
    const contentBucket = new s3.Bucket(this, 'ContentBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: autoDelete,
    });

    const audioBucket = new s3.Bucket(this, 'AudioBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: autoDelete,
    });

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: autoDelete,
    });

    // ---------------------------------------------------------------------
    // Job state: DynamoDB (passage hash, status, voice, engine, keys, review)
    // ---------------------------------------------------------------------
    const jobTable = new dynamodb.Table(this, 'JobTable', {
      partitionKey: { name: 'passageId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'textHash', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery: envName === 'prod',
    });
    // GSI to query job status by passageId regardless of hash (status page).
    jobTable.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
    });

    // ---------------------------------------------------------------------
    // 4.3 CloudFront delivery with Origin Access Control (private origins).
    // ---------------------------------------------------------------------
    const frontendOac = new cloudfront.S3OriginAccessControl(this, 'FrontendOac', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // The Sound Along frontend is a self-contained static app that serves its
    // own data/, audio/, and img/ via relative paths. So everything is served
    // from the single frontend origin; the audio/content buckets remain part
    // of the generation pipeline (Polly outputs) but are not fronted here.
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket, {
          originAccessControl: frontendOac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      comment: `Sound Along ${envName} delivery`,
    });

    // ---------------------------------------------------------------------
    // 6. Lambda TTS workers (Python). One handler file, routed by STATE env.
    // ---------------------------------------------------------------------
    const qualityGateEnabled = this.node.tryGetContext('qualityGate') === 'true';
    const commonLambdaEnv = {
      CONTENT_BUCKET: contentBucket.bucketName,
      AUDIO_BUCKET: audioBucket.bucketName,
      JOB_TABLE: jobTable.tableName,
      VOICE_ID: voiceId,
      ENGINE: engine,
      LANGUAGE: language,
      ENV_NAME: envName,
      ...(qualityGateEnabled ? { QUALITY_GATE: 'true' } : {}),
    };

    const workerCode = lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'worker'), { exclude: ['**/__pycache__/**', '**/*.pyc'] });
    const gatedWorkerCode = qualityGateEnabled
      ? lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'quality_gate'), { exclude: ['**/__pycache__/**', '**/*.pyc'] }) : undefined;

    const makeWorker = (name: string, handler: string): lambda.Function =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: `handler.${handler}`,
        code: gatedWorkerCode && ['check_existing_manifest', 'write_manifest'].includes(handler) ? gatedWorkerCode : workerCode,
        timeout: cdk.Duration.minutes(5),
        memorySize: 256,
        environment: commonLambdaEnv,
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

    const loadPassageFn = makeWorker('LoadPassageFn', 'load_passage');
    const normalizeTextFn = makeWorker('NormalizeTextFn', 'normalize_text');
    const computeHashFn = makeWorker('ComputeHashFn', 'compute_hash');
    const checkManifestFn = makeWorker('CheckManifestFn', 'check_existing_manifest');
    const submitPollyFn = makeWorker('SubmitPollyFn', 'submit_polly');
    const checkPollyFn = makeWorker('CheckPollyFn', 'check_polly');
    const validateFn = makeWorker('ValidateFn', 'validate_outputs');
    const writeManifestFn = makeWorker('WriteManifestFn', 'write_manifest');
    const publishDemoFn = makeWorker('PublishDemoFn', 'publish_demo_json');
    const emitMetricsFn = makeWorker('EmitMetricsFn', 'emit_metrics');
    const readerBridgeEnabled = this.node.tryGetContext('readerBridge') === 'true';
    const readerBridgeFn = readerBridgeEnabled ? new lambda.Function(this, 'ReaderBridgeFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'reader_bridge'), { exclude: ['**/__pycache__/**', '**/*.pyc'] }),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: { ...commonLambdaEnv, FRONTEND_BUCKET: frontendBucket.bucketName },
      logRetention: logs.RetentionDays.ONE_WEEK,
    }) : undefined;

    const allWorkers = [
      loadPassageFn, normalizeTextFn, computeHashFn, checkManifestFn,
      submitPollyFn, checkPollyFn, validateFn, writeManifestFn,
      publishDemoFn, emitMetricsFn,
    ];

    // Least-privilege grants.
    for (const fn of allWorkers) {
      jobTable.grantReadWriteData(fn);
      contentBucket.grantRead(fn);
    }
    audioBucket.grantReadWrite(submitPollyFn);
    audioBucket.grantRead(checkPollyFn);
    audioBucket.grantReadWrite(validateFn);
    audioBucket.grantReadWrite(writeManifestFn);
    audioBucket.grantReadWrite(publishDemoFn);
    contentBucket.grantReadWrite(writeManifestFn);
    contentBucket.grantReadWrite(publishDemoFn);
    if (readerBridgeFn) {
      // Without ListBucket, S3 reports a missing file as AccessDenied instead of NoSuchKey,
      // and the bridge has to tell "not published yet" apart from a real failure.
      readerBridgeFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [contentBucket.bucketArn, frontendBucket.bucketArn],
      }));
      readerBridgeFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [contentBucket.arnForObjects('passages/*'), audioBucket.arnForObjects('audio/*'),
                    audioBucket.arnForObjects('polly/*'), frontendBucket.arnForObjects('data/*')],
      }));
      readerBridgeFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [frontendBucket.arnForObjects('data/*'), frontendBucket.arnForObjects('audio/*')],
      }));
      readerBridgeFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:UpdateItem'], resources: [jobTable.tableArn],
      }));
    }

    // Polly: async synthesis writes to the audio bucket.
    const pollyPolicy = new iam.PolicyStatement({
      actions: [
        'polly:StartSpeechSynthesisTask',
        'polly:GetSpeechSynthesisTask',
        'polly:SynthesizeSpeech',
        'polly:DescribeVoices',
      ],
      resources: ['*'],
    });
    submitPollyFn.addToRolePolicy(pollyPolicy);
    checkPollyFn.addToRolePolicy(pollyPolicy);

    emitMetricsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      }),
    );

    // ---------------------------------------------------------------------
    // 6.3 Step Functions workflow (states match the design, 1..11).
    // ---------------------------------------------------------------------
    const loadPassage = new tasks.LambdaInvoke(this, 'LoadPassage', {
      lambdaFunction: loadPassageFn,
      outputPath: '$.Payload',
    });
    const normalizeText = new tasks.LambdaInvoke(this, 'NormalizeText', {
      lambdaFunction: normalizeTextFn,
      outputPath: '$.Payload',
    });
    const computeHash = new tasks.LambdaInvoke(this, 'ComputeTextHash', {
      lambdaFunction: computeHashFn,
      outputPath: '$.Payload',
    });
    const checkExisting = new tasks.LambdaInvoke(this, 'CheckExistingManifest', {
      lambdaFunction: checkManifestFn,
      outputPath: '$.Payload',
    });
    const submitPolly = new tasks.LambdaInvoke(this, 'SubmitPollyAudio', {
      lambdaFunction: submitPollyFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    submitPolly.addRetry({
      errors: ['States.ALL'],
      maxAttempts: 4,
      interval: cdk.Duration.seconds(2),
      backoffRate: 2.0,
    });
    const waitForPolly = new sfn.Wait(this, 'WaitForCompletion', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(5)),
    });
    const checkPolly = new tasks.LambdaInvoke(this, 'CheckPollyStatus', {
      lambdaFunction: checkPollyFn,
      outputPath: '$.Payload',
    });
    const validate = new tasks.LambdaInvoke(this, 'ValidateOutputs', {
      lambdaFunction: validateFn,
      outputPath: '$.Payload',
    });
    const writeManifest = new tasks.LambdaInvoke(this, 'WriteManifest', {
      lambdaFunction: writeManifestFn,
      outputPath: '$.Payload',
    });
    const publishDemo = new tasks.LambdaInvoke(this, 'PublishDemoJson', {
      lambdaFunction: publishDemoFn,
      outputPath: '$.Payload',
    });
    const publishToReader = readerBridgeFn ? new tasks.LambdaInvoke(this, 'PublishToReader', {
      lambdaFunction: readerBridgeFn,
      outputPath: '$.Payload',
    }) : undefined;
    const emitMetrics = new tasks.LambdaInvoke(this, 'EmitMetrics', {
      lambdaFunction: emitMetricsFn,
      outputPath: '$.Payload',
    });

    const succeedCached = new sfn.Succeed(this, 'AlreadyGenerated', {
      comment: qualityGateEnabled ? 'Identical voice-checked audio already exists; skipped regeneration.' : 'Identical approved audio already exists; skipped regeneration.',
    });
    const succeedDone = new sfn.Succeed(this, 'GenerationComplete');
    const failState = new sfn.Fail(this, 'GenerationFailed', {
      cause: 'Polly synthesis or validation failed.',
      error: 'SoundAlongGenerationError',
    });

    const published = writeManifest.next(publishDemo);
    let afterPublish: sfn.IChainable;
    if (publishToReader) {
      const readerFailed = new sfn.Fail(this, 'ReaderPublishFailed', {
        cause: 'Reader bridge rejected passage; see readerFailureReason in the job table.',
        error: 'SoundAlongReaderPublishError',
      });
      const readerResult = new sfn.Choice(this, 'IsReaderReady')
        .when(sfn.Condition.booleanEquals('$.readerReady', true), emitMetrics.next(succeedDone))
        .otherwise(readerFailed);
      afterPublish = published.next(publishToReader).next(readerResult);
    } else {
      afterPublish = published.next(emitMetrics).next(succeedDone);
    }
    const afterValidation = qualityGateEnabled
      ? new QualityGate(this, 'QualityGate', { contentBucket, audioBucket, jobTable, onPass: afterPublish }).entry
      : afterPublish;

    // Poll loop: WaitForCompletion -> CheckPollyStatus -> Choice
    const pollChoice = new sfn.Choice(this, 'IsPollyDone')
      .when(
        sfn.Condition.stringEquals('$.pollyStatus', 'completed'),
        validate.next(
          new sfn.Choice(this, 'IsValid')
            .when(
              sfn.Condition.booleanEquals('$.valid', true),
              afterValidation,
            )
            .otherwise(failState),
        ),
      )
      .when(sfn.Condition.stringEquals('$.pollyStatus', 'failed'), failState)
      .otherwise(waitForPolly);

    waitForPolly.next(checkPolly).next(pollChoice);

    const definition = loadPassage
      .next(normalizeText)
      .next(computeHash)
      .next(checkExisting)
      .next(
        new sfn.Choice(this, 'ManifestExists')
          .when(sfn.Condition.booleanEquals('$.cached', true), succeedCached)
          .otherwise(submitPolly.next(waitForPolly)),
      );

    const stateMachine = new sfn.StateMachine(this, 'GenerationStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(qualityGateEnabled ? 30 : 15),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'SfnLogs', {
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    // ---------------------------------------------------------------------
    // Events: S3 notification -> Lambda -> start Step Functions execution.
    // ---------------------------------------------------------------------
    const startFn = new lambda.Function(this, 'StartWorkflowFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.start_from_s3',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'trigger')),
      timeout: cdk.Duration.minutes(1),
      environment: { STATE_MACHINE_ARN: stateMachine.stateMachineArn },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    stateMachine.grantStartExecution(startFn);
    contentBucket.grantRead(startFn);
    contentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(startFn),
      { prefix: 'passages/', suffix: '.json' },
    );

    // ---------------------------------------------------------------------
    // Browser API: HTTP API Gateway + Lambda (metadata, access, references).
    // ---------------------------------------------------------------------
    const apiFn = new lambda.Function(this, 'ApiFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handle',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'api')),
      timeout: cdk.Duration.seconds(15),
      environment: {
        ...commonLambdaEnv,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        CDN_DOMAIN: distribution.distributionDomainName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    contentBucket.grantRead(apiFn);
    jobTable.grantReadData(apiFn);
    stateMachine.grantStartExecution(apiFn);

    const httpApi = new apigw.HttpApi(this, 'BrowserApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.OPTIONS],
        allowHeaders: ['*'],
      },
    });
    const apiIntegration = new apigwi.HttpLambdaIntegration('ApiIntegration', apiFn);
    httpApi.addRoutes({ path: '/passages', methods: [apigw.HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: '/passages/{id}', methods: [apigw.HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: '/passages/{id}/access', methods: [apigw.HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: '/jobs', methods: [apigw.HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: '/generate', methods: [apigw.HttpMethod.POST], integration: apiIntegration });

    // ---------------------------------------------------------------------
    // Outputs (environment-specific values; nothing hard-coded in frontend).
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ContentBucketName', { value: contentBucket.bucketName });
    new cdk.CfnOutput(this, 'AudioBucketName', { value: audioBucket.bucketName });
    new cdk.CfnOutput(this, 'FrontendBucketName', { value: frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });
    new cdk.CfnOutput(this, 'JobTableName', { value: jobTable.tableName });
  }
}
