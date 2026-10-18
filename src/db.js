const STORAGE_KEY = 'petshop_db_v1';

const defaultProducts = [
  { id: 1, sku: 'DF-204', name: 'Dog Food Bag', brand: 'PetCare', type: 'Food', cost: '500', price: '540', stock: 78, status: 'Healthy' },
  { id: 2, sku: 'CL-118', name: 'Cat Litter', brand: 'PetCare', type: 'Care', cost: '260', price: '330', stock: 34, status: 'Low' },
  { id: 3, sku: 'PS-088', name: 'Pet Shampoo', brand: 'FreshPaw', type: 'Care', cost: '160', price: '220', stock: 22, status: 'Low' },
  { id: 4, sku: 'BS-366', name: 'Bird Seed', brand: 'BirdJoy', type: 'Food', cost: '140', price: '190', stock: 47, status: 'Healthy' },
  { id: 5, sku: 'PC-770', name: 'Pet Collar', brand: 'SafePet', type: 'Accessory', cost: '260', price: '320', stock: 50, status: 'Healthy' },
];

const defaultData = {
  products: defaultProducts,
};

export function getDb() {
  if (typeof window === 'undefined') {
    return defaultData;
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultData));
    return defaultData;
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      ...defaultData,
      ...parsed,
      products: Array.isArray(parsed.products) && parsed.products.length ? parsed.products : defaultProducts,
    };
  } catch (error) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultData));
    return defaultData;
  }
}

export function saveDb(data) {
  if (typeof window === 'undefined') {
    return data;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

export function getProducts() {
  return getDb().products;
}

export function addProduct(product) {
  const db = getDb();
  const nextProduct = {
    id: Date.now(),
    sku: product.sku || `SKU-${Date.now()}`,
    name: product.name || 'New Product',
    brand: product.brand || 'Jomich Petshop',
    type: product.type || 'General',
    cost: product.cost || '0',
    price: product.price || '0',
    stock: Number(product.stock || 0),
    status: Number(product.stock || 0) <= 25 ? 'Low' : 'Healthy',
  };

  const updatedDb = {
    ...db,
    products: [nextProduct, ...db.products],
  };

  saveDb(updatedDb);
  return nextProduct;
}

export function updateProduct(productId, product) {
  const db = getDb();
  const updatedProducts = db.products.map((item) => {
    if (String(item.id) === String(productId)) {
      return {
        ...item,
        ...product,
        stock: Number(product.stock || item.stock || 0),
        price: Number(product.price || item.price || 0),
        cost: Number(product.cost || item.cost || 0),
        status: Number(product.stock || item.stock || 0) <= 25 ? 'Low' : 'Healthy',
      };
    }
    return item;
  });

  const updatedDb = {
    ...db,
    products: updatedProducts,
  };

  saveDb(updatedDb);
  return updatedProducts;
}

export function deleteProduct(productId) {
  const db = getDb();
  const updatedProducts = db.products.filter((item) => String(item.id) !== String(productId));
  const updatedDb = {
    ...db,
    products: updatedProducts,
  };

  saveDb(updatedDb);
  return updatedProducts;
}

export function getInventoryStats(products = getProducts()) {
  const totalStock = products.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const lowStock = products.filter((item) => Number(item.stock || 0) <= 25).length;
  const totalProducts = products.length;

  return {
    totalStock,
    lowStock,
    totalProducts,
  };
}
