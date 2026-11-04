import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export interface QualityGateProps {
  contentBucket: s3.IBucket;
  audioBucket: s3.IBucket;
  jobTable: dynamodb.ITable;
  onPass: sfn.IChainable;
  /** The transcription job is already running or done (generative voice), so skip starting another. */
  reuseTranscription?: boolean;
}

export class QualityGate extends Construct {
  readonly entry: sfn.IChainable;

  constructor(scope: Construct, id: string, props: QualityGateProps) {
    super(scope, id);
    const code = lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'quality_gate'), { exclude: ['**/__pycache__/**', '**/*.pyc'] });
    const environment = {
      CONTENT_BUCKET: props.contentBucket.bucketName,
      AUDIO_BUCKET: props.audioBucket.bucketName,
      JOB_TABLE: props.jobTable.tableName,
    };
    const makeFn = (name: string, handler: string) => new lambda.Function(this, name, {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: `handler.${handler}`,
      code,
      environment,
      timeout: cdk.Duration.minutes(2),
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    const startFn = makeFn('StartFn', 'start');
    const checkFn = makeFn('CheckFn', 'check');
    startFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['transcribe:StartTranscriptionJob'],
      resources: [cdk.Stack.of(this).formatArn({ service: 'transcribe', resource: 'transcription-job', resourceName: 'sound-along-qg-*' })],
    }));
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['transcribe:GetTranscriptionJob'],
      resources: [cdk.Stack.of(this).formatArn({ service: 'transcribe', resource: 'transcription-job', resourceName: 'sound-along-qg-*' })],
    }));
    startFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'], resources: [props.audioBucket.arnForObjects('polly/*')],
    }));
    startFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'], resources: [props.audioBucket.arnForObjects('transcribe/*')],
    }));
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [props.audioBucket.arnForObjects('transcribe/*'), props.contentBucket.arnForObjects('config/names.json')],
    }));
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'], resources: [props.contentBucket.arnForObjects('review/*')],
    }));
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:UpdateItem'], resources: [props.jobTable.tableArn],
    }));

    const start = new tasks.LambdaInvoke(this, 'StartTranscription', { lambdaFunction: startFn, outputPath: '$.Payload' });
    const wait = new sfn.Wait(this, 'WaitForTranscription', { time: sfn.WaitTime.duration(cdk.Duration.seconds(10)) });
    const check = new tasks.LambdaInvoke(this, 'CheckHeardWords', { lambdaFunction: checkFn, outputPath: '$.Payload' });
    const held = new sfn.Succeed(this, 'HeldForVoiceCheck', { comment: 'The take is held; reasons are in the review object and job table.' });
    const result = new sfn.Choice(this, 'IsVoiceCheckClear')
      .when(sfn.Condition.stringEquals('$.transcribeStatus', 'running'), wait)
      .when(sfn.Condition.booleanEquals('$.qualityGatePassed', true), props.onPass)
      .otherwise(held);
    wait.next(check).next(result);
    this.entry = props.reuseTranscription ? wait : start.next(wait);
  }
}
