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

### v1
Note: This implementation has been superseded. To view old lambda function see the [legacy folder](./legacy/lambda/handler.ts).

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

### v2
- Changed the types so they are inferred from the validation object, no need to pass the type in as a generic:
```ts
// old
app.get<{ query: ProductQuery }, ProductWithId[]>(
  '/products',
  async (reqCtx) => {
    const { category, minPrice, maxPrice } = reqCtx.valid.req.query;
    // ...
  },
  {
    validation: { req: { query: ProductQuerySchema }, res: { body: ProductListSchema } },
  }
);

// new
app.get(
  '/products',
  async (reqCtx) => {
    const { category, minPrice, maxPrice } = reqCtx.valid.req.query;
    // ...
  },
  {
    validation: { req: { query: ProductQuerySchema }, res: { body: ProductListSchema } },
  }
);

```
- Added ability to use a generic with no validation:
```ts

app.get<ProductWithId>(
  '/product-generic-no-validation',
  async () => {
    return { id: '1234', name: 'Test', price: 10, category: 'Test' };
  }
);
```
- There is a tradeoff: tou cannot use the generic and the type inference from the validation object together. If you don't want to do response validation (a reasonable use case as it has a performance impact) then you must use `satisfies`:


```typescript
app.get('/products-no-res-val', (reqCtx) => {
  const product = reqCtx.valid.req.body;
  return { id: '123', ...product } satisfies ProductWithId;
}, {
  validation: {
    req: {
      body: ProductSchema
    }
  }
});
```
For a longer explanation see [appendix](#appendix).
- The `reqCtx.valid.req` and `reqCtx.valid.res` fields still work as before, except we have loosened the type for `req.valid.req.query` to support types other than string as values.

```ts
export const ProductQuerySchemaStrict = z.object({
  category: z.string().optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
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
      // no need for `parseFloat` anymore  
      products = products.filter(p => p.price >= minPrice);
    }
    if (maxPrice) {
      products = products.filter(p => p.price <= maxPrice);
    }

    return products;
  },
  {
    validation: { req: { query: ProductQuerySchema }, res: { body: ProductListSchema } },
  }
);
```

### Method overloads

The price of this simplified public API is a large increase in the number of method overlaods we now have:

1. (path, handler) — untyped
2. (path, middleware[], handler) — untyped with middleware
3. (path) — decorator
4. (path, middleware[]) — decorator with middleware
5. <TResBody>(path, handler) — typed response, no validation
6. <TResBody>(path, middleware[], handler) — typed response with middleware
7. <V>(path, handler, { validation }) — full inference from schemas
8. <V>(path, middleware[], handler, { validation }) — full inference with middleware

### Appendix

TypeScript doesn't support partial generic inference. When a function has multiple type parameters like
<TResBody, V>, the caller must either:

- Provide all type arguments explicitly: app.get<MyResponse, typeof validation>(...)
- Provide none and let TypeScript infer all of them

There's no way to write app.get<MyResponse>(...) and have TypeScript infer only V from the validation 
config while taking TResBody from the explicit argument. It's all or nothing.

We tried adding <TResBody, V extends ValidationConfig> overloads to support this, but it broke compile-
time response type safety. When no generics are provided, TypeScript still attempts to match the 
<TResBody, V> overload by defaulting TResBody to HandlerResponse (the widest type), which accepts any 
return value. This means the <V> overload — which correctly infers and enforces the response type from 
the schema — gets bypassed, and return type mismatches are silently accepted.
