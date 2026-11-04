import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import logoImg from './img/Luxury_lounge_photo___4_Nov_2026__11.07_am-removebg-preview.png';

const API = (import.meta.env.VITE_API_URL || 'https://bar-stock-backend-yflx.onrender.com/api').replace(/\/+$/, '');

function App() {
  const [token, setToken] = useState(localStorage.getItem('bar_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('bar_user') || 'null'));
  const [loading, setLoading] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  
  // Login credentials
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('overview');

  // Shared data states
  const [products, setProducts] = useState([]);
  const [foodMenu, setFoodMenu] = useState([]);
  const [waitresses, setWaitresses] = useState([]);
  const [dockets, setDockets] = useState([]);
  const [foodDockets, setFoodDockets] = useState([]);
  const [report, setReport] = useState(null);
  const [waitressAccounting, setWaitressAccounting] = useState(null);
  const [ownerWaitressList, setOwnerWaitressList] = useState([]);
  const [search, setSearch] = useState('');

  // Barman form states
  const [docketNumber, setDocketNumber] = useState('');
  const [selectedWaitress, setSelectedWaitress] = useState('');
  const [itemRows, setItemRows] = useState([{ productId: '', quantity: 1 }]);
  const [editingDocket, setEditingDocket] = useState(null);
  const [editDocketNumber, setEditDocketNumber] = useState('');

  // Chef form states
  const [foodDocketNum, setFoodDocketNum] = useState('');
  const [foodItemRows, setFoodItemRows] = useState([{ menuItemId: '', quantity: 1 }]);
  const [editingFoodDocket, setEditingFoodDocket] = useState(null);
  const [editFoodDocketNum, setEditFoodDocketNum] = useState('');

  // Owner forms & actions
  const [newProduct, setNewProduct] = useState({ name: '', openingQuantity: 0, lowStockThreshold: 10, sellingPrice: 0 });
  const [newMenuItem, setNewMenuItem] = useState({ name: '', servingOption: 'Regular', price: 0 });
  const [receive, setReceive] = useState({ productId: '', quantity: 1, reference: '' });
  const [adjust, setAdjust] = useState({ productId: '', quantityChange: -1, reason: '' });

  const isOwner = user?.role === 'owner';
  const isBarman = user?.role === 'barman';
  const isChef = user?.role === 'chef';
  const isWaitress = user?.role === 'waitress';

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function loadAll() {
    setLoading(true);
    setLoadingError('');
    try {
      const prodRes = await api('/api/products').catch(() => ({ products: [] }));
      setProducts(prodRes.products || []);

      const menuRes = await api('/api/food/menu').catch(() => ({ menu: [] }));
      setFoodMenu(menuRes.menu || []);

      if (isOwner || isBarman || isChef) {
        const waitRes = await api('/api/waitresses').catch(() => ({ waitresses: [] }));
        setWaitresses(waitRes.waitresses || []);

        const dockRes = await api(`/api/dockets?search=${encodeURIComponent(search)}`).catch(() => ({ dockets: [] }));
        setDockets(dockRes.dockets || []);

        const foodDockRes = await api(`/api/food/dockets?search=${encodeURIComponent(search)}`).catch(() => ({ dockets: [] }));
        setFoodDockets(foodDockRes.dockets || []);
      }

      if (isOwner) {
        const repRes = await api('/api/reports/summary').catch(() => null);
        setReport(repRes);

        const owRes = await api('/api/owner/waitress-accounting').catch(() => ({ waitresses: [] }));
        setOwnerWaitressList(owRes.waitresses || []);
      }
      
      if (isWaitress) {
        const waRes = await api('/api/waitress/my-accounting').catch(() => null);
        setWaitressAccounting(waRes);
      }
    } catch (e) {
      setLoadingError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token && user) {
      loadAll();
    }
  }, [token, user?.role, search]);

  async function login(e) {
    e.preventDefault(); setError(''); setNotice(''); setLoading(true);
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      localStorage.setItem('bar_token', data.token);
      localStorage.setItem('bar_user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      
      if (data.user.role === 'barman') setTab('barmanDockets');
      else if (data.user.role === 'chef') setTab('chefDockets');
      else if (data.user.role === 'waitress') setTab('myAccounting');
      else setTab('overview');

      setNotice('Signed in successfully.');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('bar_token');
    localStorage.removeItem('bar_user');
    setToken(''); setUser(null); setProducts([]); setDockets([]); setFoodDockets([]); setReport(null);
  }

  async function runAction(fn, successMessage) {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(successMessage);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function recordDocket(e) {
    e.preventDefault();
    await runAction(async () => {
      const items = itemRows.filter(x => x.productId && Number(x.quantity) > 0).map(x => ({ productId: Number(x.productId), quantity: Number(x.quantity) }));
      if (!items.length) throw new Error('Add at least one drink.');

      if (editingDocket) {
        await api(`/api/dockets/${editingDocket.id}/edit`, {
          method: 'PUT',
          body: JSON.stringify({ newDocketNumber: editDocketNumber, waitressId: selectedWaitress ? Number(selectedWaitress) : null, items })
        });
        setEditingDocket(null);
      } else {
        await api('/api/dockets/barman', {
          method: 'POST',
          body: JSON.stringify({ docketNumber, waitressId: selectedWaitress ? Number(selectedWaitress) : null, items })
        });
      }
      setDocketNumber(''); setSelectedWaitress(''); setItemRows([{ productId: '', quantity: 1 }]);
    }, editingDocket ? 'Drink docket updated successfully.' : 'Drink docket recorded successfully and stock updated.');
  }

  async function recordFoodDocket(e) {
    e.preventDefault();
    await runAction(async () => {
      const items = foodItemRows.filter(x => x.menuItemId && Number(x.quantity) > 0).map(x => ({ menuItemId: Number(x.menuItemId), quantity: Number(x.quantity) }));
      if (!items.length) throw new Error('Add at least one food item.');

      if (editingFoodDocket) {
        await api(`/api/food/dockets/${editingFoodDocket.id}/edit`, {
          method: 'PUT',
          body: JSON.stringify({ newDocketNumber: editFoodDocketNum, waitressId: selectedWaitress ? Number(selectedWaitress) : null, items })
        });
        setEditingFoodDocket(null);
      } else {
        await api('/api/food/dockets', {
          method: 'POST',
          body: JSON.stringify({ docketNumber: foodDocketNum, waitressId: selectedWaitress ? Number(selectedWaitress) : null, items })
        });
      }
      setFoodDocketNum(''); setEditFoodDocketNum(''); setSelectedWaitress(''); setFoodItemRows([{ menuItemId: '', quantity: 1 }]);
    }, editingFoodDocket ? 'Food docket updated successfully.' : 'Food docket recorded successfully.');
  }

  async function deleteDocket(id) {
    if (!confirm('Are you sure you want to delete this drink docket? Stock will be restored.')) return;
    await runAction(async () => {
      await api(`/api/dockets/${id}`, { method: 'DELETE' });
    }, 'Drink docket deleted and stock restored.');
  }

  async function deleteFoodDocket(id) {
    if (!confirm('Are you sure you want to delete this food docket?')) return;
    await runAction(async () => {
      await api(`/api/food/dockets/${id}`, { method: 'DELETE' });
    }, 'Food docket deleted.');
  }

  async function settleWaitress(waitressId) {
    if (!confirm('Mark all accounting for this waitress as balanced and lock dockets?')) return;
    await runAction(async () => {
      await api(`/api/owner/settle-waitress/${waitressId}`, { method: 'POST' });
    }, 'Waitress accounting marked as balanced and dockets locked.');
  }

  const currency = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n || 0));
  const lowStockProducts = products.filter(p => p.quantity <= p.low_stock_threshold);

  if (!token || !user) {
    return (
      <main className="login-wrap">
        <form className="login-card" onSubmit={login}>
          <div className="brand-mark">
            <img src={logoImg} alt="Hotel Logo" className="brand-logo-img" />
          </div>
          <p className="eyebrow">BAR OPERATIONS</p>
          <h1>Stock & Kitchen Control</h1>
          <p className="muted">Multi-role bar inventory, kitchen dockets, and waitress settlements.</p>
          {error && <div className="alert error">{error}</div>}
          <label>Username<input value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" /></label>
          <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
          <button className="primary full">Sign in</button>
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={logoImg} alt="Hotel Logo" className="brand-logo-img" />
          </div>
          <div><strong>Malyn Bar</strong><small>{user.role.toUpperCase()} PORTAL</small></div>
        </div>
        <div className="userbox">
          <span className="avatar">{user.name?.slice(0, 1)}</span>
          <div><strong>{user.name}</strong><small>{user.role}</small></div>
        </div>
        <nav>
          {isOwner && <>
            <button className={tab==='overview'?'nav-item active':'nav-item'} onClick={()=>setTab('overview')}>Overview</button>
            <button className={tab==='inventory'?'nav-item active':'nav-item'} onClick={()=>setTab('inventory')}>Drink Inventory {lowStockProducts.length > 0 && <span className="pill warning" style={{marginLeft: '6px'}}>{lowStockProducts.length} Low</span>}</button>
            <button className={tab==='menu'?'nav-item active':'nav-item'} onClick={()=>setTab('menu')}>Food Menu & Pricing</button>
            <button className={tab==='dockets'?'nav-item active':'nav-item'} onClick={()=>setTab('dockets')}>Drink Dockets</button>
            <button className={tab==='foodDockets'?'nav-item active':'nav-item'} onClick={()=>setTab('foodDockets')}>Food Dockets</button>
            <button className={tab==='waitressAccounting'?'nav-item active':'nav-item'} onClick={()=>setTab('waitressAccounting')}>Waitress Settlements</button>
            <button className={tab==='reports'?'nav-item active':'nav-item'} onClick={()=>setTab('reports')}>Financial Reports</button>
          </>}
          {isBarman && <>
            <button className={tab==='barmanDockets'?'nav-item active':'nav-item'} onClick={()=>setTab('barmanDockets')}>Record / Edit Drink Dockets</button>
            <button className={tab==='dockets'?'nav-item active':'nav-item'} onClick={()=>setTab('dockets')}>View Dockets</button>
            <button className={tab==='inventory'?'nav-item active':'nav-item'} onClick={()=>setTab('inventory')}>Drink Stock & Prices</button>
          </>}
          {isChef && <>
            <button className={tab==='chefDockets'?'nav-item active':'nav-item'} onClick={()=>setTab('chefDockets')}>Record / Edit Food Dockets</button>
            <button className={tab==='foodDockets'?'nav-item active':'nav-item'} onClick={()=>setTab('foodDockets')}>View Food Dockets</button>
            <button className={tab==='menu'?'nav-item active':'nav-item'} onClick={()=>setTab('menu')}>Food Menu</button>
          </>}
          {isWaitress && <>
            <button className={tab==='myAccounting'?'nav-item active':'nav-item'} onClick={()=>setTab('myAccounting')}>My Sales & Totals</button>
            <button className={tab==='inventory'?'nav-item active':'nav-item'} onClick={()=>setTab('inventory')}>Check Stock & Prices</button>
          </>}
        </nav>
        <button className="logout" onClick={logout}>Sign out</button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><p className="eyebrow">MALYN BAR / {user.role.toUpperCase()}</p><h1>{user.name} Dashboard</h1></div>
          <button className="secondary" onClick={loadAll}>Refresh data</button>
        </header>

        {loadingError && <div className="alert error">{loadingError}</div>}
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        {loading && (
          <div className="loading-overlay">
            <img src={logoImg} alt="Loading Logo" className="brand-logo-img" />
            <p>Loading records...</p>
          </div>
        )}

        {/* WAITRESS PORTAL */}
        {isWaitress && tab === 'myAccounting' && waitressAccounting && (
          <div className="stack">
            <section className="metric-grid">
              <Metric label="Drink Sales Total" value={currency(waitressAccounting.drinkTotal)} note="Active drink dockets" />
              <Metric label="Food Sales Total" value={currency(waitressAccounting.foodTotal)} note="Active kitchen dockets" />
              <Metric label="Total Money Due" value={currency(waitressAccounting.combinedTotal)} note="Combined amount due" />
              <Metric label="Assigned Dockets" value={waitressAccounting.docketsCount} note="Total orders" />
            </section>
            
            <section className="panel">
              <h2>My Daily Accounting & Dockets</h2>
              <h3>Drink Dockets</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Docket #</th><th>Amount</th><th>Status</th><th>Time</th></tr></thead>
                  <tbody>
                    {waitressAccounting.drinkDockets.map(d => (
                      <tr key={d.id}>
                        <td><strong>{d.docket_number}</strong></td>
                        <td>{currency(d.total_amount)}</td>
                        <td><span className={d.settled ? 'pill good' : 'pill warning'}>{d.settled ? 'Balanced' : 'Awaiting Settlement'}</span></td>
                        <td>{new Date(d.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 style={{marginTop: '20px'}}>Food Dockets</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Docket #</th><th>Amount</th><th>Status</th><th>Time</th></tr></thead>
                  <tbody>
                    {waitressAccounting.foodDockets.map(d => (
                      <tr key={d.id}>
                        <td><strong>{d.docket_number}</strong></td>
                        <td>{currency(d.total_amount)}</td>
                        <td><span className={d.settled ? 'pill good' : 'pill warning'}>{d.settled ? 'Balanced' : 'Awaiting Settlement'}</span></td>
                        <td>{new Date(d.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* BARMAN PORTAL */}
        {isBarman && tab === 'barmanDockets' && (
          <div className="stack">
            <section className="panel">
              <h2>{editingDocket ? `Edit Drink Docket #${editingDocket.docket_number}` : 'Record Drink Docket'}</h2>
              <form className="stack" onSubmit={recordDocket}>
                <label>Paper Docket Number<input required value={editingDocket ? editDocketNumber : docketNumber} onChange={e=>editingDocket ? setEditDocketNumber(e.target.value) : setDocketNumber(e.target.value)} placeholder="e.g. D101"/></label>
                <label>Responsible Waitress (Optional)
                  <select value={selectedWaitress} onChange={e=>setSelectedWaitress(e.target.value)}>
                    <option value="">-- Choose Waitress --</option>
                    {waitresses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                <h3>Drinks Sold</h3>
                {itemRows.map((row, i) => (
                  <div className="form-grid item-row" key={i}>
                    <label>Drink
                      <select required value={row.productId} onChange={e=>setItemRows(old=>old.map((x,j)=>j===i?{...x,productId:e.target.value}:x))}>
                        <option value="">-- Select drink --</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.quantity}) - ₦{p.selling_price}</option>)}
                      </select>
                    </label>
                    <label>Quantity<input type="number" min="1" required value={row.quantity} onChange={e=>setItemRows(old=>old.map((x,j)=>j===i?{...x,quantity:Number(e.target.value)}:x))}/></label>
                    {itemRows.length>1 && <button type="button" className="danger" onClick={()=>setItemRows(old=>old.filter((_,j)=>j!==i))}>Remove</button>}
                  </div>
                ))}
                <button type="button" className="secondary" onClick={()=>setItemRows(old=>[...old,{productId:'',quantity:1}])}>+ Add another drink</button>
                <div style={{display: 'flex', gap: '10px'}}>
                  <button className="primary">{editingDocket ? 'Update Drink Docket' : 'Submit Drink Docket & Deduct Stock'}</button>
                  {editingDocket && <button type="button" className="secondary" onClick={()=>{ setEditingDocket(null); setItemRows([{productId:'', quantity:1}]); }}>Cancel Edit</button>}
                </div>
              </form>
            </section>
          </div>
        )}

        {/* CHEF PORTAL */}
        {isChef && tab === 'chefDockets' && (
          <div className="stack">
            <section className="panel">
              <h2>{editingFoodDocket ? `Edit Food Docket #${editingFoodDocket.docket_number}` : 'Record Kitchen Food Docket'}</h2>
              <form className="stack" onSubmit={recordFoodDocket}>
                <label>Food Docket Number<input required value={editingFoodDocket ? editFoodDocketNum : foodDocketNum} onChange={e=>editingFoodDocket ? setEditFoodDocketNum(e.target.value) : setFoodDocketNum(e.target.value)} placeholder="e.g. F201"/></label>
                <label>Responsible Waitress (Optional)
                  <select value={selectedWaitress} onChange={e=>setSelectedWaitress(e.target.value)}>
                    <option value="">-- Choose Waitress --</option>
                    {waitresses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                <h3>Food Items Ordered</h3>
                {foodItemRows.map((row, i) => (
                  <div className="form-grid item-row" key={i}>
                    <label>Food Item & Serving Option
                      <select required value={row.menuItemId} onChange={e=>setFoodItemRows(old=>old.map((x,j)=>j===i?{...x,menuItemId:e.target.value}:x))}>
                        <option value="">Select food item</option>
                        {foodMenu.map(m => <option key={m.id} value={m.id}>{m.name} ({m.serving_option}) - ₦{m.price}</option>)}
                      </select>
                    </label>
                    <label>Quantity<input type="number" min="1" required value={row.quantity} onChange={e=>setFoodItemRows(old=>old.map((x,j)=>j===i?{...x,quantity:Number(e.target.value)}:x))}/></label>
                    {foodItemRows.length>1 && <button type="button" className="danger" onClick={()=>setFoodItemRows(old=>old.filter((_,j)=>j!==i))}>Remove</button>}
                  </div>
                ))}
                <button type="button" className="secondary" onClick={()=>setFoodItemRows(old=>[...old,{menuItemId:'',quantity:1}])}>+ Add another food item</button>
                <div style={{display: 'flex', gap: '10px'}}>
                  <button className="primary">{editingFoodDocket ? 'Update Food Docket' : 'Save Food Docket'}</button>
                  {editingFoodDocket && <button type="button" className="secondary" onClick={()=>{ setEditingFoodDocket(null); setFoodItemRows([{menuItemId:'', quantity:1}]); }}>Cancel Edit</button>}
                </div>
              </form>
            </section>
          </div>
        )}

        {/* OWNER WAITRESS SETTLEMENTS & BREAKDOWN */}
        {isOwner && tab === 'waitressAccounting' && (
          <div className="stack">
            <section className="panel">
              <h2>Waitress Settlements & Daily Breakdown</h2>
              <div className="stack">
                {ownerWaitressList.map(w => (
                  <div key={w.id} className="panel" style={{border: '1px solid #e2e8f0', background: '#f8fafc'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
                      <div>
                        <h3>{w.name}</h3>
                        <p className="muted">Drink Total: {currency(w.drinkTotal)} | Food Total: {currency(w.foodTotal)} | <strong>Combined: {currency(w.combinedTotal)}</strong></p>
                      </div>
                      <div>
                        <span className={w.status === 'Balanced' ? 'pill good' : 'pill warning'}>{w.status}</span>
                        {w.status !== 'Balanced' && w.combinedTotal > 0 && (
                          <button className="small primary" style={{marginLeft: '10px'}} onClick={()=>settleWaitress(w.id)}>Mark as Balanced & Lock</button>
                        )}
                      </div>
                    </div>

                    <h4>Drink Dockets</h4>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Docket #</th><th>Items</th><th>Total Amount</th><th>Status</th><th>Time</th></tr></thead>
                        <tbody>
                          {w.drinkDockets.map(d => (
                            <tr key={d.id}>
                              <td><strong>{d.docket_number}</strong></td>
                              <td>{d.items?.map(it => `${it.productName} (${it.quantity})`).join(', ')}</td>
                              <td><strong>{currency(d.total_amount)}</strong></td>
                              <td><span className={d.settled ? 'pill good' : 'pill warning'}>{d.settled ? 'Balanced' : 'Open'}</span></td>
                              <td>{new Date(d.created_at).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <h4 style={{marginTop: '12px'}}>Food Dockets</h4>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Docket #</th><th>Items</th><th>Total Amount</th><th>Status</th><th>Time</th></tr></thead>
                        <tbody>
                          {w.foodDockets.map(d => (
                            <tr key={d.id}>
                              <td><strong>{d.docket_number}</strong></td>
                              <td>{d.items?.map(it => `${it.itemName} (${it.servingOption}) x${it.quantity}`).join(', ')}</td>
                              <td><strong>{currency(d.total_amount)}</strong></td>
                              <td><span className={d.settled ? 'pill good' : 'pill warning'}>{d.settled ? 'Balanced' : 'Open'}</span></td>
                              <td>{new Date(d.created_at).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* DOCKETS LIST VIEW (Owner / Barman) */}
        {tab === 'dockets' && (
          <div className="stack">
            <section className="panel">
              <h2>Drink Dockets</h2>
              <input className="search" placeholder="Search docket number..." value={search} onChange={e=>setSearch(e.target.value)} />
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Docket #</th><th>Waitress</th><th>Items</th><th>Total Amount</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                  <tbody>
                    {dockets.map(d => (
                      <tr key={d.id}>
                        <td><strong>{d.docket_number}</strong></td>
                        <td>{d.waitress_name || 'Unassigned'}</td>
                        <td>{d.items?.map(i => `${i.productName} (${i.quantity})`).join(', ')}</td>
                        <td><strong>{currency(d.total_amount)}</strong></td>
                        <td><span className={d.settled ? 'pill good' : 'pill warning'}>{d.settled ? 'Balanced' : 'Active'}</span></td>
                        <td>{new Date(d.created_at).toLocaleString()}</td>
                        <td>
                          <div style={{display: 'flex', gap: '6px'}}>
                            {isBarman && !d.settled && (
                              <button className="small secondary" onClick={()=>{
                                setEditingDocket(d);
                                setEditDocketNumber(d.docket_number);
                                setSelectedWaitress(d.waitress_id || '');
                                setItemRows(d.items?.map(it => ({ productId: it.productId, quantity: it.quantity })) || [{productId:'', quantity:1}]);
                                setTab('barmanDockets');
                              }}>Edit</button>
                            )}
                            {isOwner && !d.settled && (
                              <button className="danger small" onClick={()=>deleteDocket(d.id)}>Delete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* FOOD DOCKETS LIST VIEW */}
        {tab === 'foodDockets' && (
          <div className="stack">
            <section className="panel">
              <h2>Food Dockets</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Docket #</th><th>Waitress</th><th>Items</th><th>Total Amount</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                  <tbody>
                    {foodDockets.map(d => (
                      <tr key={d.id}>
                        <td><strong>{d.docket_number}</strong></td>
                        <td>{d.waitress_name || 'Unassigned'}</td>
                        <td>{d.items?.map(i => `${i.itemName} (${i.servingOption}) x${i.quantity}`).join(', ')}</td>
                        <td><strong>{currency(d.total_amount)}</strong></td>
                        <td><span className={d.settled ? 'pill good' : 'pill warning'}>{d.settled ? 'Balanced' : 'Active'}</span></td>
                        <td>{new Date(d.created_at).toLocaleString()}</td>
                        <td>
                          <div style={{display: 'flex', gap: '6px'}}>
                            {isChef && !d.settled && (
                              <button className="small secondary" onClick={()=>{
                                setEditingFoodDocket(d);
                                setEditFoodDocketNum(d.docket_number);
                                setSelectedWaitress(d.waitress_id || '');
                                setFoodItemRows(d.items?.map(it => ({ menuItemId: it.menuItemId, quantity: it.quantity })) || [{menuItemId:'', quantity:1}]);
                                setTab('chefDockets');
                              }}>Edit</button>
                            )}
                            {isOwner && !d.settled && (
                              <button className="danger small" onClick={()=>deleteFoodDocket(d.id)}>Delete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* FOOD MENU & PRICING */}
        {tab === 'menu' && (
          <div className="stack">
            <section className="panel">
              <h2>Food Menu & Pricing Options</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Food Item</th><th>Serving Option</th><th>Price (₦)</th><th>Status</th>{isOwner && <th>Action</th>}</tr></thead>
                  <tbody>
                    {foodMenu.map(m => (
                      <tr key={m.id}>
                        <td><strong>{m.name}</strong></td>
                        <td>{m.serving_option}</td>
                        <td>{currency(m.price)}</td>
                        <td><span className="pill good">Active</span></td>
                        {isOwner && (
                          <td>
                            <button className="danger small" onClick={async () => {
                              if (!confirm('Delete this menu item?')) return;
                              await runAction(() => api(`/api/food/menu/${m.id}`, { method: 'PUT', body: JSON.stringify({ active: false }) }), 'Menu item removed.');
                            }}>Delete</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {isOwner && (
              <section className="panel">
                <h2>Add New Food Item & Serving Price</h2>
                <form className="stack" onSubmit={async e=>{
                  e.preventDefault();
                  await runAction(()=>api('/api/food/menu', {method:'POST', body: JSON.stringify(newMenuItem)}), 'Food menu item added.');
                  setNewMenuItem({name:'', servingOption:'Regular', price:0});
                }}>
                  <label>Food Item Name<input required value={newMenuItem.name} onChange={e=>setNewMenuItem({...newMenuItem, name:e.target.value})} placeholder="e.g. Jollof Rice"/></label>
                  <label>Serving Option<input required value={newMenuItem.servingOption} onChange={e=>setNewMenuItem({...newMenuItem, servingOption:e.target.value})} placeholder="e.g. Takeaway / Regular"/></label>
                  <label>Price (₦)<input type="number" min="0" required value={newMenuItem.price} onChange={e=>setNewMenuItem({...newMenuItem, price:Number(e.target.value)})}/></label>
                  <button className="primary">Add Food Menu Item</button>
                </form>
              </section>
            )}
          </div>
        )}

        {/* INVENTORY TAB */}
        {tab === 'inventory' && (
          <div className="stack">
            {lowStockProducts.length > 0 && (
              <section className="panel" style={{border: '1px solid #f59e0b', background: '#fffbeb'}}>
                <h3 style={{color: '#d97706'}}>⚠️ Low Stock Warnings</h3>
                <p>The following drinks have fallen below or at their low stock threshold:</p>
                <ul>
                  {lowStockProducts.map(p => (
                    <li key={p.id}><strong>{p.name}</strong> - Only <strong>{p.quantity} {p.unit}</strong> remaining (Threshold: {p.low_stock_threshold})</li>
                  ))}
                </ul>
              </section>
            )}

            <section className="panel">
              <h2>Drink Inventory & Stock</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Drink</th><th>Unit</th><th>Quantity</th><th>Threshold</th><th>Price (₦)</th><th>Status</th>{isOwner && <th>Actions</th>}</tr></thead>
                  <tbody>
                    {products.map(p => {
                      const isLow = p.quantity <= p.low_stock_threshold;
                      return (
                        <tr key={p.id}>
                          <td><strong>{p.name}</strong></td>
                          <td>{p.unit}</td>
                          <td>{p.quantity}</td>
                          <td>{p.low_stock_threshold}</td>
                          <td>
                            {isOwner ? (
                              <input type="number" defaultValue={p.selling_price} style={{width: '90px'}} onBlur={async e => {
                                const newPrice = Number(e.target.value);
                                if (newPrice >= 0 && newPrice !== p.selling_price) {
                                  await runAction(() => api(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify({ sellingPrice: newPrice }) }), 'Price updated.');
                                }
                              }} />
                            ) : currency(p.selling_price)}
                          </td>
                          <td>
                            <span className={isLow ? 'pill warning' : 'pill good'}>
                              {p.quantity <= 0 ? 'Out of Stock' : (isLow ? 'Low Stock' : 'In Stock')}
                            </span>
                          </td>
                          {isOwner && (
                            <td>
                              <button className="danger small" onClick={async () => {
                                if (!confirm(`Delete ${p.name}?`)) return;
                                await runAction(() => api(`/api/products/${p.id}`, { method: 'DELETE' }), 'Drink removed.');
                              }}>Delete</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {isOwner && (
              <div className="grid-2">
                <section className="panel">
                  <h2>Receive New Stock</h2>
                  <form className="stack" onSubmit={async e => {
                    e.preventDefault();
                    await runAction(() => api('/api/stock/receive', { method: 'POST', body: JSON.stringify(receive) }), 'Stock received.');
                    setReceive({ productId: '', quantity: 1, reference: '' });
                  }}>
                    <label>Drink
                      <select required value={receive.productId} onChange={e=>setReceive({...receive, productId:e.target.value})}>
                        <option value="">Select drink</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} (Current: {p.quantity})</option>)}
                      </select>
                    </label>
                    <label>Quantity Received<input type="number" min="1" required value={receive.quantity} onChange={e=>setReceive({...receive, quantity:Number(e.target.value)})}/></label>
                    <label>Reference / Supplier<input value={receive.reference} onChange={e=>setReceive({...receive, reference:e.target.value})} placeholder="e.g. Supplier delivery"/></label>
                    <button className="primary">Receive Stock</button>
                  </form>
                </section>

                <section className="panel">
                  <h2>Stock Adjustment / Breakage</h2>
                  <form className="stack" onSubmit={async e => {
                    e.preventDefault();
                    await runAction(() => api('/api/stock/adjust', { method: 'POST', body: JSON.stringify(adjust) }), 'Stock adjusted.');
                    setAdjust({ productId: '', quantityChange: -1, reason: '' });
                  }}>
                    <label>Drink
                      <select required value={adjust.productId} onChange={e=>setAdjust({...adjust, productId:e.target.value})}>
                        <option value="">Select drink</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.quantity})</option>)}
                      </select>
                    </label>
                    <label>Quantity Change (+/-)<input type="number" required value={adjust.quantityChange} onChange={e=>setAdjust({...adjust, quantityChange:Number(e.target.value)})}/></label>
                    <label>Reason<input required value={adjust.reason} onChange={e=>setAdjust({...adjust, reason:e.target.value})} placeholder="e.g. Breakage / Audit correction"/></label>
                    <button className="primary">Apply Adjustment</button>
                  </form>
                </section>
              </div>
            )}

            {isOwner && (
              <section className="panel">
                <h2>Add New Drink</h2>
                <form className="stack" onSubmit={async e=>{
                  e.preventDefault();
                  await runAction(()=>api('/api/products', {method:'POST', body: JSON.stringify(newProduct)}), 'Drink added.');
                  setNewProduct({name:'', openingQuantity:0, lowStockThreshold:10, sellingPrice:0});
                }}>
                  <label>Drink Name<input required value={newProduct.name} onChange={e=>setNewProduct({...newProduct, name:e.target.value})}/></label>
                  <div className="form-grid">
                    <label>Opening Qty<input type="number" min="0" required value={newProduct.openingQuantity} onChange={e=>setNewProduct({...newProduct, openingQuantity:Number(e.target.value)})}/></label>
                    <label>Low Stock Threshold<input type="number" min="0" required value={newProduct.lowStockThreshold} onChange={e=>setNewProduct({...newProduct, lowStockThreshold:Number(e.target.value)})}/></label>
                  </div>
                  <label>Selling Price (₦)<input type="number" min="0" required value={newProduct.sellingPrice} onChange={e=>setNewProduct({...newProduct, sellingPrice:Number(e.target.value)})}/></label>
                  <button className="primary">Add Drink</button>
                </form>
              </section>
            )}
          </div>
        )}

        {/* OVERVIEW / REPORTS TAB */}
        {isOwner && tab === 'overview' && (
          <div className="stack">
            <section className="metric-grid">
              <Metric label="Active Drink Types" value={products.length} note="Beverage catalog" />
              <Metric label="Total Drink Units" value={products.reduce((a,p)=>a+Number(p.quantity),0)} note="Physical stock balance" />
              <Metric label="Total Active Stock Value" value={currency(report?.stock?.total_stock_value || products.reduce((a,p)=>a+(Number(p.quantity)*Number(p.selling_price)),0))} note="Total worth of bar stock" />
              <Metric label="Low Stock Items" value={lowStockProducts.length} note="Needs restocking" />
              <Metric label="Drink Sales Value" value={currency(report?.drinkSalesToday?.recorded_value)} note="Total recorded sales" />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({label, value, note}) {
  return <div className="metric"><p>{label}</p><strong>{value}</strong><small>{note}</small></div>;
}

createRoot(document.getElementById('root')).render(<App />);