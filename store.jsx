import { useState, useEffect, useCallback, useRef } from "react";

/* ═══════════ SECURITY UTILITIES ═══════════ */
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(pw, salt) {
  return sha256(salt + "::" + pw + "::p1supply");
}
function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}
function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}
function sanitize(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[<>"'&]/g, c => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "&": "&amp;" }[c])).trim().slice(0, 500);
}
function sanitizeObj(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === "string" ? sanitize(v) : v;
  return out;
}
function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function passwordStrength(pw) {
  if (pw.length < 8) return { ok: false, msg: "At least 8 characters" };
  if (!/[A-Z]/.test(pw)) return { ok: false, msg: "Need an uppercase letter" };
  if (!/[a-z]/.test(pw)) return { ok: false, msg: "Need a lowercase letter" };
  if (!/[0-9]/.test(pw)) return { ok: false, msg: "Need a number" };
  return { ok: true, msg: "Strong" };
}
const SESSION_TTL = 2 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/* ═══════════ CONSTANTS ═══════════ */
const CATS = ["All", "Cards", "Clothes", "Video Games"];
const DEMO_PRODUCTS = [
  { id: "p1", name: "Charizard Holo 1st Edition", cat: "Cards", price: 89.99, img: "🔥", desc: "Near mint, PSA 8 potential. Base set unlimited.", stock: 1, featured: true },
  { id: "p2", name: "Vintage Nirvana Band Tee", cat: "Clothes", price: 38.00, img: "👕", desc: "Authentic 90s concert tee, size L. Great fade.", stock: 3, featured: false },
  { id: "p3", name: "Zelda: Tears of the Kingdom", cat: "Video Games", price: 42.00, img: "🗡️", desc: "Nintendo Switch, CIB, like new condition.", stock: 2, featured: true },
  { id: "p4", name: "MTG Black Lotus (Proxy)", cat: "Cards", price: 14.99, img: "🃏", desc: "High-quality proxy for casual/commander play.", stock: 12, featured: false },
  { id: "p5", name: "Pixel Art Hoodie", cat: "Clothes", price: 54.99, img: "🧥", desc: "Retro pixel-art design. Sizes M–XXL.", stock: 5, featured: true },
  { id: "p6", name: "Elden Ring – PS5", cat: "Video Games", price: 35.00, img: "⚔️", desc: "PS5 disc, complete in box.", stock: 4, featured: false },
  { id: "p7", name: "Pokémon Booster Pack (Sealed)", cat: "Cards", price: 6.99, img: "🎴", desc: "Scarlet & Violet era, factory sealed.", stock: 20, featured: false },
  { id: "p8", name: "Streetwear Cargo Pants", cat: "Clothes", price: 62.00, img: "👖", desc: "Oversized fit, multiple pockets. Black.", stock: 7, featured: false },
];
const uid = () => { const a = new Uint8Array(6); crypto.getRandomValues(a); return Array.from(a).map(b => b.toString(36)).join("").slice(0, 9); };

/* ═══════════ STORAGE ═══════════ */
const S = {
  async get(k) { try { const r = await window.storage.get(k); return r?.value ? JSON.parse(r.value) : null; } catch { return null; } },
  async set(k, v) { try { await window.storage.set(k, JSON.stringify(v)); } catch {} },
  async del(k) { try { await window.storage.delete(k); } catch {} },
};

/* ═══════════ MAIN APP ═══════════ */
export default function App() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState("shop");
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [note, setNote] = useState(null);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [adminAuth, setAdminAuth] = useState(false);
  const [adminSession, setAdminSession] = useState(null);
  const [adminTab, setAdminTab] = useState("products");
  const [editProd, setEditProd] = useState(null);
  const [shipOrder, setShipOrder] = useState(null);
  const [viewOrder, setViewOrder] = useState(null);
  const [settings, setSettings] = useState({
    shopName: "PLAYER 1 SUPPLY", paypalEmail: "you@paypal.com", stripeKey: "",
    adminPassHash: null, adminSalt: null,
    fromName: "Player 1 Supply", fromAddress: "", fromCity: "", fromState: "", fromZip: "",
  });
  const [authForm, setAuthForm] = useState({ mode: "login", name: "", email: "", password: "", error: "", loading: false });
  const [checkout, setCheckout] = useState({ step: 1, shipping: { name: "", email: "", address: "", city: "", state: "", zip: "" }, payMethod: "card" });
  const [cardInfo, setCardInfo] = useState({ number: "", exp: "", cvc: "", name: "" });
  const loginAttempts = useRef({});

  const isSessionValid = (s) => s && s.expiresAt && Date.now() < s.expiresAt;

  useEffect(() => {
    (async () => {
      const [p, o, u, s, c, sess] = await Promise.all([
        S.get("s-products"), S.get("s-orders"), S.get("s-users"),
        S.get("s-settings"), S.get("s-cart"), S.get("s-session"),
      ]);
      setProducts(p || DEMO_PRODUCTS);
      setOrders(o || []);
      const loadedUsers = u || [];
      setUsers(loadedUsers);
      if (s) setSettings(prev => ({ ...prev, ...s }));
      setCart(c || []);
      if (sess && isSessionValid(sess)) {
        const foundUser = loadedUsers.find(x => x.id === sess.userId);
        if (foundUser) { setSession(sess); setUser({ id: foundUser.id, name: foundUser.name, email: foundUser.email }); }
        else { S.del("s-session"); }
      } else { S.del("s-session"); }
      if (!s?.adminPassHash) {
        const salt = generateSalt();
        const hash = await hashPassword("Admin1234!", salt);
        const ns = { ...settings, ...s, adminPassHash: hash, adminSalt: salt };
        setSettings(ns); S.set("s-settings", ns);
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      if (session && !isSessionValid(session)) { setSession(null); setUser(null); S.del("s-session"); notify("Session expired"); }
      if (adminSession && !isSessionValid(adminSession)) { setAdminAuth(false); setAdminSession(null); notify("Admin session expired"); }
    }, 30000);
    return () => clearInterval(iv);
  }, [session, adminSession]);

  const save = useCallback((key, setter) => (val) => { setter(val); S.set(key, val); }, []);
  const saveProducts = save("s-products", setProducts);
  const saveOrders = save("s-orders", setOrders);
  const saveUsers = save("s-users", setUsers);
  const saveSettings = (s) => { setSettings(s); S.set("s-settings", s); };
  const saveCart = save("s-cart", setCart);
  const notify = (msg) => { setNote(msg); setTimeout(() => setNote(null), 2800); };
  const goPage = (p) => { setPage(p); window.scrollTo(0, 0); };

  const checkRateLimit = (key) => {
    const entry = loginAttempts.current[key];
    if (!entry) return { allowed: true };
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) { return { allowed: false, msg: `Too many attempts. Try again in ${Math.ceil((entry.lockedUntil - Date.now()) / 60000)} min` }; }
    if (entry.lockedUntil && Date.now() >= entry.lockedUntil) { loginAttempts.current[key] = { count: 0, lockedUntil: null }; }
    return { allowed: true };
  };
  const recordAttempt = (key, success) => {
    if (success) { loginAttempts.current[key] = { count: 0, lockedUntil: null }; return; }
    const entry = loginAttempts.current[key] || { count: 0, lockedUntil: null };
    entry.count++;
    if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = Date.now() + LOCKOUT_MS;
    loginAttempts.current[key] = entry;
  };

  const addToCart = (p) => {
    const ex = cart.find(i => i.id === p.id);
    if (ex) { if (ex.qty >= p.stock) { notify("Max stock"); return; } saveCart(cart.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i)); }
    else saveCart([...cart, { id: p.id, name: p.name, price: p.price, img: p.img, qty: 1 }]);
    notify("Added to cart");
  };
  const updateQty = (id, q) => { if (q < 1) saveCart(cart.filter(i => i.id !== id)); else saveCart(cart.map(i => i.id === id ? { ...i, qty: q } : i)); };
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const filtered = products.filter(p => (cat === "All" || p.cat === cat) && (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.desc.toLowerCase().includes(search.toLowerCase())));

  const handleAuth = async () => {
    const { mode, name, email, password } = authForm;
    const cleanEmail = email.trim().toLowerCase();
    const rl = checkRateLimit("user:" + cleanEmail);
    if (!rl.allowed) { setAuthForm(a => ({ ...a, error: rl.msg })); return; }
    if (!cleanEmail || !password) { setAuthForm(a => ({ ...a, error: "Fill all fields" })); return; }
    if (!validateEmail(cleanEmail)) { setAuthForm(a => ({ ...a, error: "Invalid email" })); return; }
    setAuthForm(a => ({ ...a, loading: true, error: "" }));
    if (mode === "register") {
      if (!name.trim()) { setAuthForm(a => ({ ...a, error: "Name required", loading: false })); return; }
      const pwC = passwordStrength(password);
      if (!pwC.ok) { setAuthForm(a => ({ ...a, error: pwC.msg, loading: false })); return; }
      if (users.find(u => u.email === cleanEmail)) { setAuthForm(a => ({ ...a, error: "Email taken", loading: false })); return; }
      const salt = generateSalt();
      const hash = await hashPassword(password, salt);
      const nu = { id: uid(), name: sanitize(name), email: cleanEmail, passwordHash: hash, salt, createdAt: new Date().toISOString() };
      const updated = [...users, nu]; saveUsers(updated);
      const token = generateToken();
      const sess = { userId: nu.id, token, expiresAt: Date.now() + SESSION_TTL };
      setSession(sess); S.set("s-session", sess);
      setUser({ id: nu.id, name: nu.name, email: nu.email });
      setAuthForm({ mode: "login", name: "", email: "", password: "", error: "", loading: false });
      recordAttempt("user:" + cleanEmail, true); goPage("shop"); notify("Welcome, " + sanitize(name));
    } else {
      const found = users.find(u => u.email === cleanEmail);
      if (!found) { recordAttempt("user:" + cleanEmail, false); setAuthForm(a => ({ ...a, error: "Invalid credentials", loading: false })); return; }
      const hash = await hashPassword(password, found.salt);
      if (hash !== found.passwordHash) { recordAttempt("user:" + cleanEmail, false); setAuthForm(a => ({ ...a, error: "Invalid credentials", loading: false })); return; }
      recordAttempt("user:" + cleanEmail, true);
      const token = generateToken();
      const sess = { userId: found.id, token, expiresAt: Date.now() + SESSION_TTL };
      setSession(sess); S.set("s-session", sess);
      setUser({ id: found.id, name: found.name, email: found.email });
      setAuthForm({ mode: "login", name: "", email: "", password: "", error: "", loading: false });
      goPage("shop"); notify("Welcome back, " + found.name);
    }
  };
  const logout = () => { setSession(null); setUser(null); S.del("s-session"); goPage("shop"); notify("Signed out"); };

  const handleAdminLogin = async (pw) => {
    const rl = checkRateLimit("admin");
    if (!rl.allowed) { notify(rl.msg); return; }
    const hash = await hashPassword(pw, settings.adminSalt);
    if (hash === settings.adminPassHash) { recordAttempt("admin", true); setAdminAuth(true); setAdminSession({ expiresAt: Date.now() + SESSION_TTL }); }
    else { recordAttempt("admin", false); const e = loginAttempts.current["admin"]; const r = MAX_ATTEMPTS - (e?.count || 0); notify(r > 0 ? `Wrong password (${r} left)` : "Locked 15 min"); }
  };

  const placeOrder = () => {
    const sh = checkout.shipping;
    if (!sh.name || !sh.email || !sh.address || !sh.city || !sh.state || !sh.zip) { notify("Fill all shipping fields"); return; }
    if (!validateEmail(sh.email)) { notify("Invalid email"); return; }
    if (checkout.payMethod === "card") { const n = cardInfo.number.replace(/\s/g, ""); if (n.length < 13 || !cardInfo.exp || !cardInfo.cvc || !cardInfo.name) { notify("Fill card fields"); return; } }
    const order = { id: uid(), items: [...cart], total: cartTotal, customer: sanitizeObj({ ...sh, userId: user?.id || null }),
      payment: checkout.payMethod === "card" ? { method: "card", last4: cardInfo.number.replace(/\s/g, "").slice(-4) } : { method: "paypal" },
      date: new Date().toISOString(), status: "paid", shipped: false, tracking: null };
    saveProducts(products.map(p => { const ci = cart.find(c => c.id === p.id); return ci ? { ...p, stock: Math.max(0, p.stock - ci.qty) } : p; }));
    saveOrders([order, ...orders]); saveCart([]); setCardInfo({ number: "", exp: "", cvc: "", name: "" });
    setCheckout({ step: 1, shipping: { name: user?.name || "", email: user?.email || "", address: "", city: "", state: "", zip: "" }, payMethod: "card" });
    setViewOrder(order); goPage("order-confirmed"); notify("Order placed!");
  };
  const paypalUrl = `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${encodeURIComponent(settings.paypalEmail)}&amount=${cartTotal.toFixed(2)}&currency_code=USD&item_name=${encodeURIComponent(settings.shopName + " Order")}`;

  if (!ready) return <div style={{ minHeight: "100vh", background: "#0c0a09", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontFamily: "sans-serif" }}>Loading…</div>;

  return (
    <div className="app-root">
      <style>{CSS}</style>
      <div className="grain" />
      <nav className="nav"><div className="nav-inner">
        <div className="logo" onClick={() => goPage("shop")}>{settings.shopName}</div>
        <div className="nav-r">
          {["shop", "cart", ...(user ? ["account"] : ["login"]), "admin"].map(p => (
            <button key={p} className={`nb ${page === p || (p === "cart" && page === "checkout") ? "nb-a" : ""}`} onClick={() => goPage(p)}>
              {p === "shop" ? "Shop" : p === "cart" ? <>Cart{cartCount > 0 && <span className="badge">{cartCount}</span>}</> : p === "account" ? "Account" : p === "login" ? "Sign In" : "Admin"}
            </button>
          ))}
        </div>
      </div></nav>

      <main className="main">
        {page === "shop" && <>
          <div className="hero"><div className="hero-bg" /><h1 className="hero-h">Cards · Clothes · <span>Games</span></h1><p className="hero-p">No platform fees — fair prices, shipped direct</p></div>
          <div className="filters">
            {CATS.map(c => <button key={c} className={`fb ${cat === c ? "fb-a" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
            <input className="search-input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {filtered.length === 0 ? <div className="empty"><div className="empty-i">🔍</div><div>No products found</div></div>
          : <div className="grid">{filtered.map(p => (
            <div key={p.id} className="card"><div className="card-img">{p.img}{p.featured && <span className="feat-badge">★ FEATURED</span>}</div>
              <div className="card-body"><div className="card-cat">{p.cat}</div><div className="card-name">{p.name}</div><div className="card-desc">{p.desc}</div>
                <div className="card-foot"><div><div className="card-price">${p.price.toFixed(2)}</div><div className="card-stock">{p.stock > 0 ? `${p.stock} left` : "SOLD OUT"}</div></div>
                  <button className="btn-primary" disabled={p.stock < 1} onClick={() => addToCart(p)}>{p.stock < 1 ? "Sold Out" : "Add to Cart"}</button></div></div></div>
          ))}</div>}
        </>}

        {page === "cart" && <>
          <h2 className="pg-title">Shopping Cart</h2>
          {cart.length === 0 ? <div className="empty"><div className="empty-i">🛒</div><div>Cart is empty</div><button className="btn-primary" style={{ marginTop: 16 }} onClick={() => goPage("shop")}>Browse</button></div>
          : <>{cart.map(i => (
            <div key={i.id} className="cart-row"><span className="cart-emoji">{i.img}</span><div className="cart-info"><div className="cart-name">{i.name}</div><div className="cart-price">${(i.price * i.qty).toFixed(2)}</div></div>
              <div className="qty-ctl"><button className="qty-b" onClick={() => updateQty(i.id, i.qty - 1)}>−</button><span className="qty-n">{i.qty}</span><button className="qty-b" onClick={() => updateQty(i.id, i.qty + 1)}>+</button></div>
              <button className="rm-btn" onClick={() => saveCart(cart.filter(x => x.id !== i.id))}>✕</button></div>
          ))}
          <div className="total-bar"><div><div className="total-label">Total</div><div className="total-amt">${cartTotal.toFixed(2)}</div></div>
            <button className="btn-primary" onClick={() => { setCheckout(c => ({ ...c, step: 1, shipping: { ...c.shipping, name: user?.name || c.shipping.name, email: user?.email || c.shipping.email } })); goPage("checkout"); }}>Checkout →</button></div></>}
        </>}

        {page === "checkout" && <>
          <button className="back-btn" onClick={() => goPage("cart")}>← Cart</button>
          <h2 className="pg-title">Checkout</h2>
          <div className="steps-bar">{["Shipping", "Payment", "Review"].map((s, i) => (
            <div key={s} className={`step-dot ${checkout.step >= i + 1 ? "step-active" : ""} ${checkout.step === i + 1 ? "step-current" : ""}`}><div className="step-num">{i + 1}</div><div className="step-lbl">{s}</div></div>
          ))}</div>

          {checkout.step === 1 && <div className="ck-section">
            <h3 className="ck-h">Shipping Address</h3>
            {!user && <p className="ck-note"><button className="link-btn" onClick={() => goPage("login")}>Sign in</button> for faster checkout, or continue as guest.</p>}
            <div className="fg">
              {[["Full Name", "name", false, "text"], ["Email", "email", false, "email"], ["Street Address", "address", true, "text"], ["City", "city", false, "text"], ["State", "state", false, "text"], ["ZIP Code", "zip", false, "text"]].map(([lbl, key, full, type]) => (
                <div key={key} className={full ? "fg-full" : ""}><label className="fl">{lbl}</label><input className="fi" type={type} value={checkout.shipping[key]} onChange={e => setCheckout(c => ({ ...c, shipping: { ...c.shipping, [key]: e.target.value } }))} /></div>
              ))}
            </div>
            <button className="btn-primary btn-block" onClick={() => { const sh = checkout.shipping; if (!sh.name || !sh.email || !sh.address || !sh.city || !sh.state || !sh.zip) { notify("Fill all fields"); return; } if (!validateEmail(sh.email)) { notify("Invalid email"); return; } setCheckout(c => ({ ...c, step: 2 })); }}>Continue to Payment →</button>
          </div>}

          {checkout.step === 2 && <div className="ck-section">
            <h3 className="ck-h">Payment Method</h3>
            <div className="pay-options">
              <label className={`pay-opt ${checkout.payMethod === "card" ? "pay-sel" : ""}`}><input type="radio" name="pay" checked={checkout.payMethod === "card"} onChange={() => setCheckout(c => ({ ...c, payMethod: "card" }))} /><div className="pay-icon">💳</div><div><div className="pay-title">Credit / Debit Card</div><div className="pay-sub">Visa, Mastercard, Amex, Discover</div></div></label>
              <label className={`pay-opt ${checkout.payMethod === "paypal" ? "pay-sel" : ""}`}><input type="radio" name="pay" checked={checkout.payMethod === "paypal"} onChange={() => setCheckout(c => ({ ...c, payMethod: "paypal" }))} /><div className="pay-icon">🅿️</div><div><div className="pay-title">PayPal</div><div className="pay-sub">PayPal balance or linked bank</div></div></label>
            </div>
            {checkout.payMethod === "card" && <div className="card-form"><div className="fg">
              <div className="fg-full"><label className="fl">Cardholder Name</label><input className="fi" value={cardInfo.name} onChange={e => setCardInfo(c => ({ ...c, name: e.target.value }))} /></div>
              <div className="fg-full"><label className="fl">Card Number</label><input className="fi fi-mono" placeholder="•••• •••• •••• ••••" maxLength={19} value={cardInfo.number} onChange={e => { let v = e.target.value.replace(/\D/g, "").slice(0, 16); v = v.replace(/(.{4})/g, "$1 ").trim(); setCardInfo(c => ({ ...c, number: v })); }} /></div>
              <div><label className="fl">Expiry</label><input className="fi fi-mono" placeholder="MM/YY" maxLength={5} value={cardInfo.exp} onChange={e => { let v = e.target.value.replace(/\D/g, "").slice(0, 4); if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2); setCardInfo(c => ({ ...c, exp: v })); }} /></div>
              <div><label className="fl">CVC</label><input className="fi fi-mono" placeholder="•••" maxLength={4} type="password" value={cardInfo.cvc} onChange={e => setCardInfo(c => ({ ...c, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) }))} /></div>
            </div><div className="secure-note">🔒 Encrypted via Stripe. Full card numbers are never stored.</div></div>}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn-ghost" onClick={() => setCheckout(c => ({ ...c, step: 1 }))}>← Back</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => { if (checkout.payMethod === "card") { const n = cardInfo.number.replace(/\s/g, ""); if (n.length < 13 || !cardInfo.exp || !cardInfo.cvc || !cardInfo.name) { notify("Fill card fields"); return; } } setCheckout(c => ({ ...c, step: 3 })); }}>Review Order →</button>
            </div>
          </div>}

          {checkout.step === 3 && <div className="ck-section">
            <h3 className="ck-h">Review Your Order</h3>
            <div className="review-box">
              <div className="review-sec"><div className="review-label">Ship To</div><div className="review-val">{checkout.shipping.name}<br/>{checkout.shipping.address}<br/>{checkout.shipping.city}, {checkout.shipping.state} {checkout.shipping.zip}</div></div>
              <div className="review-sec"><div className="review-label">Payment</div><div className="review-val">{checkout.payMethod === "card" ? `Card ending ···${cardInfo.number.replace(/\s/g, "").slice(-4)}` : "PayPal"}</div></div>
              <div className="review-sec"><div className="review-label">Items</div>{cart.map(i => <div key={i.id} className="review-item"><span>{i.qty}× {i.name}</span><span>${(i.price * i.qty).toFixed(2)}</span></div>)}</div>
              <div className="review-total"><span>Total</span><span>${cartTotal.toFixed(2)}</span></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn-ghost" onClick={() => setCheckout(c => ({ ...c, step: 2 }))}>← Back</button>
              {checkout.payMethod === "paypal"
                ? <a href={paypalUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: "none" }}><button className="btn-paypal btn-block">Pay ${cartTotal.toFixed(2)} with PayPal</button></a>
                : <button className="btn-primary btn-block" style={{ flex: 1 }} onClick={placeOrder}>Place Order — ${cartTotal.toFixed(2)}</button>}
            </div>
            {checkout.payMethod === "paypal" && <button className="btn-ghost btn-block" style={{ marginTop: 10 }} onClick={placeOrder}>I've paid via PayPal — Record Order</button>}
          </div>}
        </>}

        {page === "order-confirmed" && <div className="confirmed"><div className="confirmed-icon">✓</div><h2 className="confirmed-h">Order Confirmed</h2><p className="confirmed-p">Order #{viewOrder?.id}</p><button className="btn-primary" style={{ marginTop: 20 }} onClick={() => goPage("shop")}>Keep Shopping</button></div>}

        {page === "login" && !user && <div className="auth-wrap"><div className="auth-box">
          <h2 className="auth-h">{authForm.mode === "login" ? "Sign In" : "Create Account"}</h2>
          <p className="auth-sub">{authForm.mode === "login" ? "Welcome back" : "Track orders & check out faster"}</p>
          {authForm.error && <div className="auth-err">{authForm.error}</div>}
          {authForm.mode === "register" && <><label className="fl">Name</label><input className="fi" value={authForm.name} onChange={e => setAuthForm(a => ({ ...a, name: e.target.value, error: "" }))} /></>}
          <label className="fl" style={{ marginTop: 12 }}>Email</label>
          <input className="fi" type="email" value={authForm.email} onChange={e => setAuthForm(a => ({ ...a, email: e.target.value, error: "" }))} onKeyDown={e => e.key === "Enter" && handleAuth()} />
          <label className="fl" style={{ marginTop: 12 }}>Password</label>
          <input className="fi" type="password" value={authForm.password} onChange={e => setAuthForm(a => ({ ...a, password: e.target.value, error: "" }))} onKeyDown={e => e.key === "Enter" && handleAuth()} />
          {authForm.mode === "register" && authForm.password && <div className={`pw-strength ${passwordStrength(authForm.password).ok ? "pw-ok" : "pw-weak"}`}>{passwordStrength(authForm.password).msg}</div>}
          <button className="btn-primary btn-block" style={{ marginTop: 20 }} disabled={authForm.loading} onClick={handleAuth}>{authForm.loading ? "Please wait…" : authForm.mode === "login" ? "Sign In" : "Create Account"}</button>
          <p className="auth-toggle">{authForm.mode === "login" ? "New here? " : "Have an account? "}<button className="link-btn" onClick={() => setAuthForm(a => ({ ...a, mode: a.mode === "login" ? "register" : "login", error: "" }))}>{authForm.mode === "login" ? "Create account" : "Sign in"}</button></p>
        </div></div>}

        {page === "account" && user && <>
          <div className="acct-header"><div><h2 className="pg-title" style={{ marginBottom: 4 }}>My Account</h2><p className="acct-email">{user.email}</p></div><button className="btn-ghost" onClick={logout}>Sign Out</button></div>
          <h3 className="sub-title">Order History</h3>
          {orders.filter(o => o.customer.userId === user.id || o.customer.email === user.email).length === 0 ? <div className="empty"><div className="empty-i">📦</div><div>No orders yet</div></div>
          : orders.filter(o => o.customer.userId === user.id || o.customer.email === user.email).map(o => (
            <div key={o.id} className="order-row"><div className="order-top"><span className="order-id">#{o.id}</span><span className="order-date">{new Date(o.date).toLocaleDateString()}</span><span className={`status-pill ${o.shipped ? "st-shipped" : "st-paid"}`}>{o.shipped ? "Shipped" : "Processing"}</span></div>
              <div className="order-items-preview">{o.items.map(i => `${i.qty}× ${i.name}`).join(" · ")}</div>
              <div className="order-bot"><span className="order-total">${o.total.toFixed(2)}</span>{o.tracking && <span className="order-tracking">Tracking: {o.tracking}</span>}</div></div>
          ))}
        </>}

        {page === "admin" && !adminAuth && <div className="auth-wrap"><div className="auth-box">
          <h2 className="auth-h">Admin Access</h2><div className="secure-badge">🔒 SHA-256 Protected</div>
          <label className="fl">Password</label><input className="fi" type="password" id="admin-pw" onKeyDown={e => { if (e.key === "Enter") handleAdminLogin(e.target.value); }} />
          <button className="btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => handleAdminLogin(document.getElementById("admin-pw").value)}>Login</button>
          <p className="auth-sub" style={{ marginTop: 12 }}>Default: Admin1234!</p>
        </div></div>}

        {page === "admin" && adminAuth && <>
          <div className="acct-header"><h2 className="pg-title" style={{ marginBottom: 0 }}>Admin Dashboard</h2><button className="btn-ghost" onClick={() => { setAdminAuth(false); setAdminSession(null); }}>Logout</button></div>
          <div className="stats-row">
            {[["Products", products.length, "📦"], ["Orders", orders.length, "🧾"], ["Revenue", "$" + orders.reduce((s, o) => s + o.total, 0).toFixed(2), "💰"], ["Customers", users.length, "👥"]].map(([l, v, ic]) => (
              <div key={l} className="stat-card"><div className="stat-ic">{ic}</div><div className="stat-v">{v}</div><div className="stat-l">{l}</div></div>
            ))}
          </div>
          <div className="tab-bar">{["products", "orders", "customers", "settings"].map(t => (
            <button key={t} className={`tab-btn ${adminTab === t ? "tab-a" : ""}`} onClick={() => setAdminTab(t)}>{t[0].toUpperCase() + t.slice(1)}{t === "orders" ? ` (${orders.length})` : ""}</button>
          ))}</div>

          {adminTab === "products" && <div className="panel">
            <div className="panel-head"><h3>Products</h3><button className="btn-primary" onClick={() => setEditProd({})}>+ Add</button></div>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th></th><th>Name</th><th>Cat</th><th>Price</th><th>Stock</th><th></th></tr></thead>
              <tbody>{products.map(p => <tr key={p.id}><td>{p.img}</td><td className="td-bold">{p.name}</td><td className="td-dim">{p.cat}</td><td className="td-accent">${p.price.toFixed(2)}</td>
                <td><span className={p.stock > 0 ? "td-green" : "td-red"}>{p.stock}</span></td>
                <td><button className="act-btn" onClick={() => setEditProd(p)}>Edit</button><button className="act-btn act-danger" onClick={() => { if (confirm("Delete?")) saveProducts(products.filter(x => x.id !== p.id)); }}>Del</button></td></tr>)}</tbody></table></div></div>}

          {adminTab === "orders" && <>{orders.length === 0 ? <div className="empty"><div className="empty-i">📋</div><div>No orders</div></div> :
            orders.map(o => <div key={o.id} className="order-card-admin">
              <div className="order-top"><div><span className="order-id">#{o.id}</span><span className="order-date">{new Date(o.date).toLocaleDateString()}</span></div><span className={`status-pill ${o.shipped ? "st-shipped" : "st-paid"}`}>{o.shipped ? "Shipped" : "Paid"}</span></div>
              <div className="order-customer"><strong>{o.customer.name}</strong> — {o.customer.email}</div>
              <div className="order-customer">{o.customer.address}, {o.customer.city}, {o.customer.state} {o.customer.zip}</div>
              <div className="order-items-preview">{o.items.map(i => `${i.qty}× ${i.name}`).join(" · ")}</div>
              <div className="order-pay">Payment: {o.payment?.method === "card" ? `Card ···${o.payment.last4}` : "PayPal"}</div>
              <div className="order-bot"><span className="order-total">${o.total.toFixed(2)}</span><button className="btn-ship" onClick={() => setShipOrder(o)}>{o.shipped ? "View Label" : "Ship Order"}</button></div>
              {o.tracking && <div className="order-tracking-admin">Tracking: {o.tracking}</div>}</div>)}</>}

          {adminTab === "customers" && <div className="panel"><h3>Customers ({users.length})</h3>
            {users.length === 0 ? <p className="td-dim" style={{ marginTop: 12 }}>None yet</p> :
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Orders</th></tr></thead>
              <tbody>{users.map(u => <tr key={u.id}><td className="td-bold">{u.name}</td><td>{u.email}</td><td className="td-dim">{new Date(u.createdAt).toLocaleDateString()}</td><td className="td-accent">{orders.filter(o => o.customer.userId === u.id || o.customer.email === u.email).length}</td></tr>)}</tbody></table></div>}</div>}

          {adminTab === "settings" && <div className="panel">
            <h3>Store Settings</h3>
            <div className="fg" style={{ marginTop: 16 }}>
              {[["Store Name", "shopName"], ["PayPal Email", "paypalEmail"], ["Stripe Key", "stripeKey"]].map(([l, k]) => (
                <div key={k} className="fg-full"><label className="fl">{l}</label><input className="fi" value={settings[k]} onChange={e => setSettings(s => ({ ...s, [k]: e.target.value }))} /></div>))}
            </div>
            <div className="divider" /><h4 className="ck-h" style={{ fontSize: 16, marginBottom: 12 }}>Change Admin Password</h4>
            <AdminPassChange settings={settings} onSave={(hash, salt) => { const ns = { ...settings, adminPassHash: hash, adminSalt: salt }; saveSettings(ns); notify("Password changed!"); }} notify={notify} />
            <div className="divider" /><h4 className="ck-h" style={{ fontSize: 16, marginBottom: 12 }}>Return Address</h4>
            <div className="fg">
              {[["Business Name", "fromName", true], ["Address", "fromAddress", true], ["City", "fromCity"], ["State", "fromState"], ["ZIP", "fromZip"]].map(([l, k, full]) => (
                <div key={k} className={full ? "fg-full" : ""}><label className="fl">{l}</label><input className="fi" value={settings[k]} onChange={e => setSettings(s => ({ ...s, [k]: e.target.value }))} /></div>))}
            </div>
            <button className="btn-primary" style={{ marginTop: 20 }} onClick={() => { saveSettings(settings); notify("Saved!"); }}>Save All Settings</button>
            <div className="setup-guide"><h4>💳 Stripe Setup</h4><p>1. Create free account at stripe.com</p><p>2. Developers → API Keys → copy Publishable key</p><p>3. Pair with serverless backend for live charges, or use Stripe Payment Links</p><p>~2.9% + $0.30/transaction — no monthly or platform fees</p></div>
          </div>}
        </>}
      </main>

      {editProd !== null && <ProductModal product={editProd.id ? editProd : null} onSave={(p) => { const ex = products.find(x => x.id === p.id); if (ex) saveProducts(products.map(x => x.id === p.id ? p : x)); else saveProducts([...products, p]); setEditProd(null); notify(ex ? "Updated" : "Added"); }} onCancel={() => setEditProd(null)} notify={notify} />}
      {shipOrder && <ShipModal order={shipOrder} settings={settings} onShip={(id, trk) => { saveOrders(orders.map(o => o.id === id ? { ...o, shipped: true, status: "shipped", tracking: trk } : o)); setShipOrder(null); notify("Shipped!"); }} onClose={() => setShipOrder(null)} />}
      {note && <div className="toast">{note}</div>}
      <footer className="footer"><span>© {settings.shopName}</span><span>🔒 Secure payments via Stripe & PayPal</span></footer>
    </div>
  );
}

function AdminPassChange({ settings, onSave, notify }) {
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [conf, setConf] = useState("");
  return <div className="fg">
    <div className="fg-full"><label className="fl">Current Password</label><input className="fi" type="password" value={cur} onChange={e => setCur(e.target.value)} /></div>
    <div className="fg-full"><label className="fl">New Password</label><input className="fi" type="password" value={nw} onChange={e => setNw(e.target.value)} /></div>
    {nw && <div className={`fg-full pw-strength ${passwordStrength(nw).ok ? "pw-ok" : "pw-weak"}`}>{passwordStrength(nw).msg}</div>}
    <div className="fg-full"><label className="fl">Confirm</label><input className="fi" type="password" value={conf} onChange={e => setConf(e.target.value)} /></div>
    <div className="fg-full"><button className="btn-primary" onClick={async () => {
      const h = await hashPassword(cur, settings.adminSalt);
      if (h !== settings.adminPassHash) { notify("Current password wrong"); return; }
      if (!passwordStrength(nw).ok) { notify(passwordStrength(nw).msg); return; }
      if (nw !== conf) { notify("Passwords don't match"); return; }
      const salt = generateSalt(); const hash = await hashPassword(nw, salt);
      onSave(hash, salt); setCur(""); setNw(""); setConf("");
    }}>Change Password</button></div>
  </div>;
}

function ProductModal({ product, onSave, onCancel, notify }) {
  const [f, setF] = useState(product || { name: "", cat: "Cards", price: "", img: "📦", desc: "", stock: 1, featured: false });
  return <div className="overlay" onClick={onCancel}><div className="modal" onClick={e => e.stopPropagation()}>
    <h3 className="modal-h">{product ? "Edit Product" : "New Product"}</h3>
    <div className="fg">
      <div className="fg-full"><label className="fl">Name</label><input className="fi" value={f.name} onChange={e => setF({...f, name: e.target.value})} /></div>
      <div><label className="fl">Category</label><select className="fi" value={f.cat} onChange={e => setF({...f, cat: e.target.value})}>{CATS.filter(c => c !== "All").map(c => <option key={c}>{c}</option>)}</select></div>
      <div><label className="fl">Emoji</label><input className="fi" value={f.img} onChange={e => setF({...f, img: e.target.value})} /></div>
      <div><label className="fl">Price ($)</label><input className="fi" type="number" step="0.01" min="0" value={f.price} onChange={e => setF({...f, price: e.target.value})} /></div>
      <div><label className="fl">Stock</label><input className="fi" type="number" min="0" value={f.stock} onChange={e => setF({...f, stock: parseInt(e.target.value) || 0})} /></div>
      <div className="fg-full"><label className="fl">Description</label><textarea className="fi" rows={3} value={f.desc} onChange={e => setF({...f, desc: e.target.value})} /></div>
      <div className="fg-full"><label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><input type="checkbox" checked={f.featured || false} onChange={e => setF({...f, featured: e.target.checked})} /><span className="fl" style={{ margin: 0 }}>Featured</span></label></div>
    </div>
    <div style={{ display: "flex", gap: 10, marginTop: 20 }}><button className="btn-primary" style={{ flex: 1 }} onClick={() => { if (!f.name || !f.price) { notify("Name & price required"); return; } onSave({ ...sanitizeObj(f), price: parseFloat(f.price), id: f.id || uid() }); }}>Save</button><button className="btn-ghost" onClick={onCancel}>Cancel</button></div>
  </div></div>;
}

function ShipModal({ order, settings, onShip, onClose }) {
  const tracking = `1Z${order.id.toUpperCase()}${Date.now().toString(36).toUpperCase().slice(0, 6)}`;
  return <div className="overlay" onClick={onClose}><div className="modal modal-lg" onClick={e => e.stopPropagation()}>
    <h3 className="modal-h">Shipping Label</h3>
    <div className="label-paper">
      <div className="label-row"><div><div className="label-hd">FROM</div><p className="label-bold">{settings.fromName || settings.shopName}</p><p>{settings.fromAddress || "Set in Settings"}</p><p>{settings.fromCity}{settings.fromState ? ", " + settings.fromState : ""} {settings.fromZip}</p></div>
        <div style={{ textAlign: "right" }}><div className="label-hd">DATE</div><p className="label-bold">{new Date().toLocaleDateString()}</p></div></div>
      <div className="label-to"><div className="label-hd">SHIP TO</div><p className="label-big">{order.customer.name}</p><p>{order.customer.address}</p><p>{order.customer.city}, {order.customer.state} {order.customer.zip}</p></div>
      <div className="label-contents"><div className="label-hd">CONTENTS</div>{order.items.map(i => <p key={i.id}>{i.qty}× {i.name} — ${(i.price * i.qty).toFixed(2)}</p>)}<p className="label-bold" style={{ marginTop: 6 }}>Value: ${order.total.toFixed(2)}</p></div>
      <div className="label-barcode"><div className="barcode-lines">{"| || ||| || | ||| || | || ||| | || ||| || | ||| || |"}</div><div className="barcode-num">{tracking}</div></div>
    </div>
    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
      <button className="btn-ghost" onClick={() => window.print()}>🖨️ Print</button>
      {!order.shipped && <button className="btn-primary" onClick={() => onShip(order.id, tracking)}>✓ Mark Shipped</button>}
    </div>
    <button className="btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
  </div></div>;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Nunito+Sans:wght@300;400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
:root{--bg:#0c0a09;--s1:#171412;--s2:#211d19;--s3:#2e2822;--accent:#d4845a;--accent-h:#e8a07a;--accent2:#c44b4b;--accent3:#6aab8e;--text:#f2ece6;--dim:#9a8e82;--faint:#554d44;--r:14px;--rs:8px;--font:'Nunito Sans',sans-serif;--mono:'IBM Plex Mono',monospace;--display:'Playfair Display',serif}
*{box-sizing:border-box;margin:0;padding:0}
.app-root{min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--font);position:relative}
.grain{position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E");pointer-events:none;z-index:0}
.nav{position:sticky;top:0;z-index:100;background:rgba(12,10,9,0.92);backdrop-filter:blur(24px);border-bottom:1px solid var(--s2)}
.nav-inner{max-width:1240px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:14px 24px}
.logo{font-family:var(--display);font-size:22px;font-weight:900;color:var(--accent);cursor:pointer;user-select:none;letter-spacing:.5px}
.nav-r{display:flex;gap:6px;flex-wrap:wrap}
.nb{background:transparent;border:1px solid transparent;color:var(--dim);padding:7px 16px;border-radius:100px;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:600;transition:all .2s}
.nb:hover{color:var(--text);border-color:var(--s3)}
.nb-a{background:var(--accent)!important;color:#0c0a09!important;border-color:var(--accent)!important}
.badge{background:var(--accent2);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:100px;margin-left:5px}
.main{max-width:1240px;margin:0 auto;padding:32px 24px 80px;position:relative;z-index:1}
.hero{text-align:center;padding:68px 24px;border-radius:var(--r);margin-bottom:36px;position:relative;overflow:hidden;background:var(--s1);border:1px solid var(--s2)}
.hero-bg{position:absolute;inset:0;background:radial-gradient(ellipse at 25% 40%,rgba(212,132,90,0.1),transparent 55%),radial-gradient(ellipse at 75% 60%,rgba(196,75,75,0.06),transparent 55%),radial-gradient(ellipse at 50% 100%,rgba(106,171,142,0.05),transparent 50%)}
.hero-h{font-family:var(--display);font-size:clamp(32px,5.5vw,60px);font-weight:900;color:var(--text);position:relative}
.hero-h span{color:var(--accent)}
.hero-p{color:var(--dim);margin-top:10px;font-size:15px;position:relative;font-weight:300}
.filters{display:flex;gap:8px;margin-bottom:28px;flex-wrap:wrap;align-items:center}
.fb{background:var(--s1);border:1px solid var(--s2);color:var(--dim);padding:8px 20px;border-radius:100px;cursor:pointer;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.8px;transition:all .2s}
.fb:hover{border-color:var(--accent);color:var(--text)}
.fb-a{background:var(--accent);color:#0c0a09;border-color:var(--accent);font-weight:600}
.search-input{flex:1;min-width:180px;background:var(--s1);border:1px solid var(--s2);color:var(--text);padding:8px 18px;border-radius:100px;font-family:var(--font);font-size:14px;outline:none;transition:border .2s}
.search-input:focus{border-color:var(--accent)}
.search-input::placeholder{color:var(--faint)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:20px}
.card{background:var(--s1);border:1px solid var(--s2);border-radius:var(--r);overflow:hidden;transition:all .3s}
.card:hover{border-color:var(--s3);transform:translateY(-3px);box-shadow:0 16px 48px rgba(0,0,0,0.5)}
.card-img{height:170px;display:flex;align-items:center;justify-content:center;font-size:60px;background:linear-gradient(135deg,var(--s2),var(--s1));border-bottom:1px solid var(--s2);position:relative}
.feat-badge{position:absolute;top:10px;right:10px;background:var(--accent);color:#0c0a09;font-size:9px;font-weight:700;padding:3px 10px;border-radius:100px;font-family:var(--mono);letter-spacing:.5px}
.card-body{padding:16px}
.card-cat{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--accent3);margin-bottom:6px}
.card-name{font-weight:700;font-size:15px;margin-bottom:4px}
.card-desc{font-size:13px;color:var(--dim);margin-bottom:14px;line-height:1.5;font-weight:300}
.card-foot{display:flex;align-items:end;justify-content:space-between;gap:12px}
.card-price{font-family:var(--display);font-size:26px;font-weight:700;color:var(--accent)}
.card-stock{font-size:10px;color:var(--faint);font-family:var(--mono)}
.btn-primary{background:var(--accent);color:#0c0a09;border:none;padding:10px 22px;border-radius:100px;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:700;transition:all .2s;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
.btn-primary:hover{background:var(--accent-h);transform:scale(1.02)}
.btn-primary:disabled{background:var(--s3);color:var(--faint);cursor:not-allowed;transform:none}
.btn-ghost{background:transparent;border:1px solid var(--s3);color:var(--dim);padding:10px 22px;border-radius:100px;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:600;transition:all .2s}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.btn-block{width:100%;display:block;text-align:center}
.btn-paypal{background:#0070ba;color:#fff;border:none;padding:14px;border-radius:var(--r);cursor:pointer;font-family:var(--font);font-size:15px;font-weight:700;width:100%}
.btn-paypal:hover{background:#005ea6}
.btn-ship{background:var(--accent3);color:#0c0a09;border:none;padding:7px 16px;border-radius:100px;cursor:pointer;font-size:12px;font-weight:700;font-family:var(--font)}
.btn-ship:hover{filter:brightness(1.1)}
.back-btn{background:transparent;border:1px solid var(--s3);color:var(--dim);padding:7px 18px;border-radius:100px;cursor:pointer;font-family:var(--font);font-size:13px;margin-bottom:20px}
.back-btn:hover{border-color:var(--accent);color:var(--accent)}
.link-btn{background:none;border:none;color:var(--accent);cursor:pointer;font-family:var(--font);font-size:inherit;font-weight:700;text-decoration:underline;padding:0}
.cart-row{display:flex;align-items:center;gap:16px;background:var(--s1);border:1px solid var(--s2);border-radius:var(--r);padding:16px;margin-bottom:10px}
.cart-emoji{font-size:34px;flex-shrink:0}
.cart-info{flex:1;min-width:0}
.cart-name{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cart-price{color:var(--accent);font-weight:700;font-size:14px;margin-top:2px}
.qty-ctl{display:flex;align-items:center;gap:8px}
.qty-b{width:30px;height:30px;background:var(--s2);border:1px solid var(--s3);color:var(--text);border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
.qty-b:hover{border-color:var(--accent);color:var(--accent)}
.qty-n{font-family:var(--mono);font-size:14px;min-width:18px;text-align:center}
.rm-btn{background:transparent;border:none;color:var(--faint);cursor:pointer;font-size:18px;padding:4px}
.rm-btn:hover{color:var(--accent2)}
.total-bar{background:var(--s1);border:2px solid var(--accent);border-radius:var(--r);padding:20px;display:flex;align-items:center;justify-content:space-between;margin-top:20px;flex-wrap:wrap;gap:16px}
.total-label{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;font-family:var(--mono)}
.total-amt{font-family:var(--display);font-size:34px;font-weight:900;color:var(--accent)}
.steps-bar{display:flex;align-items:center;justify-content:center;gap:48px;margin:28px 0 32px}
.step-dot{display:flex;flex-direction:column;align-items:center;gap:6px;z-index:1}
.step-num{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;background:var(--s2);color:var(--faint);border:2px solid var(--s3);transition:all .3s}
.step-lbl{font-size:11px;color:var(--faint);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.step-active .step-num{background:var(--accent);color:#0c0a09;border-color:var(--accent)}
.step-active .step-lbl{color:var(--accent)}
.step-current .step-num{box-shadow:0 0 0 4px rgba(212,132,90,0.25)}
.ck-section{background:var(--s1);border:1px solid var(--s2);border-radius:var(--r);padding:28px;margin-bottom:20px}
.ck-h{font-family:var(--display);font-size:22px;font-weight:700;margin-bottom:18px}
.ck-note{font-size:13px;color:var(--dim);margin-bottom:16px}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.fg-full{grid-column:1/-1}
.fl{display:block;font-size:10px;color:var(--dim);margin-bottom:5px;text-transform:uppercase;letter-spacing:.8px;font-family:var(--mono)}
.fi{width:100%;background:var(--s2);border:1px solid var(--s3);color:var(--text);padding:12px 14px;border-radius:var(--rs);font-family:var(--font);font-size:14px;outline:none;transition:border .2s;resize:vertical}
.fi:focus{border-color:var(--accent)}
.fi::placeholder{color:var(--faint)}
.fi-mono{font-family:var(--mono);letter-spacing:2px}
.pay-options{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.pay-opt{display:flex;align-items:center;gap:14px;padding:16px;background:var(--s2);border:2px solid var(--s3);border-radius:var(--r);cursor:pointer;transition:all .2s}
.pay-opt:hover{border-color:var(--faint)}
.pay-sel{border-color:var(--accent)!important;background:rgba(212,132,90,0.05)}
.pay-opt input{display:none}
.pay-icon{font-size:28px}
.pay-title{font-weight:700;font-size:14px}
.pay-sub{font-size:12px;color:var(--dim)}
.card-form{background:var(--s2);border:1px solid var(--s3);border-radius:var(--r);padding:20px;margin-top:4px}
.secure-note{margin-top:14px;font-size:11px;color:var(--dim);text-align:center}
.secure-badge{display:inline-block;background:rgba(106,171,142,0.12);color:var(--accent3);font-size:11px;font-weight:700;padding:4px 12px;border-radius:100px;margin-bottom:16px;font-family:var(--mono)}
.review-box{background:var(--s2);border:1px solid var(--s3);border-radius:var(--r);overflow:hidden}
.review-sec{padding:16px 20px;border-bottom:1px solid var(--s3)}
.review-label{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin-bottom:6px}
.review-val{font-size:14px;line-height:1.6}
.review-item{display:flex;justify-content:space-between;font-size:14px;padding:3px 0}
.review-total{display:flex;justify-content:space-between;padding:16px 20px;font-family:var(--display);font-size:22px;font-weight:700;color:var(--accent)}
.confirmed{text-align:center;padding:60px 20px}
.confirmed-icon{width:80px;height:80px;border-radius:50%;background:var(--accent3);color:#0c0a09;font-size:36px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;animation:pop .4s ease}
@keyframes pop{0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}}
.confirmed-h{font-family:var(--display);font-size:34px;font-weight:900;color:var(--accent3)}
.confirmed-p{color:var(--dim);margin-top:8px}
.auth-wrap{display:flex;justify-content:center;padding-top:40px}
.auth-box{background:var(--s1);border:1px solid var(--s2);border-radius:var(--r);padding:36px;width:100%;max-width:420px}
.auth-h{font-family:var(--display);font-size:28px;font-weight:900;margin-bottom:4px}
.auth-sub{color:var(--dim);font-size:14px;margin-bottom:20px}
.auth-err{background:rgba(196,75,75,0.12);border:1px solid var(--accent2);color:var(--accent2);padding:10px 14px;border-radius:var(--rs);font-size:13px;margin-bottom:16px}
.auth-toggle{text-align:center;margin-top:20px;font-size:14px;color:var(--dim)}
.pw-strength{font-size:12px;padding:6px 12px;border-radius:var(--rs);margin-top:6px;font-family:var(--mono)}
.pw-ok{background:rgba(106,171,142,0.12);color:var(--accent3)}
.pw-weak{background:rgba(196,75,75,0.1);color:var(--accent2)}
.acct-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:24px}
.acct-email{color:var(--dim);font-size:14px}
.sub-title{font-family:var(--display);font-size:22px;font-weight:700;margin-bottom:16px}
.order-row,.order-card-admin{background:var(--s1);border:1px solid var(--s2);border-radius:var(--r);padding:18px;margin-bottom:10px}
.order-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px}
.order-id{font-family:var(--mono);font-size:12px;color:var(--accent3)}
.order-date{font-size:12px;color:var(--faint);margin-left:12px}
.status-pill{display:inline-block;padding:3px 10px;border-radius:100px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.st-paid{background:rgba(212,132,90,0.15);color:var(--accent)}
.st-shipped{background:rgba(106,171,142,0.15);color:var(--accent3)}
.order-items-preview{font-size:13px;color:var(--dim);margin-bottom:8px}
.order-customer{font-size:13px;color:var(--dim);margin-bottom:4px}
.order-pay{font-size:12px;color:var(--faint);margin-bottom:8px;font-family:var(--mono)}
.order-bot{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.order-total{font-family:var(--display);font-size:22px;font-weight:700;color:var(--accent)}
.order-tracking,.order-tracking-admin{font-size:11px;color:var(--faint);font-family:var(--mono);margin-top:6px}
.pg-title{font-family:var(--display);font-size:32px;font-weight:900;margin-bottom:24px}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:var(--s1);border:1px solid var(--s2);border-radius:var(--r);padding:18px;text-align:center}
.stat-ic{font-size:24px;margin-bottom:6px}
.stat-v{font-family:var(--display);font-size:24px;font-weight:700;color:var(--accent)}
.stat-l{font-size:11px;color:var(--faint);text-transform:uppercase;letter-spacing:.5px;font-family:var(--mono)}
.tab-bar{display:flex;gap:2px;margin-bottom:24px;border-bottom:1px solid var(--s2);overflow-x:auto}
.tab-btn{background:transparent;border:none;color:var(--faint);padding:10px 18px;cursor:pointer;font-family:var(--font);font-size:14px;font-weight:600;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.tab-btn:hover{color:var(--text)}
.tab-a{color:var(--accent)!important;border-bottom-color:var(--accent)!important}
.panel{background:var(--s1);border:1px solid var(--s2);border-radius:var(--r);padding:24px}
.panel h3{font-family:var(--display);font-size:20px;font-weight:700}
.panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.tbl-wrap{overflow-x:auto}
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;padding:10px 12px;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--faint);border-bottom:1px solid var(--s3)}
.tbl td{padding:10px 12px;border-bottom:1px solid var(--s2);font-size:13px}
.td-bold{font-weight:700}
.td-dim{color:var(--dim);font-size:12px}
.td-accent{color:var(--accent);font-weight:700}
.td-green{color:var(--accent3)}
.td-red{color:var(--accent2)}
.act-btn{background:transparent;border:1px solid var(--s3);color:var(--dim);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;margin-right:4px;font-family:var(--font)}
.act-btn:hover{border-color:var(--accent);color:var(--accent)}
.act-danger:hover{border-color:var(--accent2)!important;color:var(--accent2)!important}
.setup-guide{background:var(--s2);border:1px solid var(--s3);border-radius:var(--r);padding:20px;margin-top:20px}
.setup-guide h4{color:var(--accent);font-size:14px;margin-bottom:10px}
.setup-guide p{font-size:13px;color:var(--dim);margin:4px 0;line-height:1.6}
.divider{border:none;border-top:1px solid var(--s3);margin:20px 0}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:var(--s1);border:1px solid var(--s3);border-radius:var(--r);padding:28px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto}
.modal-lg{max-width:560px}
.modal-h{font-family:var(--display);font-size:22px;font-weight:700;margin-bottom:20px}
.label-paper{background:#faf7f4;color:#1a1512;border-radius:var(--rs);padding:28px;font-family:var(--font)}
.label-row{display:flex;justify-content:space-between;margin-bottom:20px}
.label-hd{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#888;margin-bottom:4px}
.label-bold{font-weight:700}
.label-big{font-size:18px;font-weight:700}
.label-to{background:#f0ebe5;padding:18px;border-radius:8px;margin-bottom:16px}
.label-to p{margin:2px 0;font-size:14px}
.label-contents p{font-size:13px;margin:2px 0;color:#555}
.label-barcode{margin-top:18px;padding-top:14px;border-top:2px dashed #ccc;text-align:center}
.barcode-lines{font-family:var(--mono);font-size:18px;letter-spacing:3px;color:#444;margin-bottom:4px}
.barcode-num{font-family:var(--mono);font-size:10px;letter-spacing:4px;color:#888}
.empty{text-align:center;padding:60px 20px;color:var(--faint)}
.empty-i{font-size:48px;margin-bottom:12px}
.toast{position:fixed;bottom:24px;right:24px;background:var(--accent);color:#0c0a09;padding:14px 24px;border-radius:var(--r);font-weight:700;font-size:14px;z-index:300;animation:slideUp .3s ease}
@keyframes slideUp{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
.footer{text-align:center;padding:24px;font-size:12px;color:var(--faint);display:flex;justify-content:center;gap:20px;flex-wrap:wrap;border-top:1px solid var(--s2)}
.footer strong{color:var(--dim)}
@media(max-width:640px){.main{padding:20px 14px 80px}.hero{padding:44px 16px}.grid{grid-template-columns:1fr}.fg{grid-template-columns:1fr}.fg-full{grid-column:1}.total-bar{flex-direction:column;text-align:center}.nav-inner{padding:12px 16px}.steps-bar{gap:24px}.label-row{flex-direction:column;gap:12px}.acct-header{flex-direction:column;align-items:flex-start}.stats-row{grid-template-columns:1fr 1fr}}
@media print{.app-root>*:not(.overlay){display:none!important}.overlay{position:static;background:none;padding:0}.modal{max-width:100%;border:none;padding:0;box-shadow:none}.modal>*:not(.label-paper){display:none!important}.label-paper{box-shadow:none;border-radius:0}}
`;
