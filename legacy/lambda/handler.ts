// @ts-nocheck
import { Router, NotFoundError } from '@aws-lambda-powertools/event-handler/http';
import type { Middleware } from '@aws-lambda-powertools/event-handler/types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { Context, APIGatewayProxyResult, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ProductSchema, ProductWithIdSchema, ProductPathSchema, ProductListSchema, ApiKeyHeaderSchema, ProductQuerySchema } from './schemas';
import type { Product, ProductWithId, ProductPath, ApiKeyHeader, ProductQuery } from './schemas';
import { z } from 'zod';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const INVERTED_INDEX_NAME = process.env.INVERTED_INDEX_NAME!;

const app = new Router();

app.get<{ query: ProductQuery }, ProductWithId[]>(
  '/products',
  async (reqCtx) => {
    const { category, minPrice, maxPrice } = reqCtx.valid.req.query;
    
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: INVERTED_INDEX_NAME,
      KeyConditionExpression: 'sk = :sk',
      ExpressionAttributeValues: { ':sk': 'PRODUCTS' }
    }));
    
    let products = (result.Items || []).map(({ pk, sk, ...product }) => {
      const id = pk.replace('PRODUCTS#', '');
      return { id, ...product as Product };
    });

    if (category) {
      products = products.filter(p => p.category === category);
    }
    if (minPrice) {
      products = products.filter(p => p.price >= Number.parseFloat(minPrice));
    }
    if (maxPrice) {
      products = products.filter(p => p.price <= Number.parseFloat(maxPrice));
    }

    return products;
  },
  {
    validation: { req: { query: ProductQuerySchema }, res: { body: ProductListSchema } },
  }
);

app.get<{ path: ProductPath }, ProductWithId>(
  '/products/:id',
  async (reqCtx) => {
    const { id } = reqCtx.valid.req.path;
    const result = await client.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `PRODUCTS#${id}`, sk: 'PRODUCTS' }
    }));
    
    if (!result.Item) {
      throw new NotFoundError('Product not found');
    }
    
    const { pk, sk, ...product } = result.Item;
    return { id, ...product as Product };
  },
  {
    validation: { req: { path: ProductPathSchema }, res: { body: ProductWithIdSchema } },
  }
);

app.get(
  '/product-invalid',
  async () => {
    const product: Product = { name: 'Test', price: 10, category: 'Test' };
    return product;
  },
  {
    validation: { res: { body: ProductWithIdSchema } },
  }
);

const validResMiddleware: Middleware = async ({ reqCtx, next }) => {
  await next();
  // @ts-ignore - the TypedRequestContext type is not exported so we can't specify in the argument that the valid field will be there
  const body = reqCtx.valid.res.body;
  reqCtx.res.headers.set('x-exists', JSON.stringify(body));
};

app.get(
  '/res-body',
  [validResMiddleware],
  (reqCtx) => {
    return {hasResBody: true}
  },
  {
    validation: { res: { body: z.object({ hasResBody: z.boolean() }) } },
  }
);

app.get(
  '/product-valid',
  async () => {
    return { id: '1234', name: 'Test', price: 10, category: 'Test' };
  },
  {
    validation: { res: { body: ProductWithIdSchema } },
  }
);

app.get<{ headers: ApiKeyHeader }>(
  '/protected',
  (reqCtx) => {
    const apiKey = reqCtx.valid.req.headers['x-api-key'];
    return { message: `Authenticated with ${apiKey}` };
  },
  {
    validation: { req: { headers: ApiKeyHeaderSchema } },
  }
);

app.post<{ body: Product }, ProductWithId>('/products', async (reqCtx) => {
  const product = reqCtx.valid.req.body;

  const id = randomUUID();
  const item = { pk: `PRODUCTS#${id}`, sk: 'PRODUCTS', ...product };
  await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return { id, ...product };
}, {
  validation: {
    req: { body: ProductSchema },
    res: {
      body: ProductWithIdSchema
    }
  }
});

app.delete<{ path: ProductPath }>(
  '/products/:id',
  async (reqCtx) => {
    const { id } = reqCtx.valid.req.path;
    await client.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `PRODUCTS#${id}`, sk: 'PRODUCTS' }
    }));
    
    return new Response(null, { status: 204 });
  },
  {
    validation: { req: { path: ProductPathSchema } },
  }
);

export const handler = async (event: unknown, context: Context): Promise<APIGatewayProxyResult | APIGatewayProxyStructuredResultV2> => {
  return app.resolve(event, context)
};
