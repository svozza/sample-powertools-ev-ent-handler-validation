import { describe, it, expect, beforeAll } from 'vitest';
import { getApiUrl } from './helpers';
import type { Product, ProductWithId } from '../lambda/schemas';

let API_URL: string;

beforeAll(async () => {
  API_URL = await getApiUrl();
});

describe('Products API E2E', () => {
  it('should reject invalid product with negative price', async () => {
    const response = await fetch(`${API_URL}products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Product',
        price: -10,
        category: 'Test',
      }),
    });

    expect(response.status).toBe(422);
    const data = await response.json() as { error: string; details: { issues: Array<{ path: string[]; message: string }> } };
    expect(data.error).toBe('RequestValidationError');
    expect(data.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['price'],
          message: expect.stringContaining('Too small'),
        }),
      ])
    );
  });

  it('should create three products and retrieve them all', async () => {
    const products: Product[] = [
      { name: 'Product 1', price: 10, category: 'Test' },
      { name: 'Product 2', price: 20, category: 'Test' },
      { name: 'Product 3', price: 30, category: 'Test' },
    ];

    const responses = await Promise.all(
      products.map(product =>
        fetch(`${API_URL}products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product),
        })
      )
    );

    responses.forEach(response => expect(response.status).toBe(200));
    
    const createdProducts = await Promise.all(responses.map(r => r.json())) as ProductWithId[];
    const createdIds = createdProducts.map(p => p.id);

    const getResponse = await fetch(`${API_URL}products`);
    expect(getResponse.status).toBe(200);
    const allProducts = await getResponse.json() as ProductWithId[];
    
    expect(allProducts.length).toBeGreaterThanOrEqual(3);
    
    for (let i = 0; i < products.length; i++) {
      expect(allProducts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: createdIds[i],
            name: products[i].name,
            price: products[i].price,
            category: products[i].category,
          }),
        ])
      );
    }

    await Promise.all(
      createdIds.map(id => fetch(`${API_URL}products/${id}`, { method: 'DELETE' }))
    );
  });

  it('should filter products by query params', async () => {
    const products: Product[] = [
      { name: 'Cheap Electronics', price: 15, category: 'Electronics' },
      { name: 'Expensive Electronics', price: 150, category: 'Electronics' },
      { name: 'Cheap Furniture', price: 25, category: 'Furniture' },
    ];

    const responses = await Promise.all(
      products.map(product =>
        fetch(`${API_URL}products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product),
        })
      )
    );

    const createdProducts = await Promise.all(responses.map(r => r.json())) as ProductWithId[];
    const createdIds = createdProducts.map(p => p.id);

    const categoryResponse = await fetch(`${API_URL}products?category=Electronics`);
    const categoryProducts = await categoryResponse.json() as ProductWithId[];
    const ourElectronics = categoryProducts.filter(p => createdIds.includes(p.id));
    expect(ourElectronics.length).toBe(2);

    const priceResponse = await fetch(`${API_URL}products?minPrice=20&maxPrice=100`);
    const priceProducts = await priceResponse.json() as ProductWithId[];
    const ourPriceFiltered = priceProducts.filter(p => createdIds.includes(p.id));
    expect(ourPriceFiltered.length).toBe(1);
    expect(ourPriceFiltered[0].name).toBe('Cheap Furniture');

    await Promise.all(
      createdIds.map(id => fetch(`${API_URL}products/${id}`, { method: 'DELETE' }))
    );
  });

  it('should have validated response body available in middleware', async () => {
    const response = await fetch(`${API_URL}res-body`);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('x-exists')).toBe('{"hasResBody":true}');
    
    const body = await response.json() as { hasResBody: boolean };
    expect(body.hasResBody).toBe(true);
  });

  it('should validate required headers', async () => {
    const responseWithoutHeader = await fetch(`${API_URL}protected`);
    expect(responseWithoutHeader.status).toBe(422);
    const errorData = await responseWithoutHeader.json() as { error: string; details: { issues: Array<{ path: string[]; message: string }> } };
    expect(errorData.error).toBe('RequestValidationError');
    expect(errorData.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['x-api-key'],
        }),
      ])
    );

    const responseWithHeader = await fetch(`${API_URL}protected`, {
      headers: { 'x-api-key': 'test-key-123' },
    });
    expect(responseWithHeader.status).toBe(200);
    const data = await responseWithHeader.json() as { message: string };
    expect(data.message).toBe('Authenticated with test-key-123');
  });
});
