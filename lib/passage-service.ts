import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export interface PassageServiceProps {
  contentBucket: s3.IBucket;
  audioBucket: s3.IBucket;
  jobTable: dynamodb.ITable;
  voiceId: string;
  engine: string;
  language: string;
  sourceBucketName?: string;
}

/** Separate IAM-only intake. The content bucket's existing event starts generation. */
export class PassageService extends Construct {
  constructor(scope: Construct, id: string, props: PassageServiceProps) {
    super(scope, id);
    const fn = new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handle',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'passage_service'), { exclude: ['**/__pycache__/**', '**/*.pyc'] }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        CONTENT_BUCKET: props.contentBucket.bucketName,
        AUDIO_BUCKET: props.audioBucket.bucketName,
        JOB_TABLE: props.jobTable.tableName,
        SOURCE_BUCKET: props.sourceBucketName ?? '',
        VOICE_ID: props.voiceId,
        ENGINE: props.engine,
        LANGUAGE: props.language,
      },
    });
    props.contentBucket.grantRead(fn);
    props.contentBucket.grantPut(fn, 'api-jobs/*');
    props.contentBucket.grantPut(fn, 'passages/*');
    props.audioBucket.grantRead(fn);
    props.jobTable.grantReadData(fn);
    if (props.sourceBucketName && props.sourceBucketName !== props.contentBucket.bucketName) {
      s3.Bucket.fromBucketName(this, 'SourceBucket', props.sourceBucketName).grantRead(fn);
    }
    const api = new apigw.RestApi(this, 'Api', {
      restApiName: 'Sound Along passage service',
      cloudWatchRole: false,
      deployOptions: { loggingLevel: apigw.MethodLoggingLevel.OFF },
    });
    const v1 = api.root.addResource('v1');
    const passages = v1.addResource('passages');
    const integration = new apigw.LambdaIntegration(fn);
    passages.addMethod('POST', integration, { authorizationType: apigw.AuthorizationType.IAM });
    passages.addResource('{id}').addMethod('GET', integration, { authorizationType: apigw.AuthorizationType.IAM });
    new cdk.CfnOutput(this, 'PassageApiUrl', { value: `${api.url}v1/passages` });
  }
}
