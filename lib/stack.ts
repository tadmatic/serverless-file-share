import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { aws_lambda, aws_lambda_nodejs, aws_logs } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

import * as packageJson from '../package.json';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const envVariables = {
      AWS_ACCOUNT_ID: Stack.of(this).account,
      POWERTOOLS_SERVICE_NAME: packageJson.name,
      POWERTOOLS_LOGGER_LOG_LEVEL: 'WARN',
      POWERTOOLS_LOGGER_SAMPLE_RATE: '0.01',
      POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      POWERTOOLS_METRICS_NAMESPACE: packageJson.name,
      MY_ENV_VARIABLE: process.env.MY_ENV_VARIABLE ?? '',
    };

    const functionSettings = {
      handler: 'handler',
      runtime: aws_lambda.Runtime.NODEJS_16_X,
      memorySize: 256,
      environment: {
        ...envVariables,
      },
      logRetention: aws_logs.RetentionDays.THREE_MONTHS,
      tracing: aws_lambda.Tracing.ACTIVE,
      bundling: {
        minify: true,
      },
      awsSdkConnectionReuse: true,
      timeout: Duration.minutes(5),
    };

    const myFunction = new aws_lambda_nodejs.NodejsFunction(this, 'MyFunction', {
      entry: './src/functions/myFunction.ts',
      ...functionSettings,
    });

    // Schedule function to run once a day
    new events.Rule(this, 'MyFunctionEventRule', {
      schedule: events.Schedule.rate(Duration.days(1)),
      targets: [new targets.LambdaFunction(myFunction)],
    });
  }
}
