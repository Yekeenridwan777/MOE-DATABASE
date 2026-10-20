import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = (
  import.meta.env.VITE_API_URL ||
  'https://bar-stock-backend-yflx.onrender.com/api'
).replace(/\/+$/, '');

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
  const [report, setReport] = useState(null);
  const [search, setSearch] = useState('');
  
  // Docket entry / edit state
  const [docketNumber, setDocketNumber] = useState('');
  const [waitressName, setWaitressName] = useState('');
  const [itemRows, setItemRows] = useState([{ productId: '', quantity: 1 }]);
  const [editingDocket, setEditingDocket] = useState(null);
  const [editDocketNumber, setEditDocketNumber] = useState('');

  // Owner forms state
  const [newProduct, setNewProduct] = useState({ name: '', openingQuantity: 0, lowStockThreshold: 10, sellingPrice: 0 });
  const [receive, setReceive] = useState({ productId: '', quantity: 1, reference: '' });
  const [adjust, setAdjust] = useState({ productId: '', quantityChange: -1, reason: '' });

  // Inline Price Editing state (Owner)
  const [editingPriceId, setEditingPriceId] = useState(null);
  const [tempPrice, setTempPrice] = useState('');

  const isOwner = user?.role === 'owner';
  const isBarman = user?.role === 'barman';

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
        const r = await api('/reports/summary'); setReport(r);
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

  async function runAction(fn, successMessage) {
    setError(''); setNotice('');
    try { await fn(); setNotice(successMessage); await loadAll(); }
    catch (e) { setError(e.message); }
  }

  async function recordDocket(e) {
    e.preventDefault();
    await runAction(async () => {
      const items = itemRows.filter(x => x.productId && Number(x.quantity) > 0).map(x => ({ productId: Number(x.productId), quantity: Number(x.quantity) }));
      if (!items.length) throw new Error('Add at least one drink.');
      
      if (editingDocket) {
        await api(`/dockets/${editingDocket.id}/edit`, { 
          method: 'PUT', 
          body: JSON.stringify({ newDocketNumber: editDocketNumber, items, waitressName }) 
        });
        setEditingDocket(null);
        setEditDocketNumber('');
      } else {
        await api('/dockets/barman', { method: 'POST', body: JSON.stringify({ docketNumber, items, waitressName }) });
      }
      setDocketNumber(''); setWaitressName(''); setItemRows([{ productId: '', quantity: 1 }]);
    }, editingDocket ? 'Docket updated and stock adjusted successfully.' : 'Docket recorded and stock automatically deducted.');
  }

  function startEditDocket(d) {
    setEditingDocket(d);
    setEditDocketNumber(d.docket_number);
    setWaitressName(d.waitress_name || '');
    setItemRows((d.items || []).map(i => ({ productId: String(i.productId), quantity: i.quantity })));
    setTab('dockets');
  }

  async function addProduct(e) {
    e.preventDefault();
    await runAction(async () => {
      await api('/products', { method: 'POST', body: JSON.stringify(newProduct) });
      setNewProduct({ name: '', openingQuantity: 0, lowStockThreshold: 10, sellingPrice: 0 });
    }, 'Drink added successfully.');
  }

  async function updateProductPrice(id) {
    await runAction(async () => {
      await api(`/products/${id}`, { method: 'PUT', body: JSON.stringify({ sellingPrice: Number(tempPrice) }) });
      setEditingPriceId(null);
      setTempPrice('');
    }, 'Price updated successfully.');
  }

  async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this drink?')) return;
    await runAction(() => api(`/products/${id}`, { method: 'DELETE' }), 'Drink removed.');
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

  if (!token || !user) return <main className="login-wrap"><form className="login-card" onSubmit={login}>
    <div className="brand-mark">BC</div><p className="eyebrow">BAR OPERATIONS</p><h1>Stock Control</h1><p className="muted">Paper dockets, automated bar inventory, and accountability.</p>
    {error && <div className="alert error">{error}</div>}
    <label>Username<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
    <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
    <button className="primary full">Sign in</button>
  </form></main>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">BC</div><div><strong>Bar Control</strong><small>Inventory system</small></div></div>
      <div className="userbox"><span className="avatar">{user.name?.slice(0,1)}</span><div><strong>{user.name}</strong><small>{user.role}</small></div></div>
      <nav>
        {[['overview','Overview'],['inventory','Inventory'],['dockets','Enter / Edit Dockets'],...(isOwner ? [['reports','Owner reports & Accounts']] : [])].map(([id,label]) => <button key={id} className={tab===id?'nav-item active':'nav-item'} onClick={() => setTab(id)}>{label}</button>)}
      </nav><button className="logout" onClick={logout}>Sign out</button>
    </aside>
    <main className="main">
      <header className="topbar"><div><p className="eyebrow">BAR OPERATIONS / {user.role.toUpperCase()}</p><h1>{tab==='overview'?'Overview':tab==='inventory'?'Inventory Management':tab==='dockets'?'Docket & Sales Entry':'Owner Reports & Accounts'}</h1></div><button className="secondary" onClick={loadAll}>Refresh data</button></header>
      {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      
      {tab==='overview' && <>
        <section className="metric-grid">
          <Metric label="Product types" value={products.length} note="Active drink types" />
          <Metric label="Total units in stock" value={products.reduce((a,p)=>a+Number(p.quantity),0)} note="Current physical balance" />
          <Metric label="Active Stock Value" value={currency(products.filter(p=>Number(p.quantity)>0).reduce((a,p)=>a+(Number(p.quantity)*Number(p.selling_price)),0))} note="Excluding zero-stock items" />
          {isOwner && <Metric label="Low-stock items" value={report?.stock?.low_stock_count ?? '—'} note="At or below threshold" />}
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>Current stock balance</h2><p>Live inventory count</p></div><button className="text-button" onClick={()=>setTab('inventory')}>Manage inventory →</button></div><ProductTable products={products} currency={currency}/></section>
        <section className="panel"><div className="panel-heading"><div><h2>Recent dockets</h2><p>Dockets logged and automatically deducted</p></div><button className="text-button" onClick={()=>setTab('dockets')}>View / Edit →</button></div><DocketTable dockets={dockets.slice(0,6)} onEdit={startEditDocket}/></section>
      </>}

      {tab==='inventory' && <>
        <section className="panel"><div className="panel-heading"><div><h2>Stock inventory & Prices</h2><p>Active drinks, quantities, and owner price controls (Click a price to edit)</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>Drink</th><th>Unit</th><th>Quantity</th><th>Low-stock</th><th>Price (₦)</th><th>Status</th><th>Action</th></tr></thead><tbody>
            {products.map(p=><tr key={p.id}>
              <td><strong>{p.name}</strong></td>
              <td>{p.unit}</td>
              <td>{p.quantity}</td>
              <td>{p.low_stock_threshold}</td>
              <td>
                {isOwner && editingPriceId === p.id ? (
                  <div style={{display:'flex', gap:'5px', alignItems:'center'}}>
                    <input type="number" style={{width:'90px'}} value={tempPrice} onChange={e=>setTempPrice(e.target.value)} />
                    <button className="small primary" onClick={()=>updateProductPrice(p.id)}>Save</button>
                    <button className="small secondary" onClick={()=>setEditingPriceId(null)}>X</button>
                  </div>
                ) : (
                  <span onClick={()=>{if(isOwner){setEditingPriceId(p.id); setTempPrice(p.selling_price);}}} style={isOwner?{cursor:'pointer', borderBottom:'1px dashed #666'}:{}} title={isOwner?'Click to edit price':''}>
                    {currency(p.selling_price)} {isOwner && '✎'}
                  </span>
                )}
              </td>
              <td><span className={Number(p.quantity)<=Number(p.low_stock_threshold)?'pill warning':'pill good'}>{Number(p.quantity)<=Number(p.low_stock_threshold)?'Low stock':'In stock'}</span></td>
              <td>{isOwner && <button className="small danger" onClick={()=>deleteProduct(p.id)}>Delete</button>}</td>
            </tr>)}
          </tbody></table></div>
        </section>
        {isOwner && <div className="two-col">
          <section className="panel"><h2>Add a new drink</h2><form className="stack" onSubmit={addProduct}><label>Drink name<input required value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})}/></label><div className="form-grid"><label>Opening quantity<input type="number" min="0" required value={newProduct.openingQuantity} onChange={e=>setNewProduct({...newProduct,openingQuantity:Number(e.target.value)})}/></label><label>Low-stock threshold<input type="number" min="0" required value={newProduct.lowStockThreshold} onChange={e=>setNewProduct({...newProduct,lowStockThreshold:Number(e.target.value)})}/></label></div><label>Selling price (₦)<input type="number" min="0" step="0.01" value={newProduct.sellingPrice} onChange={e=>setNewProduct({...newProduct,sellingPrice:Number(e.target.value)})}/></label><button className="primary">Add product</button></form></section>
          <section className="panel"><h2>Receive new stock</h2><form className="stack" onSubmit={receiveStock}><label>Drink<select required value={receive.productId} onChange={e=>setReceive({...receive,productId:e.target.value})}><option value="">Select drink</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} (stock: {p.quantity})</option>)}</select></label><label>Quantity received<input type="number" min="1" required value={receive.quantity} onChange={e=>setReceive({...receive,quantity:Number(e.target.value)})}/></label><label>Supplier / Reference (optional)<input value={receive.reference} onChange={e=>setReceive({...receive,reference:e.target.value})}/></label><button className="primary">Record stock received</button></form></section>
          <section className="panel"><h2>Stock adjustment</h2><p className="muted">Use for physical counts, breakages, or corrections.</p><form className="stack" onSubmit={adjustStock}><label>Drink<select required value={adjust.productId} onChange={e=>setAdjust({...adjust,productId:e.target.value})}><option value="">Select drink</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Quantity change (+ or −)<input type="number" step="1" required value={adjust.quantityChange} onChange={e=>setAdjust({...adjust,quantityChange:Number(e.target.value)})}/></label><label>Reason<input required value={adjust.reason} onChange={e=>setAdjust({...adjust,reason:e.target.value})}/></label><button className="secondary">Save adjustment</button></form></section>
        </div>}
      </>}

      {tab==='dockets' && <>
        <section className="panel">
          <h2>{editingDocket ? `Edit Docket #${editingDocket.docket_number} (Returns / Corrections)` : 'Input Paper Docket'}</h2>
          <p className="muted">Record paper docket number, waitress name, and drinks sold. Stock is deducted automatically.</p>
          <form className="stack" onSubmit={recordDocket}>
            <label>Paper docket number<input required value={editingDocket ? editDocketNumber : docketNumber} onChange={e=>editingDocket ? setEditDocketNumber(e.target.value) : setDocketNumber(e.target.value)} placeholder="e.g. 1042"/></label>
            <label>Waitress Name (optional)<input value={waitressName} onChange={e=>setWaitressName(e.target.value)} placeholder="e.g. Mary"/></label>
            <h3>Drinks requested / sold</h3>
            {itemRows.map((row,i)=><div className="form-grid item-row" key={i}>
              <label>Drink<select required value={row.productId} onChange={e=>setItemRows(old=>old.map((x,j)=>j===i?{...x,productId:e.target.value}:x))}><option value="">Select drink</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} (stock {p.quantity})</option>)}</select></label>
              <label>Quantity<input type="number" min="1" required value={row.quantity} onChange={e=>setItemRows(old=>old.map((x,j)=>j===i?{...x,quantity:Number(e.target.value)}:x))}/></label>
              {itemRows.length>1&&<button type="button" className="danger" onClick={()=>setItemRows(old=>old.filter((_,j)=>j!==i))}>Remove</button>}
            </div>)}
            <button type="button" className="secondary" onClick={()=>setItemRows(old=>[...old,{productId:'',quantity:1}])}>+ Add another drink</button>
            <div style={{display:'flex', gap:'10px'}}>
              <button className="primary">{editingDocket ? 'Save Docket Corrections' : 'Submit Docket & Deduct Stock'}</button>
              {editingDocket && <button type="button" className="secondary" onClick={()=>{setEditingDocket(null); setEditDocketNumber(''); setDocketNumber(''); setWaitressName(''); setItemRows([{productId:'',quantity:1}]);}}>Cancel Edit</button>}
            </div>
          </form>
        </section>
        <section className="panel"><div className="panel-heading"><h2>All Dockets & History</h2></div><input className="search" placeholder="Search docket number…" value={search} onChange={e=>setSearch(e.target.value)}/><DocketTable dockets={dockets} onEdit={startEditDocket}/></section>
      </>}

      {tab==='reports' && isOwner && <>
        <section className="metric-grid">
          <Metric label="Product types" value={report?.stock?.product_count ?? 0} note="Active drink categories"/>
          <Metric label="Total units remaining" value={report?.stock?.total_units ?? 0} note="Physical inventory"/>
          <Metric label="Active Stock Value" value={currency(report?.stock?.total_stock_value)} note="Valuation (excl. 0 quantity)"/>
          <Metric label="Expected Sales Today" value={currency(report?.issuedToday?.recorded_value_today)} note="Total revenue to account for"/>
        </section>
        <section className="panel"><h2>Recent stock movements & audits</h2><div className="table-wrap"><table><thead><tr><th>Time</th><th>Drink</th><th>Movement</th><th>Change</th><th>Balance</th><th>Docket</th><th>Staff</th><th>Reason</th></tr></thead><tbody>{(report?.recentMovements||[]).map(m=><tr key={m.id}><td>{new Date(m.created_at).toLocaleString()}</td><td>{m.product_name}</td><td>{m.movement_type}</td><td className={m.quantity_change<0?'negative':'positive'}>{m.quantity_change>0?'+':''}{m.quantity_change}</td><td>{m.balance_after}</td><td>{m.docket_number||'—'}</td><td>{m.staff_name}</td><td>{m.reason||m.reference||'—'}</td></tr>)}</tbody></table></div></section>
      </>}
    </main>
  </div>;
}

