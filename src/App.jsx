import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, BrowserQRCodeReader } from '@zxing/browser';
import { addProduct, deleteProduct, getInventoryMovements, getInventoryStats, getProducts, getSales, recordSale, updateProduct } from './db';

const paw = '🐾';
const dog = '🐶';
const cat = '🐱';

const thumbnailScreens = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'transaction', label: 'Transaction' },
  { id: 'settings', label: 'Setting' },
  { id: 'profile', label: 'Profile' },
  { id: 'add-product', label: 'Add Item' },
];

const sideMenu = [
  { id: 'dashboard', name: 'Dashboard', icon: '🏠' },
  { id: 'products', name: 'Products', icon: '🧾' },
  { id: 'sales', name: 'Sales', icon: '📊' },
  { id: 'inventory', name: 'Inventory', icon: '📦' },
  { id: 'reports', name: 'Reports', icon: '📈' },
  { id: 'workspace-settings', name: 'Settings', icon: '⚙️' },
];

const stockTable = [
  { name: 'Dog Food', sku: 'DF-204', stock: '78', price: '₱540', status: 'Healthy' },
  { name: 'Cat Litter', sku: 'CL-118', stock: '34', price: '₱330', status: 'Low' },
  { name: 'Pet Shampoo', sku: 'PS-088', stock: '22', price: '₱220', status: 'Low' },
  { name: 'Bird Seed', sku: 'BS-366', stock: '47', price: '₱190', status: 'Healthy' },
];

const notificationOptions = [
  { key: 'lowStockAlerts', label: 'Low Stock Alerts' },
  { key: 'pushNotifications', label: 'Push Notifications' },
  { key: 'weeklyReports', label: 'Weekly Reports' },
  { key: 'emailNotifications', label: 'Email Notifications' },
];

const staffMenu = [
  { id: 'dashboard-staff', name: 'Products', icon: '🧾' },
  { id: 'inventory-staff', name: 'Inventory', icon: '📦' },
  { id: 'low-stock-staff', name: 'Low Stock', icon: '⚠️' },
];

function isSameDay(firstDate, secondDate) {
  return firstDate.getFullYear() === secondDate.getFullYear()
    && firstDate.getMonth() === secondDate.getMonth()
    && firstDate.getDate() === secondDate.getDate();
}

function filterSalesByPeriod(sales, period) {
  const now = new Date();
  return sales.filter((sale) => {
    const saleDate = new Date(sale.date);
    if (period === 'Daily') return isSameDay(saleDate, now);
    if (period === 'Monthly') return saleDate.getFullYear() === now.getFullYear() && saleDate.getMonth() === now.getMonth();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    return saleDate >= weekStart && saleDate < weekEnd;
  });
}

function buildChartData(sales, period) {
  const now = new Date();
  let buckets = [];

  if (period === 'Daily') {
    buckets = Array.from({ length: 8 }, (_, index) => ({
      label: `${String(index * 3).padStart(2, '0')}:00`,
      matches: (date) => isSameDay(date, now) && date.getHours() >= index * 3 && date.getHours() < (index + 1) * 3,
    }));
  } else if (period === 'Weekly') {
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    buckets = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return { label: date.toLocaleDateString(undefined, { weekday: 'short' }), matches: (saleDate) => isSameDay(date, saleDate) };
    });
  } else {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const weekCount = Math.ceil(daysInMonth / 7);
    buckets = Array.from({ length: weekCount }, (_, index) => ({
      label: `Week ${index + 1}`,
      matches: (date) => date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && Math.floor((date.getDate() - 1) / 7) === index,
    }));
  }

  return buckets.map((bucket) => ({
    label: bucket.label,
    value: sales.reduce((total, sale) => total + (bucket.matches(new Date(sale.date)) ? Number(sale.total || 0) : 0), 0),
  }));
}

function PasswordField({ label, value, onChange, placeholder, visible, onToggle }) {
  return (
    <div className="field password-field-wrap">
      {label && <label>{label}</label>}
      <div className="password-wrapper">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          readOnly={onChange === undefined}
        />
        <button type="button" className="eye-toggle eye-inner" onClick={onToggle} aria-label="Toggle password visibility">
          {visible ? '🙈' : '👁️'}
        </button>
        <button type="button" className="eye-toggle eye-outside" onClick={onToggle} aria-label="Toggle password visibility outside">
          {visible ? '🙈' : '👁️'}
        </button>
      </div>
    </div>
  );
}

