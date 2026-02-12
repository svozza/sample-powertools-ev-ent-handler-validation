import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { STACK_NAME } from '../lib/constants';

export async function getApiUrl(): Promise<string> {
  const client = new CloudFormationClient({});
  const response = await client.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  
  const output = response.Stacks?.[0]?.Outputs?.find(o => o.OutputKey === 'ApiUrl');
  if (!output?.OutputValue) {
    throw new Error('ApiUrl output not found in stack');
  }
  
  return output.OutputValue;
}