function Metric({label,value,note}) { return <div className="metric"><p>{label}</p><strong>{value}</strong><small>{note}</small></div>; }
function ProductTable({products,currency}) { return <div className="table-wrap"><table><thead><tr><th>Drink</th><th>Unit</th><th>Quantity</th><th>Low-stock level</th><th>Price</th><th>Status</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.unit}</td><td>{p.quantity}</td><td>{p.low_stock_threshold}</td><td>{currency(p.selling_price)}</td><td><span className={Number(p.quantity)<=Number(p.low_stock_threshold)?'pill warning':'pill good'}>{Number(p.quantity)<=Number(p.low_stock_threshold)?'Low stock':'In stock'}</span></td></tr>)}</tbody></table>{!products.length&&<p className="empty">No products found.</p>}</div>; }
function DocketTable({dockets,onEdit}) { return <div className="table-wrap"><table><thead><tr><th>Docket #</th><th>Waitress</th><th>Items Sold</th><th>Status</th><th>Logged By</th><th>Created</th><th>Action</th></tr></thead><tbody>{dockets.map(d=><tr key={d.id}><td><strong>{d.docket_number}</strong></td><td>{d.waitress_name || '—'}</td><td>{(d.items||[]).map(i=>`${i.productName} × ${i.quantity}`).join(', ')}</td><td><span className="pill good">Issued</span></td><td>{d.barman_name || 'Staff'}</td><td>{new Date(d.created_at).toLocaleString()}</td><td><button className="small secondary" onClick={()=>onEdit(d)}>Edit / Return</button></td></tr>)}</tbody></table>{!dockets.length&&<p className="empty">No dockets found.</p>}</div>; }

createRoot(document.getElementById('root')).render(<App />);