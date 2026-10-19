import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
function App() {
  const [token, setToken] = useState(localStorage.getItem('bar_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('bar_user') || 'null'));
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('overview');
  const [products, setProducts] = useState([]);
  const [dockets, setDockets] = useState([]);
  const [staff, setStaff] = useState([]);
  const [report, setReport] = useState(null);
  const [search, setSearch] = useState('');
  const [docketNumber, setDocketNumber] = useState('');
  const [waitressId, setWaitressId] = useState('');
  const [itemRows, setItemRows] = useState([{ productId: '', quantity: 1 }]);
  const [newProduct, setNewProduct] = useState({ name: '', openingQuantity: 0, lowStockThreshold: 10, sellingPrice: 0 });
  const [receive, setReceive] = useState({ productId: '', quantity: 1, reference: '' });
  const [adjust, setAdjust] = useState({ productId: '', quantityChange: -1, reason: '' });

  const isOwner = user?.role === 'owner';
  const isBarman = user?.role === 'barman';
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
    try {
      const p = await api('/products'); setProducts(p.products);
      const d = await api(`/dockets?search=${encodeURIComponent(search)}`); setDockets(d.dockets);
      if (isOwner) {
        const [r, s] = await Promise.all([api('/reports/summary'), api('/staff')]);
        setReport(r); setStaff(s.staff);
      }
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { if (token && user) loadAll(); }, [token, user?.role, search]);
  async function login(e) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      const result = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || 'Sign in failed.');
      localStorage.setItem('bar_token', data.token); localStorage.setItem('bar_user', JSON.stringify(data.user));
      setToken(data.token); setUser(data.user); setNotice('Signed in successfully.');
    } catch (e) { setError(e.message); }
  }
  function logout() { localStorage.removeItem('bar_token'); localStorage.removeItem('bar_user'); setToken(''); setUser(null); setProducts([]); setDockets([]); setReport(null); }
  async function runAction(fn, success) {
    setError(''); setNotice('');
    try { await fn(); setNotice(success); await loadAll(); }
    catch (e) { setError(e.message); }
  }
  async function createDocket(e) {
    e.preventDefault();
    await runAction(async () => {
      const items = itemRows.filter(x => x.productId && Number(x.quantity) > 0).map(x => ({ productId: Number(x.productId), quantity: Number(x.quantity) }));
      if (!items.length) throw new Error('Add at least one drink.');
      await api('/dockets', { method: 'POST', body: JSON.stringify({ docketNumber, waitressId: waitressId ? Number(waitressId) : undefined, items }) });
      setDocketNumber(''); setItemRows([{ productId: '', quantity: 1 }]);
    }, 'Docket saved. The barman can now issue it.');
  }
  async function issueDocket(id) {
    await runAction(() => api(`/dockets/${id}/issue`, { method: 'POST', body: '{}' }), 'Docket issued and stock updated.');
  }
  async function addProduct(e) {
    e.preventDefault();
    await runAction(async () => {
      await api('/products', { method: 'POST', body: JSON.stringify(newProduct) });
      setNewProduct({ name: '', openingQuantity: 0, lowStockThreshold: 10, sellingPrice: 0 });
    }, 'Product added.');
  }
  async function receiveStock(e) {
    e.preventDefault();
    await runAction(async () => {
      await api('/stock/receive', { method: 'POST', body: JSON.stringify(receive) });
      setReceive({ productId: '', quantity: 1, reference: '' });
    }, 'Stock received and recorded.');
  }
  async function adjustStock(e) {
    e.preventDefault();
    await runAction(async () => {
      await api('/stock/adjust', { method: 'POST', body: JSON.stringify(adjust) });
      setAdjust({ productId: '', quantityChange: -1, reason: '' });
    }, 'Stock adjustment recorded.');
  }
  const currency = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n || 0));
  const pendingCount = useMemo(() => dockets.filter(d => d.status === 'pending').length, [dockets]);

  if (!token || !user) return <main className="login-wrap"><form className="login-card" onSubmit={login}>
    <div className="brand-mark">BC</div><p className="eyebrow">BAR OPERATIONS</p><h1>Stock Control</h1><p className="muted">Inventory, paper dockets, and accountability in one place.</p>
    {error && <div className="alert error">{error}</div>}
    <label>Username<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
    <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
    <button className="primary full">Sign in</button><p className="muted tiny">Sign in using the credentials provided by the system owner</p>
  </form></main>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">BC</div><div><strong>Bar Control</strong><small>Inventory system</small></div></div>
      <div className="userbox"><span className="avatar">{user.name?.slice(0,1)}</span><div><strong>{user.name}</strong><small>{user.role}</small></div></div>
      <nav>
        {[['overview','Overview'],['inventory','Inventory'],['dockets','Paper dockets'],...(isOwner ? [['reports','Owner reports']] : [])].map(([id,label]) => <button key={id} className={tab===id?'nav-item active':'nav-item'} onClick={() => setTab(id)}>{label}</button>)}
      </nav><button className="logout" onClick={logout}>Sign out</button>
    </aside>
    <main className="main">
      <header className="topbar"><div><p className="eyebrow">BAR OPERATIONS / {user.role.toUpperCase()}</p><h1>{tab==='overview'?'Overview':tab==='inventory'?'Inventory':tab==='dockets'?'Paper docket tracking':'Owner reports'}</h1></div><button className="secondary" onClick={loadAll}>Refresh data</button></header>
      {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      {tab==='overview' && <>
        <section className="metric-grid">
          <Metric label="Product types" value={products.length} note="Active drink products" />
          <Metric label="Units in stock" value={products.reduce((a,p)=>a+Number(p.quantity),0)} note="Current recorded quantity" />
          <Metric label="Pending dockets" value={pendingCount} note="Awaiting barman issue" />
          {isOwner && <Metric label="Low-stock products" value={report?.stock?.low_stock_count ?? '—'} note="At or below threshold" />}
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>Current stock</h2><p>Latest recorded inventory balance</p></div><button className="text-button" onClick={()=>setTab('inventory')}>Manage inventory →</button></div><ProductTable products={products} currency={currency}/></section>
        <section className="panel"><div className="panel-heading"><div><h2>Recent paper dockets</h2><p>Orders submitted and drinks issued</p></div><button className="text-button" onClick={()=>setTab('dockets')}>View all →</button></div><DocketTable dockets={dockets.slice(0,6)} onIssue={issueDocket} canIssue={isBarman||isOwner}/></section>
      </>}
      {tab==='inventory' && <>
        <section className="panel"><div className="panel-heading"><div><h2>Stock inventory</h2><p>Products and current quantities</p></div></div><ProductTable products={products} currency={currency}/></section>
        {isOwner && <div className="two-col">
          <section className="panel"><h2>Add a drink</h2><form className="stack" onSubmit={addProduct}><label>Drink name<input required value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})}/></label><div className="form-grid"><label>Opening quantity<input type="number" min="0" required value={newProduct.openingQuantity} onChange={e=>setNewProduct({...newProduct,openingQuantity:Number(e.target.value)})}/></label><label>Low-stock threshold<input type="number" min="0" required value={newProduct.lowStockThreshold} onChange={e=>setNewProduct({...newProduct,lowStockThreshold:Number(e.target.value)})}/></label></div><label>Selling price (₦)<input type="number" min="0" step="0.01" value={newProduct.sellingPrice} onChange={e=>setNewProduct({...newProduct,sellingPrice:Number(e.target.value)})}/></label><button className="primary">Add product</button></form></section>
          <section className="panel"><h2>Receive stock</h2><form className="stack" onSubmit={receiveStock}><label>Drink<select required value={receive.productId} onChange={e=>setReceive({...receive,productId:e.target.value})}><option value="">Select drink</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} (stock: {p.quantity})</option>)}</select></label><label>Quantity received<input type="number" min="1" required value={receive.quantity} onChange={e=>setReceive({...receive,quantity:Number(e.target.value)})}/></label><label>Supplier/reference (optional)<input value={receive.reference} onChange={e=>setReceive({...receive,reference:e.target.value})}/></label><button className="primary">Record stock received</button></form></section>
          <section className="panel"><h2>Stock adjustment</h2><p className="muted">Use for counted stock differences, breakage, or documented corrections.</p><form className="stack" onSubmit={adjustStock}><label>Drink<select required value={adjust.productId} onChange={e=>setAdjust({...adjust,productId:e.target.value})}><option value="">Select drink</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Quantity change (+ or −)<input type="number" step="1" required value={adjust.quantityChange} onChange={e=>setAdjust({...adjust,quantityChange:Number(e.target.value)})}/></label><label>Reason<input required value={adjust.reason} onChange={e=>setAdjust({...adjust,reason:e.target.value})}/></label><button className="secondary">Save adjustment</button></form></section>
        </div>}
      </>}
      {tab==='dockets' && <>
        <section className="panel"><div className="panel-heading"><div><h2>Find a docket</h2><p>Search by the paper docket number</p></div></div><input className="search" placeholder="Enter docket number…" value={search} onChange={e=>setSearch(e.target.value)}/><DocketTable dockets={dockets} onIssue={issueDocket} canIssue={isBarman||isOwner}/></section>
        {(isWaitress||isOwner) && <section className="panel"><h2>Record a paper docket</h2><p className="muted">Enter the number printed on the existing paper docket. Docket numbers must be unique.</p><form className="stack" onSubmit={createDocket}><label>Paper docket number<input required value={docketNumber} onChange={e=>setDocketNumber(e.target.value)} placeholder="e.g. 1042"/></label>{isOwner && <label>Waitress<select required value={waitressId} onChange={e=>setWaitressId(e.target.value)}><option value="">Select waitress</option>{staff.filter(s=>s.role==='waitress'&&s.active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <h3>Drinks requested</h3>{itemRows.map((row,i)=><div className="form-grid item-row" key={i}><label>Drink<select required value={row.productId} onChange={e=>setItemRows(old=>old.map((x,j)=>j===i?{...x,productId:e.target.value}:x))}><option value="">Select drink</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} (stock {p.quantity})</option>)}</select></label><label>Quantity<input type="number" min="1" required value={row.quantity} onChange={e=>setItemRows(old=>old.map((x,j)=>j===i?{...x,quantity:Number(e.target.value)}:x))}/></label>{itemRows.length>1&&<button type="button" className="danger" onClick={()=>setItemRows(old=>old.filter((_,j)=>j!==i))}>Remove</button>}</div>)}<button type="button" className="secondary" onClick={()=>setItemRows(old=>[...old,{productId:'',quantity:1}])}>+ Add another drink</button><button className="primary">Save pending docket</button></form></section>}
      </>}
      {tab==='reports' && isOwner && <><section className="metric-grid"><Metric label="Product types" value={report?.stock?.product_count ?? 0} note="Active products"/><Metric label="Total units" value={report?.stock?.total_units ?? 0} note="Across all drink types"/><Metric label="Dockets issued today" value={report?.issuedToday?.dockets_issued_today ?? 0} note="Confirmed issues"/><Metric label="Recorded value today" value={currency(report?.issuedToday?.recorded_value_today)} note="Estimated value of issued items"/></section><section className="panel"><h2>Recent stock movements</h2><div className="table-wrap"><table><thead><tr><th>Time</th><th>Drink</th><th>Movement</th><th>Change</th><th>Balance</th><th>Docket</th><th>Staff</th><th>Reason/reference</th></tr></thead><tbody>{(report?.recentMovements||[]).map(m=><tr key={m.id}><td>{new Date(m.created_at).toLocaleString()}</td><td>{m.product_name}</td><td>{m.movement_type}</td><td className={m.quantity_change<0?'negative':'positive'}>{m.quantity_change>0?'+':''}{m.quantity_change}</td><td>{m.balance_after}</td><td>{m.docket_number||'—'}</td><td>{m.staff_name}</td><td>{m.reason||m.reference||'—'}</td></tr>)}</tbody></table></div></section><section className="panel"><h2>Staff accounts</h2><div className="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th></tr></thead><tbody>{staff.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.username}</td><td>{s.role}</td><td>{s.active?'Active':'Disabled'}</td></tr>)}</tbody></table></div></section></>}
    </main>
  </div>;
}
function Metric({label,value,note}) { return <div className="metric"><p>{label}</p><strong>{value}</strong><small>{note}</small></div>; }
function ProductTable({products,currency}) { return <div className="table-wrap"><table><thead><tr><th>Drink</th><th>Unit</th><th>Quantity</th><th>Low-stock level</th><th>Price</th><th>Status</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.unit}</td><td>{p.quantity}</td><td>{p.low_stock_threshold}</td><td>{currency(p.selling_price)}</td><td><span className={Number(p.quantity)<=Number(p.low_stock_threshold)?'pill warning':'pill good'}>{Number(p.quantity)<=Number(p.low_stock_threshold)?'Low stock':'In stock'}</span></td></tr>)}</tbody></table>{!products.length&&<p className="empty">No products found.</p>}</div>; }
function DocketTable({dockets,onIssue,canIssue}) { return <div className="table-wrap"><table><thead><tr><th>Docket</th><th>Waitress</th><th>Items</th><th>Status</th><th>Barman</th><th>Created</th><th>Action</th></tr></thead><tbody>{dockets.map(d=><tr key={d.id}><td><strong>{d.docket_number}</strong></td><td>{d.waitress_name}</td><td>{(d.items||[]).map(i=>`${i.productName} × ${i.quantity}`).join(', ')}</td><td><span className={`pill ${d.status==='issued'?'good':d.status==='pending'?'warning':'neutral'}`}>{d.status}</span></td><td>{d.barman_name||'—'}</td><td>{new Date(d.created_at).toLocaleString()}</td><td>{canIssue&&d.status==='pending'?<button className="small primary" onClick={()=>onIssue(d.id)}>Confirm issue</button>:'—'}</td></tr>)}</tbody></table>{!dockets.length&&<p className="empty">No dockets found.</p>}</div>; }
createRoot(document.getElementById('root')).render(<App />);