function AddProductScreen({ onBack, onSaveProduct, initialProduct = null }) {
  const [product, setProduct] = useState({
    sku: initialProduct?.sku || '',
    barcode: initialProduct?.barcode || '',
    name: initialProduct?.name || '',
    brand: initialProduct?.brand || '',
    type: initialProduct?.type || 'New Item',
    cost: initialProduct?.cost || '',
    price: initialProduct?.price || '',
    stock: initialProduct?.stock || '',
  });
  const [scannerMode, setScannerMode] = useState(null);
  const [scanError, setScanError] = useState('');
  const videoRef = useRef(null);
  const scannerControlsRef = useRef(null);

  const updateField = (field) => (event) => {
    setProduct((prev) => ({ ...prev, [field]: event.target.value }));
  };

  useEffect(() => {
    if (!scannerMode || !videoRef.current) return undefined;

    let cancelled = false;
    const reader = scannerMode === 'qr' ? new BrowserQRCodeReader() : new BrowserMultiFormatReader();
    reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } } },
      videoRef.current,
      (result, _error, controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        scannerControlsRef.current = controls;
        if (result) {
          setProduct((current) => ({ ...current, barcode: result.getText() }));
          setScanError('');
          controls.stop();
          setScannerMode(null);
        }
      },
    ).then((controls) => {
      if (cancelled) controls.stop();
      else scannerControlsRef.current = controls;
    }).catch((error) => {
      if (!cancelled) setScanError(error instanceof Error ? error.message : 'Unable to access the camera.');
    });

    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [scannerMode]);

  const handleSave = () => {
    if (!product.name.trim() || !product.sku.trim()) {
      return;
    }

    onSaveProduct(product);
    onBack('dashboard');
  };

  return (
    <div className="prototype-shell">
      <div className="mobile-frame product-screen">
        <div className="product-topbar">
          <div className="product-title">Add New Item</div>
          <button className="close-mini" onClick={() => onBack('dashboard')}>×</button>
        </div>

        <div className="scanner-row">
          <button className="scan-btn" onClick={() => { setScanError(''); setScannerMode('qr'); }}>Scan QR code</button>
          <button className="scan-btn" onClick={() => { setScanError(''); setScannerMode('barcode'); }}>Scan barcode</button>
        </div>

        <div className="product-form">
          <div className="row-two">
            <div className="field small-field">
              <label>SKU</label>
              <input type="text" placeholder="SKU" value={product.sku} onChange={updateField('sku')} />
            </div>
            <div className="field large-field">
              <label>Name</label>
              <input type="text" placeholder="Product name" value={product.name} onChange={updateField('name')} />
            </div>
          </div>

          <div className="row-two">
            <div className="field small-field">
              <label>Barcode</label>
              <input type="text" placeholder="Scan or enter barcode" value={product.barcode} onChange={updateField('barcode')} />
            </div>
            <div className="field small-field">
              <label>Brand</label>
              <input type="text" placeholder="Brand" value={product.brand} onChange={updateField('brand')} />
            </div>
            <div className="field small-field">
              <label>Type</label>
              <select value={product.type} onChange={updateField('type')}>
                <option>New Item</option>
                <option>Food</option>
                <option>Care</option>
                <option>Accessory</option>
              </select>
            </div>
          </div>

          <div className="row-two">
            <div className="field small-field">
              <label>Cost</label>
              <input type="number" placeholder="0.00" value={product.cost} onChange={updateField('cost')} />
            </div>
            <div className="field small-field">
              <label>Price</label>
              <input type="number" placeholder="0.00" value={product.price} onChange={updateField('price')} />
            </div>
            <div className="field small-field">
              <label>Initial Stock</label>
              <input type="number" placeholder="0" value={product.stock} onChange={updateField('stock')} />
            </div>
            <div className="field small-field">
              <label>Pricing</label>
              <select defaultValue="Fixed">
                <option>Fixed</option>
                <option>Variable</option>
              </select>
            </div>
          </div>

          <button className="product-save" onClick={handleSave}>{initialProduct ? 'Update Item' : 'Save Item'}</button>
        </div>

        {scannerMode && (
          <div className="scanner-backdrop">
            <section className="scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
              <div className="scanner-dialog-header">
                <h3 id="scanner-title">{scannerMode === 'qr' ? 'Scan QR code' : 'Scan barcode'}</h3>
                <button className="close-mini" aria-label="Close scanner" onClick={() => setScannerMode(null)}>×</button>
              </div>
              <video ref={videoRef} className="scanner-video" muted playsInline />
              <p className="scanner-message" aria-live="polite">
                {scanError || 'Point the camera at a code.'}
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function ReceiptScreen({ onBack, role, sale }) {
  const subtotal = sale?.total || 0;

  return (
    <div className="prototype-shell">
      <div className="mobile-frame receipt-screen">
        <div className="receipt-header">
          <div className="mini-paw">{paw}</div>
          <div className="receipt-brand">Jomich Petshop</div>
          <small>Official Receipt</small>
        </div>

        <div className="receipt-card">
          <div className="receipt-meta">
            <span>Invoice #{sale?.invoice || 'Not available'}</span>
            <span>{sale ? new Date(sale.date).toLocaleString() : 'No sale recorded'}</span>
          </div>

          {(sale?.items || []).map((item) => (
            <div className="receipt-row" key={item.productId}>
              <div>
                <strong>{item.name}</strong>
                <small>{item.quantity} pcs</small>
              </div>
              <span>₱{(item.quantity * item.price).toLocaleString()}</span>
            </div>
          ))}

          <div className="receipt-summary">
            <div><span>Subtotal</span><strong>₱{subtotal.toLocaleString()}</strong></div>
            <div className="receipt-total"><span>Total</span><strong>₱{subtotal.toLocaleString()}</strong></div>
          </div>

          <div className="receipt-actions">
            <button className="primary-btn secondary" onClick={() => window.print()}>Print Receipt</button>
            <button className="mini-action" onClick={() => onBack(role === 'staff' ? 'dashboard-staff' : 'dashboard')}>Back</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TransactionScreen({ products, onSave, onBack }) {
  const availableProducts = products.filter((product) => Number(product.stock || 0) > 0);
  const [productId, setProductId] = useState(availableProducts[0]?.id || '');
  const [quantity, setQuantity] = useState('1');
  const selectedProduct = availableProducts.find((product) => String(product.id) === String(productId));
  const total = Number(quantity || 0) * Number(selectedProduct?.price || 0);

  const submitSale = () => {
    if (onSave(productId, Number(quantity))) return;
    window.alert('Enter a valid quantity that is available in stock.');
  };

  return (
    <div className="prototype-shell">
      <div className="mobile-frame transaction">
        <div className="transaction-header"><span className="mini-paw">{paw}</span><h2>New Transaction</h2></div>
        <div className="transaction-form">
          <div className="field">
            <label htmlFor="sale-product">Product</label>
            <select id="sale-product" value={productId} onChange={(event) => setProductId(event.target.value)} disabled={availableProducts.length === 0}>
              {availableProducts.length === 0 && <option value="">No stock available</option>}
              {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.stock} in stock)</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sale-quantity">Quantity</label>
            <input id="sale-quantity" type="number" min="1" max={selectedProduct?.stock || 1} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </div>
          <div className="transaction-total"><span>Total</span><strong>₱{total.toLocaleString()}</strong></div>
          <button className="primary-btn secondary" onClick={submitSale} disabled={!selectedProduct || Number(quantity) < 1 || Number(quantity) > Number(selectedProduct.stock || 0)}>Record sale</button>
          <button className="mini-action" onClick={onBack}>Back to sales</button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceScreen({ screen, role, products, sales, inventoryMovements, salesSummary, chartPeriod, chartData, onPeriodChange, onNavigate, onAddProduct, onEditProduct, onDeleteProduct, onLogout }) {
  const [pdfTools, setPdfTools] = useState(null);
  const isStaff = role === 'staff';
  const menu = isStaff ? staffMenu : sideMenu;
  const titles = {
    products: 'Products',
    sales: 'Sales',
    inventory: 'Inventory',
    reports: 'Reports',
    'workspace-settings': 'Settings',
    'inventory-staff': 'Inventory',
    'low-stock-staff': 'Low Stock',
  };
  const lowStockOnly = screen === 'low-stock-staff';
  const visibleProducts = products.filter((product) => !lowStockOnly || Number(product.stock || 0) <= 25);
  const periodSales = useMemo(() => filterSalesByPeriod(sales, chartPeriod), [sales, chartPeriod]);

  useEffect(() => {
    if (screen !== 'reports') return undefined;

    let active = true;
    Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([pdfModule, tableModule]) => {
      if (active) setPdfTools({ jsPDF: pdfModule.jsPDF, autoTable: tableModule.default });
    });

    return () => { active = false; };
  }, [screen]);

  const downloadReport = () => {
    if (!pdfTools) return;
    const { jsPDF, autoTable } = pdfTools;
    const report = new jsPDF();
    const date = new Date();
    const fileDate = date.toISOString().slice(0, 10);
    const formatValue = (value) => String(value).replaceAll('₱', 'PHP ');

    report.setFontSize(19);
    report.text('Jomich Petshop Report', 14, 18);
    report.setFontSize(10);
    report.text(`Generated ${date.toLocaleString()}`, 14, 25);
    autoTable(report, {
      startY: 32,
      head: [['Sales metric', 'Value', 'Trend']],
      body: salesSummary.map((item) => [item.label, formatValue(item.value), item.trend]),
      headStyles: { fillColor: [24, 37, 63] },
      styles: { fontSize: 9 },
    });

    const inventoryTop = report.lastAutoTable.finalY + 12;
    report.setFontSize(14);
    report.text('Product inventory', 14, inventoryTop);
    autoTable(report, {
      startY: inventoryTop + 5,
      head: [['Product', 'SKU', 'Barcode', 'Stock', 'Price', 'Status']],
      body: products.map((item) => [
        item.name,
        item.sku,
        item.barcode || '-',
        String(Number(item.stock || 0)),
        `PHP ${Number(item.price || 0).toLocaleString()}`,
        Number(item.stock || 0) <= 25 ? 'Low' : 'Healthy',
      ]),
      headStyles: { fillColor: [24, 37, 63] },
      styles: { fontSize: 8 },
    });

    const salesTop = report.lastAutoTable.finalY + 12;
    report.setFontSize(14);
    report.text('Sales transactions', 14, salesTop);
    autoTable(report, {
      startY: salesTop + 5,
      head: [['Date', 'Invoice', 'Items', 'Total']],
      body: sales.map((sale) => [
        new Date(sale.date).toLocaleString(),
        sale.invoice,
        sale.items.map((item) => `${item.name} x${item.quantity}`).join(', '),
        `PHP ${Number(sale.total || 0).toLocaleString()}`,
      ]),
      headStyles: { fillColor: [24, 37, 63] },
      styles: { fontSize: 8 },
    });

    report.save(`jomich-petshop-report-${fileDate}.pdf`);
  };

  return (
    <div className="prototype-shell">
      <div className={`mobile-frame dashboard-panel admin-dashboard ${isStaff ? 'staff-dashboard' : ''}`}>
        <aside className="sidebar-panel">
          <div className="sidebar-brand">
            <span className="brand-pill"><img src="/pet-shop-mascot.svg" alt="" /></span>
            <div>
              <strong>{isStaff ? 'Staff Panel' : 'Jomich Petshop'}</strong>
              <small>{isStaff ? 'Inventory' : 'Admin'}</small>
            </div>
          </div>
          <nav className="sidebar-nav" aria-label="Main navigation">
            {menu.map((item) => (
              <button key={item.id} className={screen === item.id ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate(item.id)}>
                <span>{item.icon}</span>
                {item.name}
              </button>
            ))}
          </nav>
          {!isStaff && (
            <div className="sidebar-summary">
              <span>Monthly target</span>
              <strong>₱80,000</strong>
              <small>72% of goal</small>
            </div>
          )}
          <button className="sidebar-signout" onClick={onLogout}>
            <span aria-hidden="true">↪</span> Sign out
          </button>
        </aside>
        <main className="dashboard-main">
          <header className="dashboard-topbar">
            <div>
              <div className="dashboard-kicker">{isStaff ? 'Staff workspace' : 'Management'}</div>
              <h2>{titles[screen]}</h2>
            </div>
            <div className="dashboard-actions">
              {screen === 'workspace-settings' && <button className="mini-action" onClick={() => onNavigate('dashboard')}>← Dashboard</button>}
              {screen === 'reports' && <button className="add-item-btn" onClick={downloadReport} disabled={!pdfTools}>{pdfTools ? 'Download PDF' : 'Preparing PDF...'}</button>}
              {(screen === 'products' || screen === 'inventory' || screen === 'inventory-staff' || lowStockOnly) && (
                <button className="add-item-btn" onClick={onAddProduct}>+ Add product</button>
              )}
              {screen === 'sales' && !isStaff && <button className="add-item-btn" onClick={() => onNavigate('transaction')}>+ New transaction</button>}
            </div>
          </header>

          {(screen === 'products' || screen === 'inventory' || screen === 'inventory-staff' || lowStockOnly) && (
            <div className="section-card">
              <div className="section-head"><span>{lowStockOnly ? 'Items needing reorder' : 'Product inventory'}</span></div>
              <div className="table-scroll">
                <table className="product-table">
                  <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Price</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {visibleProducts.map((item) => (
                      <tr key={item.sku || item.id}>
                        <td>{item.name}</td><td>{item.sku}</td><td>{Number(item.stock || 0)}</td><td>₱{Number(item.price || 0)}</td>
                        <td><span className={Number(item.stock || 0) <= 25 ? 'status-pill low' : 'status-pill'}>{Number(item.stock || 0) <= 25 ? 'Low' : 'Healthy'}</span></td>
                        <td className="action-cell">{isStaff ? 'View only' : <><button className="table-action edit" onClick={() => onEditProduct(item)}>Edit</button><button className="table-action delete" onClick={() => onDeleteProduct(item.id)}>Delete</button></>}</td>
                      </tr>
                    ))}
                    {visibleProducts.length === 0 && <tr><td colSpan="6">No products need attention.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {screen === 'inventory' && !isStaff && (
            <div className="section-card">
              <div className="section-head"><span>Inventory movement record</span></div>
              <div className="table-scroll">
                <table className="product-table">
                  <thead><tr><th>Date</th><th>Product</th><th>SKU</th><th>Change</th><th>Type</th><th>Reference</th></tr></thead>
                  <tbody>
                    {inventoryMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{new Date(movement.date).toLocaleString()}</td><td>{movement.product}</td><td>{movement.sku}</td>
                        <td className="stock-change negative">{movement.change}</td><td>{movement.type}</td><td>{movement.reference}</td>
                      </tr>
                    ))}
                    {inventoryMovements.length === 0 && <tr><td colSpan="6">No inventory movements recorded.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {screen === 'sales' && !isStaff && (
            <>
              <div className="summary-grid">
                {salesSummary.map((item) => <div className="stat-card" key={item.label}><span className="stat-label">{item.label}</span><strong>{item.value}</strong><small>{item.trend}</small></div>)}
              </div>
              <div className="analytics-box big-chart-box">
                <div className="section-head"><span>Sales performance</span><div className="period-switch" role="group" aria-label="Sales period">
                  {['Daily', 'Weekly', 'Monthly'].map((period) => <button key={period} type="button" className={chartPeriod === period ? 'active' : ''} aria-pressed={chartPeriod === period} onClick={() => onPeriodChange(period)}>{period}</button>)}
                </div></div>
                <div className="chart-values">{chartData.map((item) => <span key={item.label}>₱{item.value.toLocaleString()}</span>)}</div>
                <div className="big-chart" role="img" aria-label={`${chartPeriod} sales performance chart`}><div className="chart-grid-lines"/><div className="chart-columns">
                  {chartData.map((item) => <span key={item.label} title={`${item.label}: ₱${item.value.toLocaleString()}`} style={{ height: `${Math.max(item.value / Math.max(...chartData.map((entry) => entry.value), 1) * 100, 3)}%` }} />)}
                </div></div>
                <div className="chart-labels">{chartData.map((item) => <span key={item.label}>{item.label}</span>)}</div>
              </div>
              <div className="section-card"><div className="section-head"><span>Sales transaction record</span><button onClick={() => onNavigate('receipt')}>Preview receipt</button></div>
                <div className="table-scroll"><table className="product-table"><thead><tr><th>Date</th><th>Invoice</th><th>Items</th><th>Total</th></tr></thead><tbody>
                  {periodSales.map((sale) => <tr key={sale.id}><td>{new Date(sale.date).toLocaleString()}</td><td>{sale.invoice}</td><td>{sale.items.map((item) => `${item.name} x${item.quantity}`).join(', ')}</td><td>₱{Number(sale.total || 0).toLocaleString()}</td></tr>)}
                  {periodSales.length === 0 && <tr><td colSpan="4">No sales recorded for this period.</td></tr>}
                </tbody></table></div>
              </div>
            </>
          )}

          {screen === 'reports' && !isStaff && (
            <><div className="summary-grid">{salesSummary.map((item) => <div className="stat-card" key={item.label}><span className="stat-label">{item.label}</span><strong>{item.value}</strong><small>{item.trend}</small></div>)}</div>
              <div className="analytics-box big-chart-box"><div className="section-head"><span>Sales performance</span></div><div className="big-chart"><div className="chart-grid-lines"/><div className="chart-columns">{chartData.map((item) => <span key={item.label} style={{ height: `${Math.max(item.value / Math.max(...chartData.map((entry) => entry.value), 1) * 100, 3)}%` }}/>)}</div></div></div>
            </>
          )}

          {screen === 'workspace-settings' && !isStaff && (
            <div className="section-card menu-stack workspace-settings">
              <button className="settings-btn" onClick={() => onNavigate('profile')}>Profile</button>
              <button className="settings-btn" onClick={() => onNavigate('notifications')}>Notifications</button>
              <button className="settings-btn" onClick={() => onNavigate('legal')}>Legal</button>
              <button className="settings-btn" onClick={() => onNavigate('backup')}>Back Up</button>
              <button className="settings-btn" onClick={() => onNavigate('clear-cache')}>Clear Cache</button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState('signin');
  const [selectedRole, setSelectedRole] = useState('admin');
  const [showPasswordSignup, setShowPasswordSignup] = useState(false);
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [chartPeriod, setChartPeriod] = useState('Weekly');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [notifications, setNotifications] = useState(() => {
    const defaults = Object.fromEntries(notificationOptions.map(({ key }) => [key, true]));
    try {
      const stored = window.localStorage.getItem('petshop_notification_settings_v1');
      return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    } catch {
      return defaults;
    }
  });
  const [products, setProducts] = useState(() => getProducts());
  const [sales, setSales] = useState(() => getSales());
  const [inventoryMovements, setInventoryMovements] = useState(() => getInventoryMovements());
  const [editingProduct, setEditingProduct] = useState(null);

  const inventoryStats = useMemo(() => getInventoryStats(products), [products]);
  const staffSummary = [
    { label: 'Products', value: String(inventoryStats.totalProducts), trend: 'in catalog' },
    { label: 'Inventory', value: String(inventoryStats.totalStock), trend: 'units on hand' },
    { label: 'Low Stock', value: String(inventoryStats.lowStock), trend: 'need attention' },
    { label: 'Stock Checks', value: 'Available', trend: 'inventory access' },
  ];

  const chartData = useMemo(() => buildChartData(sales, chartPeriod), [sales, chartPeriod]);
  const salesSummary = useMemo(() => {
    const selectedSales = filterSalesByPeriod(sales, chartPeriod);
    const selectedTotal = selectedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    return [
    { label: `Sales ${chartPeriod}`, value: `₱${selectedTotal.toLocaleString()}`, trend: 'recorded sales' },
    { label: `Transactions ${chartPeriod}`, value: String(selectedSales.length), trend: 'recorded orders' },
    { label: 'Inventory', value: String(inventoryStats.totalStock), trend: '+6.7%' },
    { label: 'Average sale', value: `₱${(selectedSales.length ? selectedTotal / selectedSales.length : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, trend: 'per transaction' },
    ];
  }, [chartPeriod, inventoryStats.totalStock, sales]);

  const topProducts = useMemo(() => products.slice(0, 4).map((product) => ({
    name: product.name,
    stock: Number(product.stock || 0),
    price: `₱${Number(product.price || 0)}`,
  })), [products]);

  const handleSaveProduct = (product) => {
    if (editingProduct) {
      updateProduct(editingProduct.id, {
        ...product,
        stock: Number(product.stock || 0),
        price: Number(product.price || 0),
        cost: Number(product.cost || 0),
      });
      setProducts((prev) => prev.map((item) => String(item.id) === String(editingProduct.id)
        ? { ...item, ...product, stock: Number(product.stock || 0), price: Number(product.price || 0), cost: Number(product.cost || 0) }
        : item));
      setEditingProduct(null);
      return;
    }

    const savedProduct = addProduct({
      ...product,
      stock: Number(product.stock || 0),
      price: Number(product.price || 0),
      cost: Number(product.cost || 0),
    });
    setProducts((prev) => [savedProduct, ...prev]);
  };

  const handleDeleteProduct = (productId) => {
    deleteProduct(productId);
    setProducts((prev) => prev.filter((item) => String(item.id) !== String(productId)));
  };

  const handleRecordSale = (productId, quantity) => {
    const result = recordSale(productId, quantity);
    if (!result) return false;
    setProducts(result.products);
    setSales((previous) => [result.sale, ...previous]);
    setInventoryMovements((previous) => [result.movement, ...previous]);
    setScreen('sales');
    return true;
  };

  const handleLogout = () => {
    setEditingProduct(null);
    setSelectedRole('admin');
    setScreen('signin');
  };

  const startVerification = () => {
    setVerificationCode('');
    setVerificationError('');
    setVerificationMessage('');
    setScreen('verify');
  };

  const handleVerify = () => {
    if (verificationCode !== '1234') {
      setVerificationError('That code is not correct. Check it and try again.');
      setVerificationMessage('');
      return;
    }

    setVerificationError('');
    setScreen(selectedRole === 'staff' ? 'dashboard-staff' : 'dashboard');
  };

  const handleResendCode = () => {
    setVerificationCode('');
    setVerificationError('');
    setVerificationMessage('A new demo code is ready: 1234');
  };

  const toggleNotification = (key) => {
    const updated = { ...notifications, [key]: !notifications[key] };
    setNotifications(updated);
    try {
      window.localStorage.setItem('petshop_notification_settings_v1', JSON.stringify(updated));
    } catch {
      return;
    }
  };

  const startEditProduct = (product) => {
    setEditingProduct(product);
    setScreen('add-product');
  };

  const renderScreen = () => {
    switch (screen) {
      case 'add-product':
        return (
          <AddProductScreen
            onBack={(nextScreen) => {
              setEditingProduct(null);
              setScreen(nextScreen === 'dashboard' && selectedRole === 'staff' ? 'dashboard-staff' : nextScreen || (selectedRole === 'staff' ? 'dashboard-staff' : 'dashboard'));
            }}
            onSaveProduct={handleSaveProduct}
            initialProduct={editingProduct}
          />
        );

      case 'products':
      case 'sales':
      case 'inventory':
      case 'reports':
      case 'workspace-settings':
      case 'inventory-staff':
      case 'low-stock-staff':
        return (
          <WorkspaceScreen
            screen={screen}
            role={selectedRole}
            products={products}
            sales={sales}
            inventoryMovements={inventoryMovements}
            salesSummary={salesSummary}
            chartPeriod={chartPeriod}
            chartData={chartData}
            onPeriodChange={setChartPeriod}
            onNavigate={setScreen}
            onAddProduct={() => setScreen('add-product')}
            onEditProduct={startEditProduct}
            onDeleteProduct={handleDeleteProduct}
            onLogout={handleLogout}
          />
        );

      case 'signin':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame">
              <div className="screen-header soft">
                <div className="brand-mark" aria-label="Jomich Petshop brand">
                  <img src="/pet-shop-mascot.svg" alt="Jomich Petshop dog and cat" />
                </div>
                <div className="screen-title">Sign in to continue</div>
                <div className="screen-brand">Jomich Petshop</div>
                <div className="pet-face">{cat}</div>
                <div className="mini-paw">{paw}</div>
              </div>
              <div className="screen-body orange">
                <h2>Log in</h2>
                <div className="field">
                  <label htmlFor="login-identifier">Email or phone number</label>
                  <input
                    id="login-identifier"
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    placeholder="Enter email or phone number"
                    value={loginIdentifier}
                    onChange={(event) => setLoginIdentifier(event.target.value)}
                  />
                </div>
                <PasswordField
                  label="Password"
                  value="**************"
                  visible={showPasswordLogin}
                  onToggle={() => setShowPasswordLogin((v) => !v)}
                  placeholder="Enter your password"
                />
                <div className="role-switch">
                  <button
                    type="button"
                    className={selectedRole === 'admin' ? 'role-button active' : 'role-button'}
                    onClick={() => setSelectedRole('admin')}
                  >
                    Admin
                  </button>
                  <button
                    type="button"
                    className={selectedRole === 'staff' ? 'role-button active' : 'role-button'}
                    onClick={() => setSelectedRole('staff')}
                  >
                    Staff
                  </button>
                </div>
                <button
                  className="primary-btn"
                  onClick={startVerification}
                  disabled={!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginIdentifier.trim()) || loginIdentifier.replace(/\D/g, '').length >= 7)}
                >Login</button>
                <div className="support-text">Forgot Password?</div>
              </div>
            </div>
          </div>
        );

      case 'verify':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame">
              <div className="screen-header soft">
                <div className="screen-title">Verify Your Account</div>
                <div className="screen-brand">Jomich Petshop</div>
                <div className="pet-face">{cat}</div>
                <div className="mini-paw">{paw}</div>
              </div>
              <div className="screen-body orange tall">
                <h2>Account Verification</h2>
                <p>Please enter the four-digit code sent to your email or phone number</p>
                <p className="verification-demo">Demo code: <strong>1234</strong></p>
                <div className="otp-box">
                  <input
                    className="verification-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    value={verificationCode}
                    aria-label="Four-digit verification code"
                    aria-describedby="verification-feedback"
                    onChange={(event) => {
                      setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 4));
                      setVerificationError('');
                    }}
                  />
                </div>
                <button className="primary-btn" onClick={handleVerify} disabled={verificationCode.length !== 4}>Verify</button>
                <div id="verification-feedback" className={verificationError ? 'verification-feedback error' : 'verification-feedback'} aria-live="polite">
                  {verificationError || verificationMessage}
                </div>
                <div className="support-text"><button type="button" onClick={handleResendCode}>Resend Code</button></div>
              </div>
            </div>
          </div>
        );

      case 'dashboard-staff':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame dashboard-panel admin-dashboard staff-dashboard">
              <aside className="sidebar-panel">
                <div className="sidebar-brand">
                  <span className="brand-pill"><img src="/pet-shop-mascot.svg" alt="" /></span>
                  <div>
                    <strong>Staff Panel</strong>
                    <small>Inventory</small>
                  </div>
                </div>

                <nav className="sidebar-nav">
                  {staffMenu.map((item) => (
                    <button key={item.name} className={screen === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setScreen(item.id)}>
                      <span>{item.icon}</span>
                      {item.name}
                    </button>
                  ))}
                </nav>

                <div className="sidebar-summary">
                  <span>Items in stock</span>
                  <strong>{inventoryStats.totalStock}</strong>
                  <small>{inventoryStats.lowStock} low-stock items</small>
                </div>
                <button className="sidebar-signout" onClick={handleLogout}>
                  <span aria-hidden="true">↪</span> Sign out
                </button>
              </aside>

              <main className="dashboard-main">
                <header className="dashboard-topbar">
                  <div>
                    <div className="dashboard-kicker">Access</div>
                    <h2>Products</h2>
                  </div>
                  <div className="dashboard-actions">
                    <button className="mini-action" onClick={() => setScreen('inventory-staff')}>Inventory</button>
                    <button className="add-item-btn" onClick={() => setScreen('add-product')}>+ Add product</button>
                  </div>
                </header>

                <div className="summary-grid">
                  {staffSummary.map((item) => (
                    <div className="stat-card" key={item.label}>
                      <span className="stat-label">{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.trend}</small>
                    </div>
                  ))}
                </div>

                <div className="section-card">
                  <div className="section-head">
                    <span>Inventory Status</span>
                    <button onClick={() => setScreen('add-product')}>Add item</button>
                  </div>
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Stock</th>
                        <th>Price</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((item) => (
                        <tr key={item.sku || item.id}>
                          <td>{item.name}</td>
                          <td>{item.sku}</td>
                          <td>{Number(item.stock || 0)}</td>
                          <td>₱{Number(item.price || 0)}</td>
                          <td><span className={Number(item.stock || 0) <= 25 ? 'status-pill low' : 'status-pill'}>{Number(item.stock || 0) <= 25 ? 'Low' : 'Healthy'}</span></td>
                          <td className="action-cell">
                            <span>View only</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="section-card widget-box stock-widget staff-restricted">
                  <div className="section-head">
                    <span>Low Stock</span>
                    <button onClick={() => setScreen('low-stock-staff')}>Review</button>
                  </div>
                  <div className="stock-list">
                    {products.filter((item) => Number(item.stock || 0) <= 25).map((item) => <span key={item.id}>{item.name} — {Number(item.stock || 0)} left</span>)}
                    {inventoryStats.lowStock === 0 && <span>All products are above the low-stock threshold.</span>}
                  </div>
                </div>
              </main>
            </div>
          </div>
        );

      case 'dashboard':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame dashboard-panel admin-dashboard">
              <aside className="sidebar-panel">
                <div className="sidebar-brand">
                  <span className="brand-pill"><img src="/pet-shop-mascot.svg" alt="" /></span>
                  <div>
                    <strong>Jomich Petshop</strong>
                    <small>Admin</small>
                  </div>
                </div>

                <nav className="sidebar-nav">
                  {sideMenu.map((item) => (
                    <button key={item.name} className={screen === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setScreen(item.id)}>
                      <span>{item.icon}</span>
                      {item.name}
                    </button>
                  ))}
                </nav>

                <div className="sidebar-summary">
                  <span>Monthly target</span>
                  <strong>₱80,000</strong>
                  <small>72% of goal</small>
                </div>
                <button className="sidebar-signout" onClick={handleLogout}>
                  <span aria-hidden="true">↪</span> Sign out
                </button>
              </aside>

              <main className="dashboard-main">
                <header className="dashboard-topbar">
                  <div>
                    <div className="dashboard-kicker">Overview</div>
                    <h2>Dashboard</h2>
                  </div>
                  <div className="dashboard-actions">
                    <button className="mini-action" onClick={() => setScreen('reports')}>Reports</button>
                    <button className="mini-action" onClick={() => setScreen('receipt')}>Receipt</button>
                    <button className="add-item-btn" onClick={() => setScreen('add-product')}>+ Add product</button>
                  </div>
                </header>

                <div className="summary-grid">
                  {salesSummary.map((item) => (
                    <div className="stat-card" key={item.label}>
                      <span className="stat-label">{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.trend}</small>
                    </div>
                  ))}
                </div>

                <div className="analytics-box big-chart-box">
                  <div className="section-head">
                    <span>Sales overview</span>
                    <div className="period-switch" role="group" aria-label="Sales period">
                      {['Daily', 'Weekly', 'Monthly'].map((period) => <button key={period} type="button" className={chartPeriod === period ? 'active' : ''} aria-pressed={chartPeriod === period} onClick={() => setChartPeriod(period)}>{period}</button>)}
                    </div>
                  </div>
                  <div className="big-chart">
                    <div className="chart-grid-lines" />
                    <div className="chart-columns">
                      {chartData.map((item) => <span key={item.label} title={`${item.label}: ₱${item.value.toLocaleString()}`} style={{ height: `${Math.max(item.value / Math.max(...chartData.map((entry) => entry.value), 1) * 100, 3)}%` }} />)}
                    </div>
                  </div>
                </div>

                <div className="bottom-grid">
                  <div className="section-card table-card">
                    <div className="section-head">
                      <span>Product Management</span>
                      <button onClick={() => setScreen('add-product')}>Add item</button>
                    </div>
                    <table className="product-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>SKU</th>
                          <th>Stock</th>
                          <th>Price</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map((item) => (
                          <tr key={item.sku || item.id}>
                            <td>{item.name}</td>
                            <td>{item.sku}</td>
                            <td>{Number(item.stock || 0)}</td>
                            <td>₱{Number(item.price || 0)}</td>
                            <td><span className={Number(item.stock || 0) <= 25 ? 'status-pill low' : 'status-pill'}>{Number(item.stock || 0) <= 25 ? 'Low' : 'Healthy'}</span></td>
                            <td className="action-cell">
                              <button className="table-action edit" onClick={() => startEditProduct(item)}>Edit</button>
                              <button className="table-action delete" onClick={() => handleDeleteProduct(item.id)}>Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="widget-stack">
                    <div className="section-card widget-box stock-widget">
                      <div className="section-head">
                        <span>Stock</span>
                        <button onClick={() => setScreen('inventory')}>Check</button>
                      </div>
                      <div className="stock-ring">
                        <div className="stock-ring-inner">
                          <strong>74%</strong>
                          <span>Safe</span>
                        </div>
                      </div>
                      <div className="stock-list">
                        <span>Low stock: 3 products</span>
                        <span>Reorder soon: 2 items</span>
                      </div>
                    </div>
                  </div>
                </div>
              </main>
            </div>
          </div>
        );

      case 'receipt':
        return <ReceiptScreen onBack={setScreen} role={selectedRole} sale={sales[0]} />;

      case 'transaction':
        return <TransactionScreen products={products} onSave={handleRecordSale} onBack={() => setScreen('sales')} />;

      case 'settings':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame settings">
              <div className="back-row">
                <button className="back-btn" aria-label="Back to dashboard" onClick={() => setScreen('dashboard')}>←</button>
                <div className="section-name">Settings</div>
              </div>
              <div className="settings-header">
                <span className="mini-paw">{paw}</span>
                <h2>Setting</h2>
              </div>
              <div className="menu-stack">
                <button className="settings-btn" onClick={() => setScreen('profile')}>Profile</button>
                <button className="settings-btn" onClick={() => setScreen('notifications')}>Notifications</button>
                <button className="settings-btn" onClick={() => setScreen('legal')}>Legal</button>
                <button className="settings-btn" onClick={() => setScreen('backup')}>Back Up</button>
                <button className="settings-btn" onClick={() => setScreen('clear-cache')}>Clear Cache</button>
              </div>
              <div className="pet-footer">{cat}</div>
            </div>
          </div>
        );

      case 'profile':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame light">
              <div className="back-row">
                <button className="back-btn" aria-label="Back to settings" onClick={() => setScreen('workspace-settings')}>←</button>
                <div className="section-name">Profile</div>
              </div>
              <div className="avatar">{cat}</div>
              <div className="info-label">Your full name:</div>
              <div className="info-box">Jomitch Dela Cruz</div>
              <div className="info-label">Email</div>
              <div className="info-box">jomitchpetshop@gmail.com</div>
              <button className="primary-btn secondary" onClick={() => setScreen('workspace-settings')}>SAVE</button>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame light">
              <div className="back-row">
                <button className="back-btn" aria-label="Back to settings" onClick={() => setScreen('workspace-settings')}>←</button>
                <div className="section-name">Notifications</div>
              </div>
              {notificationOptions.map(({ key, label }) => (
                <div className="toggle-row" key={key}>
                  <span>{label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notifications[key]}
                    aria-label={label}
                    className={notifications[key] ? 'toggle on' : 'toggle'}
                    onClick={() => toggleNotification(key)}
                  />
                </div>
              ))}
            </div>
          </div>
        );

      case 'legal':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame light">
              <div className="back-row">
                <button className="back-btn" aria-label="Back to settings" onClick={() => setScreen('workspace-settings')}>←</button>
                <div className="section-name">Legal</div>
              </div>
              <div className="info-card orange">
                <h4>Privacy Policy</h4>
                <p>Camera permission is used to capture barcodes and images.</p>
              </div>
              <div className="info-card orange">
                <h4>Terms of Service</h4>
              </div>
            </div>
          </div>
        );

      case 'backup':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame light">
              <div className="back-row">
                <button className="back-btn" aria-label="Back to settings" onClick={() => setScreen('workspace-settings')}>←</button>
                <div className="section-name">Back Up</div>
              </div>
              <button className="wide-btn">Reset</button>
              <button className="wide-btn">Restore</button>
            </div>
          </div>
        );

      case 'clear-cache':
        return (
          <div className="prototype-shell">
            <div className="mobile-frame light">
              <div className="back-row">
                <button className="back-btn" aria-label="Back to settings" onClick={() => setScreen('workspace-settings')}>←</button>
                <div className="section-name">Clear Cache</div>
              </div>
              <div className="storage-box">Free Storage</div>
              <button className="wide-btn">Clean</button>
            </div>
          </div>
        );

      case 'signup':
      default:
        return (
          <div className="prototype-shell">
            <div className="mobile-frame">
              <div className="screen-header soft">
                <div className="brand-mark" aria-label="Jomich Petshop brand">
                  <img src="/pet-shop-mascot.svg" alt="Jomich Petshop dog and cat" />
                </div>
                <div className="screen-title">Welcome to</div>
                <div className="screen-brand">Jomich Petshop</div>
                <div className="pet-face">{dog}</div>
                <div className="mini-paw">{paw}</div>
              </div>
              <div className="screen-body orange">
                <h2>Sign Up</h2>
                <div className="field">
                  <label>Name</label>
                  <input type="text" value="Jomitch Dela Cruz" readOnly />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="text" value="jomitchpetshop@gmail.com" readOnly />
                </div>
                <PasswordField
                  label="Password"
                  value="**************"
                  visible={showPasswordSignup}
                  onToggle={() => setShowPasswordSignup((v) => !v)}
                  placeholder="Enter your password"
                />
                <button className="primary-btn" onClick={startVerification}>Create Account</button>
                <div className="support-text">Already have an account? <button onClick={() => setScreen('signin')}>Sign in</button></div>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="prototype-bg">
      {renderScreen()}
    </div>
  );
}

export default App;
