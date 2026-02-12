# AWS Lambda Powertools Event Handler Validation Sample

This project demonstrates request and response validation using AWS Lambda Powertools Event Handler with Zod schemas.

## Prerequisites

- Node.js 24.x
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

## Setup

```bash
npm install
```

## Development

### Build
```bash
npm run build
```

### Deploy
```bash
npx cdk deploy --profile <your-aws-profile>
```

### Testing

Run unit tests (excludes e2e):
```bash
npm test
```

Run e2e tests (requires deployed stack):
```bash
AWS_PROFILE=<your-aws-profile> npm run test:e2e
```

## Project Structure

- `lib/` - CDK infrastructure code
- `lambda/` - Lambda handler and schemas
- `test/` - Unit and e2e tests
- `dist/` - Compiled TypeScript output (gitignored)

## Notes

- Validation supports standard-schema libraries, but for simplicity all the examples below are Zod.
- Only works with handlers that return JSON object, i.e., not `Response` objects or `APIGatewayProxyResult`. The latter should be possible but `Response` is most likely not.
- When you add validation to a route, it changes the type of `RequestContext` to `TypedRequestContext`. A new field called `valid` is added that has `req` and `res` fields with
the parsed values indicated by your schema:
```ts
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
```
- The `reqCtx.valid.req.*` fields will always be there in your handler if they executed successfully. They will also be there for any middleware as validation is implemented as
middleware and always executes first.
- The `reqCtx.valid.res.body` field is only available after the handler has run. This means if you try to access it in middleware before the `next()` callback or in the handler itself, you will get a null error. I've noticed that the types don't seem to convey this, you can happily do `reqCtx.valid.res.body` without using optional chaining and you won't get any errors,
- The `TypedRequestContext` type is not exported so you can't create middleware specifically for
validated requests without using `ts-ignore` until we fix that.
- While the validated response will be available in middleware, you won't get compile time guarantees as the handlers and other middleware are not hooked up.
- If you only add response validation then TypeScript can infer the types even without generics:
```ts
app.get(
  '/product-valid',
  async () => {
    // this will cause a type error if the fields don't match schema
    return { id: '1234', name: 'Test', price: 10, category: 'Test' };
  },
  {
    validation: { res: { body: ProductWithIdSchema } },
  }
);
```
- If you have multiple validations then you need to give the generics for all of them to get compile errors

```ts
export const ProductSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  price: z.number().positive(),
  category: z.string(),
});

export const ProductWithIdSchema = ProductSchema.extend({
  id: z.string(),
});

// ...

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
```
- `app.get<{ query: ProductQuery }, ProductWithId[]>` if you use Zod to coerce the values in a query string to a type other than string you get a compile error because the underlying type we
have for query params is `Record<string, string>`. This means that in our product example, it is not possible to validate if the `minPrice` param is positive without losing compile time guarantees:
```ts
export const ProductQuerySchema = z.object({
  category: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
});

// ...

app.get<{ query: ProductQuery }, ProductWithId[]>(
  '/products',
  async (reqCtx) => {
    const { category, minPrice, maxPrice } = reqCtx.valid.req.query;
    
    // ...

    if (category) {
      products = products.filter(p => p.category === category);
    }
    if (minPrice) {
      // if we could do minPrice: z.coerce.number().positive().optional() here,
      // we wouldn't need this parseFloat
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
```