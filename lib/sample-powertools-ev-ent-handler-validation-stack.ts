import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';

export class SamplePowertoolsEvEntHandlerValidationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'EntitiesTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'InvertedIndex',
      partitionKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    });

    const fn = new nodejs.NodejsFunction(this, 'ApiHandler', {
      entry: path.join(__dirname, '..', 'lambda', 'handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      environment: {
        TABLE_NAME: table.tableName,
        INVERTED_INDEX_NAME: 'InvertedIndex',
      },
      bundling: {
        minify: false,
      },
    });

    table.grantWriteData(fn);
    table.grantReadData(fn);

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'powertools-api',
    });

    const proxy = api.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(fn),
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}
