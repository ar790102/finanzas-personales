'use strict';
(() => {
  // ============================================================
  //  Constantes
  // ============================================================
  const DB_NAME = 'finanzas-personales';
  const DB_STORE = 'boveda';
  const VAULT_KEY = 'principal';
  const PBKDF2_ITER = 600000;
  const BASE = 'ARS';
  const MIN_PW = 8;
  const SCHEMA = 1;

  const ACCOUNT_TYPES = {
    efectivo: 'Efectivo',
    banco: 'Cuenta bancaria',
    billetera: 'Billetera virtual',
    debito: 'Tarjeta de débito',
    credito: 'Tarjeta de crédito',
    inversion: 'Inversión',
  };
  const VIEW_TITLES = {
    dashboard: 'Resumen', movements: 'Movimientos', accounts: 'Cuentas',
    categories: 'Categorías', currencies: 'Monedas y cotizaciones', vehicles: 'Vehículos',
    budget: 'Presupuesto', analysis: 'Análisis', dues: 'Vencimientos', recon: 'Conciliación', projection: 'Proyección',
    settings: 'Seguridad y backup', more: 'Más',
  };
  const MORE_VIEWS = ['analysis', 'recon', 'accounts', 'vehicles', 'categories', 'currencies', 'settings', 'more'];
  const VEH_KINDS = { combustible: 'Carga de combustible', mantenimiento: 'Mantenimiento o reparación' };

  const te = new TextEncoder();
  const td = new TextDecoder();

  // ============================================================
  //  Utilidades
  // ============================================================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const ymOf = (iso) => iso.slice(0, 7);
  const addMonths = (ym, n) => {
    let [y, m] = ym.split('-').map(Number);
    m += n;
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
    return `${y}-${pad(m)}`;
  };
  const monthFmt = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });
  const monthShortFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' });
  const dayFmt = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const ymDate = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1); };
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const ymLabel = (ym) => monthFmt.format(ymDate(ym));
  const ymTitle = (ym) => cap(ymLabel(ym));
  const ymShort = (ym) => monthShortFmt.format(ymDate(ym)).replace('.', '');
  const dateLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); return dayFmt.format(new Date(y, m - 1, d)); };
  const dateShort = (iso) => iso.split('-').reverse().join('/');
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const numFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rateFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const plainFmt = new Intl.NumberFormat('es-AR', { useGrouping: false, maximumFractionDigits: 6 });
  const inputFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 6 });
  const inputFmt2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const numForInput = (n) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? ''
    : Number.isInteger(Number(n)) ? inputFmt.format(n) : inputFmt2.format(n));
  const daysBetween = (a, b) => Math.floor((b - a) / 86400000);

  function money(n, code = BASE) {
    const c = currency(code);
    const sym = c ? c.symbol : code;
    return `${n < 0 ? '−' : ''}${esc(sym)} ${numFmt.format(Math.abs(n))}`;
  }

  // Acepta "1.234,56", "1234,56", "1234.56", "1.500" (miles) y "-200".
  function parseAmount(raw) {
    let s = String(raw ?? '').trim().replace(/\s/g, '').replace(/^[^\d\-,.]+/, '');
    if (!s) return NaN;
    let neg = false;
    if (s.startsWith('-')) { neg = true; s = s.slice(1); }
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) {
      s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lc >= 0) {
      s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (ld >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 || parts[1].length === 3) s = parts.join('');
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    const n = Number(s);
    return neg ? -n : n;
  }

  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

  // ============================================================
  //  IndexedDB
  // ============================================================
  let dbPromise = null;
  function idb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbPromise;
  }
  async function idbRun(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = fn(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const idbGet = (k) => idbRun('readonly', (s) => s.get(k));
  const idbPut = (k, v) => idbRun('readwrite', (s) => s.put(v, k));
  const idbDel = (k) => idbRun('readwrite', (s) => s.delete(k));

  // ============================================================
  //  Cifrado (AES-GCM 256 con clave derivada por PBKDF2-SHA256)
  // ============================================================
  async function deriveKey(password, salt, iterations, extractable = false) {
    const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
  }
  async function seal(key, salt, iter, state) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(state))));
    return {
      app: 'finanzas-personales', format: 1, kdf: 'PBKDF2-SHA256', iter,
      salt: b64(salt), iv: b64(iv), data: b64(ct), savedAt: new Date().toISOString(),
    };
  }
  async function unsealWithKey(record, key) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(record.iv) }, key, unb64(record.data));
    return JSON.parse(td.decode(pt));
  }
  async function unseal(record, password) {
    const salt = unb64(record.salt);
    const key = await deriveKey(password, salt, record.iter);
    const state = await unsealWithKey(record, key); // falla si la contraseña es incorrecta
    return { key, salt, iter: record.iter, state };
  }
  function isRecord(r) {
    return r && r.app === 'finanzas-personales' && typeof r.salt === 'string' && typeof r.iv === 'string'
      && typeof r.data === 'string' && Number.isInteger(r.iter) && r.iter >= 100000;
  }

  // ============================================================
  //  Desbloqueo con huella o rostro (WebAuthn + extensión PRF)
  // ============================================================
  // El sensor del teléfono entrega un secreto (PRF) solo después de verificar la huella.
  // Con ese secreto se cifra una copia de la clave de los datos, guardada solo en este dispositivo.
  const BIO_KEY = 'biometria';
  const BIO_INFO = te.encode('finanzas-personales: clave de la boveda');
  async function bioAvailable() {
    try {
      return !!(window.isSecureContext && window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
        && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch { return false; }
  }
  async function bioWrapKey(prfOut) {
    const base = await crypto.subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: BIO_INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function bioRecord() {
    const [bio, rec] = await Promise.all([idbGet(BIO_KEY).catch(() => null), idbGet(VAULT_KEY).catch(() => null)]);
    if (!bio || !rec) return null;
    if (bio.vaultSalt !== rec.salt) { await idbDel(BIO_KEY).catch(() => {}); return null; } // la contraseña cambió
    return bio;
  }
  async function bioPrf(credId, prfSalt) {
    const a = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, timeout: 60000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: credId }],
      extensions: { prf: { eval: { first: prfSalt } } },
    } });
    const out = a && a.getClientExtensionResults().prf?.results?.first;
    if (!out) throw new Error('sin-prf');
    return out;
  }
  async function enableBio(password) {
    const rec = await idbGet(VAULT_KEY);
    const salt = unb64(rec.salt);
    await unseal(rec, password); // verifica la contraseña
    const extKey = await deriveKey(password, salt, rec.iter, true);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', extKey));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Finanzas personales', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'finanzas', displayName: 'Finanzas personales' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    } });
    const ext = cred.getClientExtensionResults();
    if (!ext.prf || ext.prf.enabled === false) throw new Error('sin-prf');
    let out = ext.prf.results?.first;
    if (!out) out = await bioPrf(new Uint8Array(cred.rawId), prfSalt); // algunos teléfonos piden la huella una segunda vez
    const kek = await bioWrapKey(out);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw));
    raw.fill(0);
    await idbPut(BIO_KEY, { credId: b64(new Uint8Array(cred.rawId)), prfSalt: b64(prfSalt), iv: b64(iv), wrapped: b64(wrapped), vaultSalt: rec.salt, createdAt: new Date().toISOString() });
  }
  async function unlockWithBio() {
    const bio = await bioRecord();
    if (!bio) throw new Error('sin-registro');
    const out = await bioPrf(unb64(bio.credId), unb64(bio.prfSalt));
    const kek = await bioWrapKey(out);
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(bio.iv) }, kek, unb64(bio.wrapped)));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    raw.fill(0);
    const rec = await idbGet(VAULT_KEY);
    const state = await unsealWithKey(rec, key);
    return { key, salt: unb64(rec.salt), iter: rec.iter, state };
  }
  const bioErrorText = (e) => {
    const n = e && e.name, m = e && e.message;
    if (n === 'NotAllowedError' || n === 'AbortError') return 'Se canceló la verificación.';
    if (m === 'sin-prf') return 'Este teléfono o navegador no permite usar la huella para cifrar datos. Necesitás iOS 18 o posterior, o Android con Chrome actualizado.';
    if (n === 'SecurityError') return 'La huella solo funciona con la app publicada en una dirección https.';
    if (n === 'OperationError') return 'La contraseña no es correcta.';
    return 'No se pudo usar la huella en este dispositivo.';
  };

  // ============================================================
  //  Sesión y guardado
  // ============================================================
  const S = {
    key: null, salt: null, iter: PBKDF2_ITER, state: null,
    view: 'dashboard', month: ymOf(todayISO()),
    filters: { q: '', type: '', account: '', category: '', sub: '', from: '', to: '', all: false },
    dueDay: null,
    reconId: null, reconDraft: {},
    an: { tab: 'evolucion', range: 12, desv: 'mes', cmp: null, avg: false, key: '', catRange: 12 },
    lastAccount: {},
  };
  const st = () => S.state;
  let saveChain = Promise.resolve();

  function save() {
    const { key, salt, iter, state } = S;
    if (!key || !state) return saveChain;
    saveChain = saveChain
      .then(async () => { await idbPut(VAULT_KEY, await seal(key, salt, iter, state)); })
      .catch((e) => { console.error(e); toast('No se pudieron guardar los cambios. Descargá un backup.'); });
    return saveChain;
  }
  function commit(msg) { save(); render(); if (msg) toast(msg); }

  // Bloqueo automático por inactividad
  let lastActivity = Date.now();
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input'].forEach((ev) =>
    addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
  function checkIdle() {
    if (!S.key || !S.state) return;
    const mins = Number(S.state.settings.lockMinutes) || 5;
    if (Date.now() - lastActivity > mins * 60000) lock('Se bloqueó por inactividad.');
  }
  setInterval(checkIdle, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkIdle(); });

  async function lock(message) {
    await saveChain;
    S.key = null; S.salt = null; S.state = null;
    closeModal();
    $('#main').innerHTML = '';
    showLock(message);
  }

  // ============================================================
  //  Estado inicial y migraciones
  // ============================================================
  const SEED_INCOME = ['Sueldo', 'Honorarios', 'Alquileres cobrados', 'Intereses y rendimientos', 'Otros ingresos'];
  const SEED_EXPENSE = {
    'Vivienda': ['Alquiler', 'Expensas', 'Mantenimiento'],
    'Servicios': ['Luz', 'Gas', 'Agua', 'Internet', 'Telefonía', 'Streaming'],
    'Impuestos': ['Inmobiliario / ABL', 'Automotor', 'Ganancias', 'Bienes Personales', 'Monotributo', 'Otros impuestos'],
    'Alimentación': ['Supermercado', 'Verdulería y almacén', 'Restaurantes', 'Delivery'],
    'Transporte': ['Combustible', 'Transporte público', 'Peajes y estacionamiento', 'Mantenimiento del auto'],
    'Salud': ['Prepaga', 'Farmacia', 'Consultas y estudios'],
    'Educación': ['Cuotas', 'Libros y materiales', 'Cursos'],
    'Ocio': ['Salidas', 'Viajes', 'Hobbies'],
    'Ropa y cuidado personal': ['Ropa', 'Cuidado personal'],
    'Seguros': ['Auto', 'Hogar', 'Vida'],
    'Varios': ['Regalos', 'Comisiones bancarias', 'Otros gastos'],
  };

  const SEED_MTYPES = [
    ['Cambio de aceite y filtro', 10000, 12], ['Filtro de aire', 20000, 24], ['Filtro de habitáculo', 15000, 12],
    ['Bujías', 40000, null], ['Correa de distribución', 60000, 60], ['Pastillas de freno', 30000, null],
    ['Líquido de frenos', null, 24], ['Neumáticos', 50000, 60], ['Alineación y balanceo', 10000, 12],
    ['Batería', null, 48], ['Service oficial', 10000, 12], ['VTV', null, 12], ['Otro trabajo', null, null],
  ];
  const seedMtypes = () => SEED_MTYPES.map(([name, intervalKm, intervalMonths]) => ({ id: uid(), name, intervalKm, intervalMonths, active: true }));

  function defaultState() {
    return {
      schema: SCHEMA,
      createdAt: new Date().toISOString(),
      settings: { lockMinutes: 5, cardImputation: 'vencimiento', lastBackupAt: null, vehicleSetupDone: false },
      currencies: [
        { code: 'ARS', name: 'Peso argentino', symbol: '$' },
        { code: 'USD', name: 'Dólar estadounidense', symbol: 'US$' },
      ],
      rates: [],
      accounts: [{ id: uid(), name: 'Efectivo', type: 'efectivo', currency: 'ARS', initialBalance: 0, active: true }],
      incomeCategories: SEED_INCOME.map((name) => ({ id: uid(), name, active: true })),
      expenseCategories: Object.entries(SEED_EXPENSE).map(([name, subs]) => ({
        id: uid(), name, active: true, subs: subs.map((n) => ({ id: uid(), name: n, active: true })),
      })),
      transactions: [],
      vehicles: [],
      maintenanceTypes: seedMtypes(),
      budget: { versions: [], overrides: {} },
      dues: [],
      statements: [],
      importProfiles: {},
      descMemory: {},
      importRules: [],
    };
  }
  function migrate(s) {
    const d = defaultState();
    s.schema = s.schema || SCHEMA;
    s.settings = Object.assign({}, d.settings, s.settings || {});
    for (const k of ['currencies', 'rates', 'accounts', 'incomeCategories', 'expenseCategories', 'transactions']) {
      if (!Array.isArray(s[k])) s[k] = k === 'currencies' ? d.currencies : [];
    }
    if (!s.currencies.some((c) => c.code === BASE)) s.currencies.unshift(d.currencies[0]);
    s.expenseCategories.forEach((c) => { if (!Array.isArray(c.subs)) c.subs = []; });
    if (!Array.isArray(s.dues)) s.dues = [];
    if (!Array.isArray(s.importBatches)) s.importBatches = [];
    if (!Array.isArray(s.statements)) s.statements = [];
    if (!s.importProfiles || typeof s.importProfiles !== 'object') s.importProfiles = {};
    if (!s.descMemory || typeof s.descMemory !== 'object') s.descMemory = {};
    if (!Array.isArray(s.importRules)) s.importRules = [];
    if (!s.budget || typeof s.budget !== 'object') s.budget = { versions: [], overrides: {} };
    if (!Array.isArray(s.budget.versions)) s.budget.versions = [];
    if (!s.budget.overrides || typeof s.budget.overrides !== 'object') s.budget.overrides = {};
    if (!Array.isArray(s.vehicles)) s.vehicles = [];
    if (!Array.isArray(s.maintenanceTypes)) s.maintenanceTypes = seedMtypes();
    s.vehicles.forEach((v) => { if (!Array.isArray(v.kmReadings)) v.kmReadings = []; });
    if (!s.settings.vehicleSetupDone) autoSetupVehicles(s);
    if (!s.settings.catOrderInit) { applyPreferredOrder(s); s.settings.catOrderInit = true; }
    if (!s.settings.projAccInit) {
      // Cuentas pedidas para el saldo inicial: Efectivo, Ahorros $ y CA BBVA $
      const n = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const want = new Set(['efectivo', 'ahorros $', 'ahorros', 'ca bbva $', 'ca bbva', 'ca bbva pesos']);
      s.accounts.forEach((a) => { if (want.has(n(a.name)) && a.inProjection === undefined) a.inProjection = true; });
      s.settings.projAccInit = true;
    }
    return s;
  }

  // Orden inicial pedido; después se cambia desde Categorías → Ordenar
  function applyPreferredOrder(s) {
    const n = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const reorder = (list, prefs) => {
      const picked = [];
      for (const p of prefs) {
        const np = n(p);
        const hit = list.find((c) => !picked.includes(c) && n(c.name) === np)
          || list.find((c) => !picked.includes(c) && (n(c.name).includes(np) || np.includes(n(c.name))) && n(c.name).length >= 3);
        if (hit) picked.push(hit);
      }
      return [...picked, ...list.filter((c) => !picked.includes(c))];
    };
    s.incomeCategories = reorder(s.incomeCategories, ['Sueldo', 'SAC', 'Intereses y rendimientos', 'Gratificación anual']);
    s.expenseCategories = reorder(s.expenseCategories, ['Impuestos del Hogar', 'Servicios', 'Alimentación', 'Educación', 'Ocio', 'Ropa y cuidado personal', 'Vehículos', 'Otros gastos', 'Gastos extraordinarios']);
  }

  // Configura una sola vez los vehículos a partir de subcategorías como "Nafta VW Taos"
  // o "Reparaciones Peugeot 208" dentro de una categoría de vehículos.
  function autoSetupVehicles(s) {
    const findOrCreate = (name) => {
      let v = s.vehicles.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!v) { v = { id: uid(), name, active: true, kmReadings: [] }; s.vehicles.push(v); }
      return v;
    };
    for (const c of s.expenseCategories) {
      if (!/veh[ií]culo|rodado|autom[oó]vil|\bautos?\b/i.test(c.name)) continue;
      for (const x of c.subs) {
        if (x.kind) continue;
        let kind = null;
        let m = x.name.match(/^\s*(?:nafta|combustible|gasoil|di[eé]sel|gnc)\s*[-–:]?\s*(.*)$/i);
        if (m) kind = 'combustible';
        else {
          m = x.name.match(/^\s*(?:reparaci[oó]n(?:es)?|mantenimiento|service)\s*[-–:]?\s*(.*)$/i);
          if (m) kind = 'mantenimiento';
        }
        if (!kind || !m[1].trim()) continue;
        x.kind = kind;
        x.vehicleId = findOrCreate(m[1].trim()).id;
      }
    }
    s.settings.vehicleSetupDone = true;
  }

  // ============================================================
  //  Dominio
  // ============================================================
  const currency = (code) => S.state && S.state.currencies.find((c) => c.code === code);
  const account = (id) => st().accounts.find((a) => a.id === id);
  const incCat = (id) => st().incomeCategories.find((c) => c.id === id);
  const expCat = (id) => st().expenseCategories.find((c) => c.id === id);
  const subOf = (cat, id) => cat && cat.subs.find((s) => s.id === id);

  function linkedTarget(acc) {
    if (acc && acc.type === 'debito' && acc.linkedAccountId) {
      const l = account(acc.linkedAccountId);
      if (l) return l;
    }
    return null;
  }
  const accCurrency = (acc) => { const l = linkedTarget(acc); return l ? l.currency : acc.currency; };
  const ledgerId = (id) => { const a = account(id); const l = linkedTarget(a); return l ? l.id : id; };
  const accName = (id) => { const a = account(id); return a ? a.name : 'Cuenta eliminada'; };

  function latestRate(code, dateISO = todayISO()) {
    if (code === BASE) return 1;
    const list = st().rates.filter((r) => r.currency === code).sort((a, b) => b.date.localeCompare(a.date));
    if (!list.length) return null;
    const hit = list.find((r) => r.date <= dateISO);
    return (hit || list[list.length - 1]).rate;
  }
  const txBase = (t) => round2(t.amount * (t.rate || 1));

  function categoryText(t) {
    if (t.type === 'ingreso') { const c = incCat(t.categoryId); return c ? c.name : 'Sin categoría'; }
    if (t.type === 'egreso') {
      const c = expCat(t.categoryId);
      if (!c) return 'Sin categoría';
      const s = subOf(c, t.subcategoryId);
      return s ? `${c.name} › ${s.name}` : c.name;
    }
    return `${accName(t.accountId)} → ${accName(t.toAccountId)}`;
  }

  // ---------- Vehículos ----------
  const vehicle = (id) => st().vehicles.find((v) => v.id === id);
  const mtype = (id) => st().maintenanceTypes.find((m) => m.id === id);
  const kmFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const l100Fmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const km = (n) => `${kmFmt.format(n)} km`;
  const l100 = (n) => `${l100Fmt.format(n)} L/100 km`;
  const parseKm = (v) => { const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : NaN; };
  function addMonthsISO(iso, n) {
    const ym = addMonths(iso.slice(0, 7), n);
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${pad(Math.min(Number(iso.slice(8, 10)), new Date(y, m, 0).getDate()))}`;
  }
  function subVehicleConfig(catId, subId) {
    const x = subOf(expCat(catId), subId);
    return x && x.kind && vehicle(x.vehicleId) ? x : null;
  }
  // Registros de un vehículo (una compra en cuotas cuenta una sola vez, por su total)
  function vehRecords(vid, kind) {
    const seen = new Set(), out = [];
    for (const t of st().transactions) {
      const v = t.vehicle;
      if (!v || v.vehicleId !== vid || (kind && v.kind !== kind)) continue;
      if (t.groupId) { if (seen.has(t.groupId)) continue; seen.add(t.groupId); }
      out.push({ t, v, cost: t.groupId ? round2((t.totalAmount || t.amount) * (t.rate || 1)) : txBase(t) });
    }
    return out;
  }
  function currentKm(vid) {
    let m = 0;
    for (const r of vehRecords(vid)) m = Math.max(m, r.v.km || 0);
    for (const k of (vehicle(vid)?.kmReadings || [])) m = Math.max(m, k.km);
    return m;
  }
  // Consumo por el método de tanque lleno a tanque lleno
  function fuelStats(vid) {
    const recs = vehRecords(vid, 'combustible').sort((a, b) => a.t.date.localeCompare(b.t.date) || (a.v.km || 0) - (b.v.km || 0));
    let lastFull = null, accL = 0, accCost = 0, totL = 0, totD = 0, totCost = 0;
    const rows = [];
    for (const r of recs) {
      const row = { ...r, l100: null };
      rows.push(row);
      // Sin kilometraje o sin litros no se puede medir: se corta el tramo y se empieza de nuevo en la próxima carga completa
      if (!(r.v.km > 0) || !(r.v.liters > 0)) { lastFull = null; accL = 0; accCost = 0; continue; }
      if (lastFull === null) { if (r.v.fullTank) lastFull = r.v.km; continue; }
      accL += r.v.liters; accCost += r.cost;
      if (r.v.fullTank) {
        const dist = r.v.km - lastFull;
        if (dist > 0) { row.l100 = (accL / dist) * 100; totL += accL; totD += dist; totCost += accCost; }
        lastFull = r.v.km; accL = 0; accCost = 0;
      }
    }
    rows.reverse();
    const lastRow = rows.find((r) => r.l100 !== null);
    return { rows, avg: totD ? (totL / totD) * 100 : null, last: lastRow ? lastRow.l100 : null, costKm: totD ? totCost / totD : null };
  }
  function estimateL100(vid, kmVal, liters, full, isExcluded) {
    if (!full || !(kmVal > 0) || !(liters > 0)) return null;
    const recs = vehRecords(vid, 'combustible').filter((r) => !isExcluded(r.t) && r.v.km > 0 && r.v.liters > 0 && r.v.km < kmVal).sort((a, b) => a.v.km - b.v.km);
    let idx = -1;
    for (let i = recs.length - 1; i >= 0; i--) if (recs[i].v.fullTank) { idx = i; break; }
    if (idx < 0) return null;
    let L = liters;
    for (let i = idx + 1; i < recs.length; i++) L += recs[i].v.liters;
    const dist = kmVal - recs[idx].v.km;
    return dist > 0 ? (L / dist) * 100 : null;
  }
  // Para cada tipo de trabajo vale el registro más reciente
  function reminders(vid) {
    const cur = currentKm(vid), today = new Date(todayISO() + 'T00:00');
    const latest = {};
    for (const r of vehRecords(vid, 'mantenimiento')) {
      for (const w of (r.v.works || [])) {
        const p = latest[w.typeId];
        if (!p || r.t.date > p.r.t.date || (r.t.date === p.r.t.date && (r.v.km || 0) > (p.r.v.km || 0))) latest[w.typeId] = { r, w };
      }
    }
    const out = [];
    for (const [typeId, { r, w }] of Object.entries(latest)) {
      if (!w.nextKm && !w.nextDate) continue;
      const kmLeft = w.nextKm ? w.nextKm - cur : null;
      const daysLeft = w.nextDate ? daysBetween(today, new Date(w.nextDate + 'T00:00')) : null;
      let status = 'ok';
      if ((kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0)) status = 'vencido';
      else if ((kmLeft !== null && kmLeft <= 1000) || (daysLeft !== null && daysLeft <= 30)) status = 'proximo';
      out.push({ typeId, name: mtype(typeId)?.name || 'Trabajo', lastDate: r.t.date, lastKm: r.v.km, nextKm: w.nextKm, nextDate: w.nextDate, kmLeft, daysLeft, status, txId: r.t.id });
    }
    const rank = { vencido: 0, proximo: 1, ok: 2 };
    return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || (a.kmLeft ?? 1e9) - (b.kmLeft ?? 1e9));
  }
  function reminderText(x) {
    const parts = [];
    if (x.nextKm) parts.push(`a los ${km(x.nextKm)} (${x.kmLeft <= 0 ? 'pasado por ' + km(-x.kmLeft) : 'faltan ' + km(x.kmLeft)})`);
    if (x.nextDate) parts.push(`el ${dateShort(x.nextDate)} (${x.daysLeft < 0 ? 'hace ' + -x.daysLeft + ' días' : x.daysLeft === 0 ? 'hoy' : 'en ' + x.daysLeft + ' días'})`);
    return parts.join(' o ');
  }
  const statusBadge = (st0) => (st0 === 'vencido' ? '<span class="badge off">vencido</span>' : st0 === 'proximo' ? '<span class="badge gold">próximo</span>' : '<span class="badge">al día</span>');
  const intervalText = (m) => {
    const p = [];
    if (m.intervalKm) p.push(km(m.intervalKm));
    if (m.intervalMonths) p.push(`${m.intervalMonths} meses`);
    return p.length ? `cada ${p.join(' o ')}` : 'sin intervalo';
  };

  function balances() {
    const map = {};
    st().accounts.forEach((a) => { if (!linkedTarget(a)) map[a.id] = Number(a.initialBalance) || 0; });
    const add = (id, v) => { const k = ledgerId(id); map[k] = round2((map[k] || 0) + v); };
    for (const t of st().transactions) {
      if (t.type === 'ingreso') add(t.accountId, t.amount);
      else if (t.type === 'egreso') add(t.accountId, -t.amount);
      else { add(t.accountId, -t.amount); add(t.toAccountId, t.toAmount); }
    }
    return map;
  }

  // Mes al que se imputa una compra según la tarjeta y la preferencia elegida
  function suggestedPeriod(acc, dateISO) {
    const base = ymOf(dateISO);
    if (!acc || acc.type !== 'credito') return base;
    const mode = st().settings.cardImputation;
    if (mode === 'compra') return base;
    const day = Number(dateISO.slice(8, 10));
    const close = Number(acc.closingDay) || 0;
    const closeMonth = close && day > close ? addMonths(base, 1) : base;
    return mode === 'cierre' ? closeMonth : addMonths(closeMonth, 1);
  }

  function monthSummary(ym) {
    let inc = 0, exp = 0;
    const byExp = {}, byInc = {};
    for (const t of st().transactions) {
      if (t.period !== ym || t.type === 'transferencia') continue;
      const v = txBase(t);
      if (t.type === 'ingreso') { inc += v; byInc[t.categoryId] = (byInc[t.categoryId] || 0) + v; }
      else { exp += v; byExp[t.categoryId] = (byExp[t.categoryId] || 0) + v; }
    }
    return { inc: round2(inc), exp: round2(exp), byExp, byInc };
  }

  function netWorth(bal) {
    let total = 0;
    const missing = [];
    for (const a of st().accounts) {
      if (!(a.id in bal)) continue;
      const r = latestRate(a.currency);
      if (r === null) { if (bal[a.id] !== 0) missing.push(a.currency); continue; }
      total += bal[a.id] * r;
    }
    return { total: round2(total), missing: [...new Set(missing)] };
  }

  // ============================================================
  //  UI general: toast, modal, navegación
  // ============================================================
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function openModal(title, html, opts = {}) {
    $('#modal-title').textContent = title;
    $('#modal').classList.toggle('wide', !!opts.wide);
    const body = $('#modal-body');
    body.innerHTML = html;
    const m = $('#modal');
    if (!m.open) m.showModal();
    body.scrollTop = 0;
    return body;
  }
  function closeModal() {
    const m = $('#modal');
    if (m.open) m.close();
    $('#modal-body').innerHTML = '';
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  $('#modal').addEventListener('close', () => { $('#modal-body').innerHTML = ''; });

  function go(view) {
    S.view = view;
    $$('.nav-btn[data-view]').forEach((b) => {
      const on = b.dataset.view === view || (b.closest('.bottom') && b.dataset.view === 'more' && MORE_VIEWS.includes(view));
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    $('#top-title').textContent = VIEW_TITLES[view] || 'Finanzas';
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (!S.state) return;
    const views = {
      dashboard: renderDashboard, movements: renderMovements, accounts: renderAccounts, vehicles: renderVehicles,
      budget: renderBudget, analysis: renderAnalysis, dues: renderDues, recon: renderRecon, projection: renderProjection,
      categories: renderCategories, currencies: renderCurrencies, settings: renderSettings, more: renderMore,
    };
    destroyCharts();
    $('#main').innerHTML = (views[S.view] || renderDashboard)();
    afterRender();
  }

  function afterRender() {
    // Anchos de barras (se asignan por JS para no depender de estilos en línea)
    $$('[data-w]').forEach((el) => { el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.w)))}%`; });
    $$('[data-l]').forEach((el) => { el.style.left = `${Math.max(0, Math.min(100, Number(el.dataset.l)))}%`; });
    if (S.view === 'analysis' || S.view === 'projection') bindAnalysis();
    if (S.view === 'recon') bindRecon();
    if (S.view === 'movements') bindMovementFilters();
    if (S.view === 'settings') bindSettings();
  }

  function monthNav() {
    return `<div class="month-nav">
      <button class="icon-btn" data-action="month-prev" aria-label="Mes anterior">‹</button>
      <button class="btn ghost small label" data-action="month-today" title="Ir al mes actual">${esc(ymTitle(S.month))}</button>
      <button class="icon-btn" data-action="month-next" aria-label="Mes siguiente">›</button>
    </div>`;
  }

  // ============================================================
  //  Vista: Resumen
  // ============================================================
  function renderDashboard() {
    const s = st();
    const sum = monthSummary(S.month);
    const res = round2(sum.inc - sum.exp);
    const bal = balances();
    const nw = netWorth(bal);

    let strip = '', legend = '';
    if (sum.inc > 0 || sum.exp > 0) {
      if (sum.inc >= sum.exp) {
        const spent = sum.inc ? (sum.exp / sum.inc) * 100 : 0;
        strip = `<i class="out" data-w="${spent}"></i><i class="in" data-w="${100 - spent}"></i>`;
        legend = `<span><i class="out"></i>Gastado: ${Math.round(spent)}% de lo que ingresó</span><span><i class="in"></i>Quedó: ${Math.round(100 - spent)}%</span>`;
      } else {
        const covered = (sum.inc / sum.exp) * 100;
        strip = `<i class="out" data-w="${covered}"></i><i class="gap" data-w="${100 - covered}"></i>`;
        legend = `<span><i class="out"></i>Cubierto por ingresos: ${Math.round(covered)}%</span><span><i class="gap"></i>Gastado de más: ${Math.round(100 - covered)}%</span>`;
      }
    }

    let backupWarn = '';
    if (s.transactions.length) {
      const last = s.settings.lastBackupAt ? new Date(s.settings.lastBackupAt) : null;
      const days = last ? daysBetween(last, new Date()) : null;
      if (!last || days > 14) {
        backupWarn = `<div class="warn">${last ? `Tu último backup es de hace ${days} días.` : 'Todavía no hiciste ningún backup.'}
          Si este dispositivo se pierde o se borra el navegador, los datos no se pueden recuperar sin un backup.
          <div class="actions"><button class="btn small" data-view="settings">Hacer un backup</button></div></div>`;
      }
    }

    const alerts = s.vehicles.filter((v) => v.active)
      .flatMap((v) => reminders(v.id).filter((r) => r.status !== 'ok').map((r) => ({ ...r, v })));
    const alertsHtml = alerts.length ? `<section class="panel">
        <div class="panel-head"><h2>Mantenimiento de vehículos</h2><button class="btn ghost small" data-view="vehicles">Ver vehículos</button></div>
        <ul class="list">${alerts.map((a) => `<li><div class="grow"><div class="title">${esc(a.name)}, ${esc(a.v.name)}</div><div class="sub">${esc(reminderText(a))}</div></div>${statusBadge(a.status)}</li>`).join('')}</ul>
      </section>` : '';

    if (!s.transactions.length) {
      return `<div class="view-head"><h1>Resumen</h1>${monthNav()}</div>
        <div class="panel empty">
          <h2>Empezá cargando tus cuentas</h2>
          <p>Agregá tus cuentas bancarias, tarjetas y billeteras con su saldo actual. Después registrá tus movimientos y acá vas a ver el resultado de cada mes.</p>
          <div class="actions" style="justify-content:center">
            <button class="btn" data-view="accounts">Cargar cuentas</button>
            <button class="btn primary" data-action="new-tx">Nuevo movimiento</button>
          </div>
        </div>`;
    }

    const expRows = Object.entries(sum.byExp).sort((a, b) => b[1] - a[1]);
    const maxExp = expRows.length ? expRows[0][1] : 1;
    const incRows = Object.entries(sum.byInc).sort((a, b) => b[1] - a[1]);
    const maxInc = incRows.length ? incRows[0][1] : 1;

    const barList = (rows, max, kind) => rows.length ? `<div class="bars">${rows.map(([id, v]) => {
      const c = kind === 'in' ? incCat(id) : expCat(id);
      return `<div class="bar-row clickable" data-action="filter-cat" data-id="${esc(id)}" data-kind="${kind}" role="button" tabindex="0">
        <div class="bar-label"><span>${esc(c ? c.name : 'Sin categoría')}</span><span class="num">${money(v)}</span></div>
        <div class="bar-track"><div class="bar-fill ${kind === 'in' ? 'in' : ''}" data-w="${(v / max) * 100}"></div></div>
      </div>`;
    }).join('')}</div>` : `<p class="muted">Sin ${kind === 'in' ? 'ingresos' : 'egresos'} en este mes.</p>`;

    // Cuotas ya comprometidas en los próximos meses
    const commits = [];
    for (let i = 1; i <= 6; i++) {
      const ym = addMonths(S.month, i);
      const v = s.transactions.filter((t) => t.type === 'egreso' && t.installmentsTotal > 1 && t.period === ym)
        .reduce((a, t) => a + txBase(t), 0);
      if (v > 0) commits.push([ym, round2(v)]);
    }

    const accRows = s.accounts.filter((a) => a.id in bal && (a.active || bal[a.id] !== 0)).map((a) => {
      const v = bal[a.id];
      const r = latestRate(a.currency);
      const eq = a.currency !== BASE ? `<div class="sub num">${r === null ? 'sin cotización' : '≈ ' + money(v * r)}</div>` : '';
      return `<li class="clickable" data-action="edit-account" data-id="${esc(a.id)}">
        <div class="grow"><div class="title">${esc(a.name)}</div><div class="sub">${esc(ACCOUNT_TYPES[a.type] || a.type)}</div></div>
        <div class="amt"><div class="num ${v < 0 ? 'neg' : ''}">${money(v, a.currency)}</div>${eq}</div></li>`;
    }).join('');

    return `<div class="view-head"><h1>Resumen</h1>${monthNav()}</div>
      ${backupWarn}
      ${alertsHtml}
      ${dashDues()}
      <section class="panel result">
        <div class="result-top">
          <div>
            <div class="result-big num ${res < 0 ? 'neg' : 'pos'}">${money(res)}</div>
            <div class="result-caption">Resultado de ${esc(ymLabel(S.month))}</div>
          </div>
          <div class="flow">
            <div><span>Ingresos</span><strong class="num pos">${money(sum.inc)}</strong></div>
            <div><span>Egresos</span><strong class="num neg">${money(sum.exp)}</strong></div>
          </div>
        </div>
        ${strip ? `<div class="balance-strip">${strip}</div><div class="legend">${legend}</div>` : ''}
        ${dashBudgetLine(sum.exp)}
      </section>
      <div class="grid2">
        <div class="stack">
          <section class="panel"><div class="panel-head"><h2>Egresos por categoría</h2></div>${barList(expRows, maxExp, 'out')}</section>
          <section class="panel"><div class="panel-head"><h2>Ingresos por categoría</h2></div>${barList(incRows, maxInc, 'in')}</section>
        </div>
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Saldos actuales</h2><button class="btn ghost small" data-view="accounts">Ver cuentas</button></div>
            <ul class="list">${accRows || '<li class="muted">No hay cuentas.</li>'}</ul>
            <div class="total-row"><span>Patrimonio en pesos</span><span class="num ${nw.total < 0 ? 'neg' : ''}">${money(nw.total)}</span></div>
            ${nw.missing.length ? `<p class="hint" style="margin-top:.5rem">Falta la cotización de ${esc(nw.missing.join(', '))}; esas cuentas no se suman.</p>` : ''}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Cuotas comprometidas</h2><span class="muted small">próximos 6 meses</span></div>
            ${commits.length ? `<ul class="list">${commits.map(([ym, v]) => `<li><div class="grow">${esc(ymTitle(ym))}</div><div class="num">${money(v)}</div></li>`).join('')}</ul>`
              : '<p class="muted">No hay cuotas pendientes después de este mes.</p>'}
          </section>
        </div>
      </div>`;
  }

  // ============================================================
  //  Vista: Movimientos
  // ============================================================
  function filteredTx() {
    const f = S.filters;
    const q = f.q.trim().toLowerCase();
    return st().transactions.filter((t) => {
      const byDate = f.from || f.to;
      if (byDate) {
        if (f.from && t.date < f.from) return false;
        if (f.to && t.date > f.to) return false;
      } else if (!f.all && t.period !== S.month) return false;
      if (f.type && t.type !== f.type) return false;
      if (f.account && t.accountId !== f.account && t.toAccountId !== f.account) return false;
      if (f.category) {
        const [kind, id] = f.category.split(':');
        if (kind === 'in' && !(t.type === 'ingreso' && t.categoryId === id)) return false;
        if (kind === 'out' && !(t.type === 'egreso' && t.categoryId === id)) return false;
        if (kind === 'out' && f.sub && (t.subcategoryId || '') !== (f.sub === '_none' ? '' : f.sub)) return false;
      }
      if (q) {
        const hay = `${t.description || ''} ${categoryText(t)} ${accName(t.accountId)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '') || (a.installmentNo || 0) - (b.installmentNo || 0));
  }

  function txRow(t) {
    const cur = t.currency || BASE;
    let amountHtml, cls;
    if (t.type === 'transferencia') {
      cls = '';
      amountHtml = `<div class="num">${money(t.amount, cur)}</div>`;
      if ((t.toCurrency || cur) !== cur) amountHtml += `<div class="sub num">→ ${money(t.toAmount, t.toCurrency)}</div>`;
      else amountHtml += `<div class="sub">${esc(accName(t.toAccountId))}</div>`;
    } else {
      const refund = t.type === 'egreso' && t.amount < 0;
      cls = t.type === 'ingreso' || refund ? 'pos' : 'neg';
      const sign = t.type === 'ingreso' ? '' : refund ? '+' : '−';
      amountHtml = `<div class="num ${cls}">${sign}${money(Math.abs(t.amount), cur)}</div>`;
      if (cur !== BASE) amountHtml += `<div class="sub num">≈ ${money(Math.abs(txBase(t)))}</div>`;
    }
    const title = t.description || (t.type === 'transferencia' ? 'Transferencia' : categoryText(t));
    const subLine = t.type === 'transferencia'
      ? categoryText(t)
      : [t.description ? categoryText(t) : null, accName(t.accountId), t.vehicle && t.vehicle.km ? km(t.vehicle.km) : null].filter(Boolean).join(', ');
    let badges = '';
    if (t.type === 'egreso' && t.amount < 0) badges += '<span class="badge pay">reintegro</span>';
    if (t.installmentsTotal > 1) badges += `<span class="badge gold">cuota ${t.installmentNo}/${t.installmentsTotal}</span>`;
    if (t.recon && st().statements.some((x) => x.id === t.recon)) badges += '<span class="badge pay">conciliado</span>';
    if (S.filters.all || t.period !== ymOf(t.date)) badges += `<span class="badge">${esc(ymShort(t.period))}</span>`;
    return `<li class="clickable" data-action="edit-tx" data-id="${esc(t.id)}">
      <span class="dot ${t.type}" aria-hidden="true"></span>
      <div class="grow"><div class="title">${esc(title)}${badges}</div><div class="sub">${esc(subLine)}</div></div>
      <div class="amt">${amountHtml}</div></li>`;
  }

  function renderMovementList() {
    const list = filteredTx();
    if (!list.length) {
      const any = st().transactions.length;
      return `<div class="empty"><p>${any ? 'No hay movimientos con estos filtros.' : 'Todavía no registraste movimientos.'}</p>
        <button class="btn primary" data-action="new-tx">Nuevo movimiento</button></div>`;
    }
    let inc = 0, exp = 0, html = '', lastDate = null, open = false;
    for (const t of list) {
      if (t.type === 'ingreso') inc += txBase(t);
      if (t.type === 'egreso') exp += txBase(t);
    }
    const limit = S.mvLimit || 300;
    for (const t of list.slice(0, limit)) {
      if (t.date !== lastDate) {
        if (open) html += '</ul>';
        html += `<div class="day-head">${esc(cap(dateLabel(t.date)))}</div><ul class="list">`;
        open = true; lastDate = t.date;
      }
      html += txRow(t);
    }
    if (open) html += '</ul>';
    if (list.length > limit) html += `<div class="actions" style="justify-content:center"><button class="btn" data-action="mv-more">Mostrar más (${list.length - limit} restantes)</button></div>`;
    return `<div class="totals" style="margin-bottom:.8rem">
        <span>${list.length} movimiento${list.length === 1 ? '' : 's'}</span>
        <span>Ingresos <strong class="num pos">${money(round2(inc))}</strong></span>
        <span>Egresos <strong class="num neg">${money(round2(exp))}</strong></span>
      </div>${html}`;
  }

  function renderMovements() {
    const s = st(), f = S.filters;
    const accOpts = s.accounts.map((a) => `<option value="${esc(a.id)}" ${f.account === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    const catOpts = `<optgroup label="Egresos">${s.expenseCategories.map((c) => `<option value="out:${esc(c.id)}" ${f.category === 'out:' + c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
      <optgroup label="Ingresos">${s.incomeCategories.map((c) => `<option value="in:${esc(c.id)}" ${f.category === 'in:' + c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
    const byDate = f.from || f.to;
    const fc = f.category.startsWith('out:') ? expCat(f.category.slice(4)) : null;
    const subSel = fc && fc.subs.length ? `<select id="flt-sub" aria-label="Subcategoría"><option value="">Todas las subcategorías</option>${fc.subs.map((x) => `<option value="${esc(x.id)}" ${f.sub === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="_none" ${f.sub === '_none' ? 'selected' : ''}>Sin subcategoría</option></select>` : '';
    const anyFilter = f.q || f.type || f.account || f.category || f.from || f.to;
    return `<div class="view-head"><h1>Movimientos</h1>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          ${byDate ? '<span class="muted small">Filtrando por fechas</span>' : `${f.all ? '' : monthNav()}
          <label class="check" style="margin:0"><input type="checkbox" id="flt-all" ${f.all ? 'checked' : ''}>Todos los meses</label>`}
          ${anyFilter ? '<button class="btn ghost small" data-action="mv-clear">Limpiar filtros</button>' : ''}
        </div></div>
      <div class="filters">
        <input class="wide" id="flt-q" type="search" placeholder="Buscar por descripción, categoría o cuenta" value="${esc(f.q)}" aria-label="Buscar">
        <select id="flt-type" aria-label="Tipo">
          <option value="">Todos los tipos</option>
          <option value="egreso" ${f.type === 'egreso' ? 'selected' : ''}>Egresos</option>
          <option value="ingreso" ${f.type === 'ingreso' ? 'selected' : ''}>Ingresos</option>
          <option value="transferencia" ${f.type === 'transferencia' ? 'selected' : ''}>Transferencias</option>
        </select>
        <select id="flt-account" aria-label="Cuenta"><option value="">Todas las cuentas</option>${accOpts}</select>
        <select id="flt-cat" aria-label="Categoría"><option value="">Todas las categorías</option>${catOpts}</select>
        ${subSel}
        <label class="flt-date"><span>Desde</span><input type="date" id="flt-from" value="${esc(f.from)}"></label>
        <label class="flt-date"><span>Hasta</span><input type="date" id="flt-to" value="${esc(f.to)}"></label>
      </div>
      <section class="panel" id="mv-list">${renderMovementList()}</section>`;
  }

  function bindMovementFilters() {
    const refresh = () => { S.mvLimit = 300; $('#mv-list').innerHTML = renderMovementList(); };
    $('#flt-q').addEventListener('input', (e) => { S.filters.q = e.target.value; refresh(); });
    $('#flt-type').addEventListener('change', (e) => { S.filters.type = e.target.value; refresh(); });
    $('#flt-account').addEventListener('change', (e) => { S.filters.account = e.target.value; refresh(); });
    $('#flt-cat').addEventListener('change', (e) => { S.filters.category = e.target.value; S.filters.sub = ''; S.mvLimit = 300; render(); });
    $('#flt-sub')?.addEventListener('change', (e) => { S.filters.sub = e.target.value; refresh(); });
    $('#flt-from').addEventListener('change', (e) => { S.filters.from = e.target.value; S.mvLimit = 300; render(); });
    $('#flt-to').addEventListener('change', (e) => { S.filters.to = e.target.value; S.mvLimit = 300; render(); });
    $('#flt-all')?.addEventListener('change', (e) => { S.filters.all = e.target.checked; render(); });
  }

  // ============================================================
  //  Formulario de movimiento
  // ============================================================
  function openTxForm(existing, preset = {}) {
    const s = st();
    let group = null;
    if (existing && existing.groupId) {
      group = s.transactions.filter((t) => t.groupId === existing.groupId).sort((a, b) => a.installmentNo - b.installmentNo);
    }
    const first = group ? group[0] : existing;
    const activeAccs = s.accounts.filter((a) => a.active);
    if (!activeAccs.length) { toast('Primero creá una cuenta activa.'); go('accounts'); return; }

    const type0 = first ? first.type : (preset.type || 'egreso');
    const d = {
      type: type0,
      date: first ? first.date : (preset.date || todayISO()),
      accountId: first ? first.accountId : (preset.accountId && account(preset.accountId) ? preset.accountId
        : S.lastAccount[type0] && account(S.lastAccount[type0])?.active ? S.lastAccount[type0] : activeAccs[0].id),
      toAccountId: first ? (first.toAccountId || '') : '',
      amount: group ? round2(group.reduce((a, t) => a + t.amount, 0)) : (first ? first.amount : (preset.amount || '')),
      toAmount: first && first.type === 'transferencia' ? first.toAmount : '',
      rate: first && first.type !== 'transferencia' ? first.rate : null,
      categoryId: first ? first.categoryId : (preset.categoryId || ''),
      subcategoryId: first ? first.subcategoryId : (preset.subcategoryId || ''),
      description: first ? (first.description || '') : (preset.description || ''),
      installments: group ? group.length : 1,
      period: first ? first.period : null,
    };
    let periodTouched = !!first;
    const startRefund = d.type === 'egreso' && Number(d.amount) < 0;
    if (startRefund) d.amount = Math.abs(d.amount);
    const veh0 = first && first.vehicle ? JSON.parse(JSON.stringify(first.vehicle)) : null;
    let vehKey = null;
    const isSelf = (t) => !!existing && (t.id === existing.id || (!!existing.groupId && t.groupId === existing.groupId));
    let rateTouched = !!(first && first.rate && first.currency !== BASE);

    const title = existing ? 'Editar movimiento' : (preset.title || 'Nuevo movimiento');
    const body = openModal(title, `
      <form id="txf" novalidate>
        <div class="seg" role="group" aria-label="Tipo de movimiento">
          <button type="button" data-type="egreso">Egreso</button>
          <button type="button" data-type="ingreso">Ingreso</button>
          <button type="button" data-type="transferencia">Transferencia</button>
        </div>
        <div class="row">
          <label class="field"><span>Fecha</span><input type="date" id="f-date" value="${esc(d.date)}" required></label>
          <label class="field"><span id="f-amount-l">Monto</span><input id="f-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(numForInput(d.amount))}"></label>
        </div>
        <label class="check" id="w-refund"><input type="checkbox" id="f-refund" ${startRefund ? 'checked' : ''}>Es un reintegro, descuento o devolución (resta del gasto)</label>
        <label class="field"><span id="f-account-l">Cuenta</span><select id="f-account"></select></label>
        <div id="w-to">
          <label class="field"><span>Hacia la cuenta</span><select id="f-to"></select></label>
          <label class="field" id="w-toamount"><span id="f-toamount-l">Monto que ingresa</span><input id="f-toamount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(numForInput(d.toAmount))}"></label>
        </div>
        <div id="w-cat">
          <label class="field"><span>Categoría</span><select id="f-cat"></select></label>
          <label class="field" id="w-sub"><span>Subcategoría</span><select id="f-sub"></select></label>
        </div>
        <div id="w-veh" hidden></div>
        <div class="row" id="w-rate-inst">
          <label class="field" id="w-rate"><span id="f-rate-l">Cotización</span><input id="f-rate" inputmode="decimal" autocomplete="off" value="${esc(numForInput(d.rate))}"></label>
          <label class="field" id="w-inst"><span>Cuotas</span><input id="f-inst" type="number" min="1" max="72" step="1" inputmode="numeric" value="${d.installments}"></label>
        </div>
        <label class="field" id="w-period"><span id="f-period-l">Mes de imputación</span><select id="f-period"></select></label>
        <div class="preview" id="f-preview" hidden></div>
        <label class="field"><span>Descripción</span><input id="f-desc" maxlength="140" autocomplete="off" placeholder="Opcional" value="${esc(d.description)}"></label>
        <p class="error" id="f-err"></p>
        <div class="actions">
          ${existing ? '<button type="button" class="btn danger" id="f-del">Eliminar</button><span class="spacer"></span>' : ''}
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="submit" class="btn primary">Guardar</button>
        </div>
      </form>`);

    const el = (id) => $('#' + id, body);
    const show = (id, on) => { el(id).hidden = !on; };

    function accOptions(selected, excludeId) {
      return s.accounts.filter((a) => (a.active || a.id === selected) && a.id !== excludeId)
        .map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}${accCurrency(a) !== BASE ? ' (' + esc(accCurrency(a)) + ')' : ''}</option>`).join('');
    }
    function catOptions() {
      const list = d.type === 'ingreso' ? s.incomeCategories : s.expenseCategories;
      const opts = list.filter((c) => c.active || c.id === d.categoryId);
      if (!opts.some((c) => c.id === d.categoryId)) d.categoryId = '';
      return '<option value="">Elegí una categoría</option>' + opts.map((c) => `<option value="${esc(c.id)}" ${c.id === d.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    }
    function subOptions() {
      const c = expCat(d.categoryId);
      const subs = c ? c.subs.filter((x) => x.active || x.id === d.subcategoryId).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })) : [];
      if (!subs.some((x) => x.id === d.subcategoryId)) d.subcategoryId = '';
      return { count: subs.length, html: '<option value="">Elegí una subcategoría</option>' + subs.map((x) => `<option value="${esc(x.id)}" ${x.id === d.subcategoryId ? 'selected' : ''}>${esc(x.name)}</option>`).join('') };
    }
    function periodOptions(center, selected) {
      const out = [];
      for (let i = -6; i <= 18; i++) out.push(addMonths(center, i));
      if (selected && !out.includes(selected)) out.push(selected);
      out.sort();
      return out.map((ym) => `<option value="${ym}" ${ym === selected ? 'selected' : ''}>${esc(ymTitle(ym))}</option>`).join('');
    }

    function refreshAll() {
      $$('.seg button', body).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === d.type)));
      const isT = d.type === 'transferencia';
      el('f-account-l').textContent = isT ? 'Desde la cuenta' : 'Cuenta';
      el('f-account').innerHTML = accOptions(d.accountId);
      if (!account(d.accountId)) d.accountId = el('f-account').value;
      show('w-to', isT);
      show('w-cat', !isT);
      if (isT) {
        if (d.toAccountId === d.accountId) d.toAccountId = '';
        el('f-to').innerHTML = '<option value="">Elegí la cuenta destino</option>' + accOptions(d.toAccountId, d.accountId);
      } else {
        el('f-cat').innerHTML = catOptions();
      }
      refreshDependent();
    }

    function refreshDependent() {
      const isT = d.type === 'transferencia';
      const acc = account(d.accountId);
      const cur = acc ? accCurrency(acc) : BASE;
      const curObj = currency(cur);
      el('f-amount-l').textContent = `Monto${curObj ? ' en ' + curObj.symbol : ''}`;
      show('w-refund', d.type === 'egreso');

      // Subcategorías
      if (!isT && d.type === 'egreso') {
        const so = subOptions();
        el('f-sub').innerHTML = so.html;
        show('w-sub', so.count > 0);
      } else show('w-sub', false);

      // Transferencia entre monedas distintas
      const to = account(d.toAccountId);
      const toCur = to ? accCurrency(to) : null;
      const crossCur = isT && toCur && toCur !== cur;
      show('w-toamount', !!crossCur);
      if (crossCur) el('f-toamount-l').textContent = `Monto que ingresa en ${currency(toCur)?.symbol || toCur}`;

      // Cotización
      const needRate = !isT && cur !== BASE;
      show('w-rate', needRate);
      if (needRate) {
        el('f-rate-l').textContent = `Cotización (pesos por ${curObj ? curObj.symbol : cur})`;
        if (!rateTouched) {
          const r = latestRate(cur, d.date);
          el('f-rate').value = r === null ? '' : numForInput(r);
        }
      }

      // Cuotas (solo egresos con tarjeta de crédito)
      const canInst = d.type === 'egreso' && acc && acc.type === 'credito';
      show('w-inst', canInst);
      if (!canInst) el('f-inst').value = '1';
      show('w-rate-inst', needRate || canInst);

      // Mes de imputación
      show('w-period', !isT);
      if (!periodTouched || !d.period) d.period = isT ? ymOf(d.date) : suggestedPeriod(acc, d.date);
      const nInst = Math.max(1, parseInt(el('f-inst').value, 10) || 1);
      el('f-period-l').textContent = nInst > 1 ? 'Primera cuota en' : 'Mes de imputación';
      el('f-period').innerHTML = periodOptions(ymOf(d.date), d.period);
      refreshVeh();
      updatePreview();
    }

    // ----- Datos del vehículo según la subcategoría -----
    function vehTarget() {
      if (d.type !== 'egreso') return null;
      const x = subVehicleConfig(d.categoryId, d.subcategoryId);
      if (!x) return null;
      // Al editar un registro viejo se conserva su vehículo aunque la subcategoría hoy apunte a otro auto
      const keepOld = veh0 && first.subcategoryId === d.subcategoryId && veh0.kind === x.kind && vehicle(veh0.vehicleId);
      return { kind: x.kind, vehicleId: keepOld ? veh0.vehicleId : x.vehicleId };
    }
    function fillWorkDefaults() {
      const kmVal = el('v-km') ? parseKm(el('v-km').value) : NaN;
      $$('.work', body).forEach((w) => {
        if (!$('.w-on', w).checked) return;
        const m = mtype(w.dataset.type);
        if (!m) return;
        const k = $('.w-km', w), dt = $('.w-date', w);
        if (!k.dataset.touched) k.value = kmVal > 0 && m.intervalKm ? kmFmt.format(kmVal + m.intervalKm) : '';
        if (!dt.dataset.touched) dt.value = m.intervalMonths ? addMonthsISO(d.date, m.intervalMonths) : '';
      });
    }
    function refreshVeh() {
      const tg = vehTarget();
      const key = tg ? `${tg.kind}:${tg.vehicleId}` : null;
      if (key === vehKey) return;
      vehKey = key;
      const w = el('w-veh');
      w.hidden = !tg;
      if (!tg) { w.innerHTML = ''; return; }
      const v = vehicle(tg.vehicleId);
      const src = veh0 && veh0.kind === tg.kind ? veh0 : null;
      const curKm = currentKm(v.id);
      let html = `<div class="veh-box">
        <div class="veh-title"><strong>${esc(v.name)}</strong>${curKm ? `<span class="muted small">último registro: ${km(curKm)}</span>` : ''}</div>
        <div class="row"><label class="field"><span>Kilometraje (opcional)</span><input id="v-km" inputmode="numeric" autocomplete="off" value="${src && src.km ? esc(kmFmt.format(src.km)) : ''}" placeholder="${curKm ? esc(kmFmt.format(curKm)) : 'Ej.: 45.230'}"></label>`;
      if (tg.kind === 'combustible') {
        html += `<label class="field"><span>Litros (opcional)</span><input id="v-lt" inputmode="decimal" autocomplete="off" value="${src && src.liters ? esc(numForInput(src.liters)) : ''}"></label></div>
          <label class="check"><input type="checkbox" id="v-full" ${!src || src.fullTank ? 'checked' : ''}>Llené el tanque</label>
          <p class="hint">El consumo se calcula entre dos cargas con tanque lleno que tengan kilometraje y litros. Si cargaste solo una parte, destildalo: esos litros se suman a la próxima carga completa.</p>`;
      } else {
        const works = src ? src.works || [] : [];
        html += `<div></div></div><span class="flabel">Trabajos realizados</span><div class="works">` +
          st().maintenanceTypes.filter((m) => m.active || works.some((x) => x.typeId === m.id)).map((m) => {
            const wk = works.find((x) => x.typeId === m.id);
            return `<div class="work" data-type="${esc(m.id)}">
              <label class="check"><input type="checkbox" class="w-on" ${wk ? 'checked' : ''}>${esc(m.name)}</label>
              <div class="row w-next" ${wk ? '' : 'hidden'}>
                <label class="field"><span>Próximo a los km</span><input class="w-km" inputmode="numeric" autocomplete="off" value="${wk && wk.nextKm ? esc(kmFmt.format(wk.nextKm)) : ''}" ${wk ? 'data-touched="1"' : ''}></label>
                <label class="field"><span>O en la fecha</span><input class="w-date" type="date" value="${wk && wk.nextDate ? esc(wk.nextDate) : ''}" ${wk ? 'data-touched="1"' : ''}></label>
              </div></div>`;
          }).join('') +
          `</div><p class="hint">El recordatorio avisa con lo que ocurra primero. Los intervalos sugeridos se configuran en Vehículos. Dejá ambos campos vacíos si no querés recordatorio.</p>`;
      }
      w.innerHTML = html + '</div>';
      el('v-km').addEventListener('input', () => { fillWorkDefaults(); updatePreview(); });
      if (el('v-lt')) { el('v-lt').addEventListener('input', updatePreview); el('v-full').addEventListener('change', updatePreview); }
      $$('.work', w).forEach((wEl) => {
        $('.w-on', wEl).addEventListener('change', (e) => { $('.w-next', wEl).hidden = !e.target.checked; fillWorkDefaults(); });
        $$('.w-km, .w-date', wEl).forEach((i) => i.addEventListener('input', () => { i.dataset.touched = '1'; }));
      });
    }

    function updatePreview() {
      const acc = account(d.accountId);
      const cur = acc ? accCurrency(acc) : BASE;
      let amt = parseAmount(el('f-amount').value);
      const lines = [];
      if (d.type === 'egreso' && amt < 0) { el('f-refund').checked = true; }
      if (d.type === 'egreso') amt = Math.abs(amt);
      if (d.type === 'egreso' && el('f-refund').checked && amt > 0) lines.push('Reintegro: se descuenta del gasto de la categoría en el mes elegido y suma al saldo de la cuenta.');
      if (d.type === 'transferencia') {
        const to = account(d.toAccountId);
        const toCur = to ? accCurrency(to) : null;
        const toAmt = parseAmount(el('f-toamount').value);
        if (toCur && toCur !== cur && amt > 0 && toAmt > 0) {
          if (cur === BASE) lines.push(`Tipo de cambio implícito: ${money(amt / toAmt)} por ${esc(currency(toCur)?.symbol || toCur)}`);
          else if (toCur === BASE) lines.push(`Tipo de cambio implícito: ${money(toAmt / amt)} por ${esc(currency(cur)?.symbol || cur)}`);
          else lines.push(`Relación: 1 ${esc(cur)} = ${rateFmt.format(toAmt / amt)} ${esc(toCur)}`);
        }
        lines.push('Las transferencias no cuentan como ingreso ni egreso.');
      } else if (amt > 0) {
        const n = Math.max(1, parseInt(el('f-inst').value, 10) || 1);
        if (n > 1) {
          const each = round2(amt / n);
          lines.push(`${n} cuotas de ${money(each, cur)}, de ${ymLabel(d.period)} a ${ymLabel(addMonths(d.period, n - 1))}.`);
        }
        if (cur !== BASE) {
          const r = parseAmount(el('f-rate').value);
          lines.push(r > 0 ? `Equivale a ${money(amt * r)}.` : 'Cargá la cotización para calcular el equivalente en pesos.');
        }
        const tg = el('v-lt') ? vehTarget() : null;
        if (tg) {
          const lt = parseAmount(el('v-lt').value);
          if (lt > 0) {
            lines.push(`Precio por litro: ${money(amt / lt, cur)}.`);
            const est = estimateL100(tg.vehicleId, parseKm(el('v-km').value), lt, el('v-full').checked, isSelf);
            if (est !== null) lines.push(`Consumo desde la última carga completa: ${l100(est)}.`);
          }
        }
      }
      el('f-preview').hidden = !lines.length;
      el('f-preview').innerHTML = lines.join('<br>');
    }

    // Eventos
    $$('.seg button', body).forEach((b) => b.addEventListener('click', () => {
      if (d.type === b.dataset.type) return;
      d.type = b.dataset.type;
      d.categoryId = ''; d.subcategoryId = '';
      periodTouched = false;
      refreshAll();
    }));
    el('f-date').addEventListener('change', (e) => { if (e.target.value) { d.date = e.target.value; periodTouched = false; refreshDependent(); fillWorkDefaults(); } });
    el('f-account').addEventListener('change', (e) => {
      d.accountId = e.target.value; periodTouched = false; rateTouched = false;
      if (d.type === 'transferencia') refreshAll(); else refreshDependent();
    });
    el('f-to').addEventListener('change', (e) => { d.toAccountId = e.target.value; refreshDependent(); });
    el('f-cat').addEventListener('change', (e) => { d.categoryId = e.target.value; d.subcategoryId = ''; refreshDependent(); });
    el('f-sub').addEventListener('change', (e) => { d.subcategoryId = e.target.value; refreshVeh(); updatePreview(); });
    el('f-period').addEventListener('change', (e) => { d.period = e.target.value; periodTouched = true; updatePreview(); });
    el('f-rate').addEventListener('input', () => { rateTouched = true; updatePreview(); });
    el('f-inst').addEventListener('input', () => { refreshDependentLight(); });
    el('f-amount').addEventListener('input', updatePreview);
    el('f-refund').addEventListener('change', updatePreview);
    el('f-toamount').addEventListener('input', updatePreview);
    function refreshDependentLight() {
      const n = Math.max(1, parseInt(el('f-inst').value, 10) || 1);
      el('f-period-l').textContent = n > 1 ? 'Primera cuota en' : 'Mes de imputación';
      updatePreview();
    }

    if (existing) {
      el('f-del').addEventListener('click', () => {
        const msg = group ? `¿Eliminar la compra completa (${group.length} cuotas)?` : '¿Eliminar este movimiento?';
        if (!confirm(msg)) return;
        s.transactions = s.transactions.filter((t) => (group ? t.groupId !== existing.groupId : t.id !== existing.id));
        closeModal();
        commit('Movimiento eliminado');
      });
    }

    el('txf').addEventListener('submit', (e) => {
      e.preventDefault();
      const err = (m) => { el('f-err').textContent = m; };
      d.description = el('f-desc').value.trim();
      d.date = el('f-date').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return err('Ingresá una fecha válida.');
      const acc = account(d.accountId);
      if (!acc) return err('Elegí una cuenta.');
      const cur = accCurrency(acc);
      let amt = parseAmount(el('f-amount').value);
      if (Number.isNaN(amt) || amt === 0) return err('Ingresá un monto distinto de cero. Usá coma para los decimales.');
      let sign = 1;
      if (d.type === 'egreso') { if (amt < 0 || el('f-refund').checked) sign = -1; amt = Math.abs(amt); }
      else if (amt < 0 && !(existing && existing.type === 'ingreso' && existing.amount < 0 && d.type === 'ingreso')) return err(d.type === 'ingreso' ? 'El ingreso tiene que ser mayor a cero. Si es una devolución de un gasto, cargalo como egreso marcado como reintegro.' : 'El monto tiene que ser mayor a cero.');
      const now = new Date().toISOString();
      const keepCreated = first ? first.createdAt || now : now;
      let newTx = [];

      if (d.type === 'transferencia') {
        const to = account(d.toAccountId);
        if (!to) return err('Elegí la cuenta destino.');
        if (to.id === acc.id) return err('La cuenta destino tiene que ser distinta.');
        const toCur = accCurrency(to);
        let toAmt = amt;
        if (toCur !== cur) {
          toAmt = parseAmount(el('f-toamount').value);
          if (!(toAmt > 0)) return err('Ingresá el monto que ingresa en la cuenta destino.');
        }
        newTx.push({
          id: existing && !group ? existing.id : uid(), type: 'transferencia', date: d.date, period: ymOf(d.date),
          accountId: acc.id, toAccountId: to.id, amount: round2(amt), currency: cur,
          toAmount: round2(toAmt), toCurrency: toCur, description: d.description, createdAt: keepCreated, updatedAt: now,
        });
      } else {
        if (!d.categoryId) return err('Elegí una categoría.');
        if (d.type === 'egreso') {
          const c = expCat(d.categoryId);
          const hasSubs = c && c.subs.some((x) => x.active || x.id === d.subcategoryId);
          if (hasSubs && !d.subcategoryId) return err('Elegí una subcategoría.');
        }
        let rate = 1;
        if (cur !== BASE) {
          rate = parseAmount(el('f-rate').value);
          if (!(rate > 0)) return err('Ingresá la cotización en pesos.');
        }
        let n = 1;
        if (d.type === 'egreso' && acc.type === 'credito') {
          n = parseInt(el('f-inst').value, 10);
          if (!(n >= 1 && n <= 72)) return err('La cantidad de cuotas tiene que estar entre 1 y 72.');
        }
        if (!d.period) return err('Elegí el mes de imputación.');
        const tg = vehTarget();
        let vehicleData = null;
        if (tg) {
          const rawVehKm = el('v-km').value.trim();
          const kmVal = rawVehKm ? parseKm(rawVehKm) : null;
          if (rawVehKm && !(kmVal > 0)) return err('El kilometraje no es válido.');
          vehicleData = { vehicleId: tg.vehicleId, kind: tg.kind, km: kmVal };
          if (tg.kind === 'combustible') {
            const rawLt = el('v-lt').value.trim();
            const lt = rawLt ? parseAmount(rawLt) : null;
            if (rawLt && !(lt > 0)) return err('Los litros no son válidos. Usá coma para los decimales.');
            vehicleData.liters = lt ? round2(lt) : null;
            vehicleData.fullTank = el('v-full').checked;
          } else {
            vehicleData.works = [];
            for (const wEl of $$('.work', body)) {
              if (!$('.w-on', wEl).checked) continue;
              const rawKm = $('.w-km', wEl).value.trim();
              const nextKm = rawKm ? parseKm(rawKm) : null;
              if (rawKm && !(nextKm > 0)) return err('El kilometraje del próximo trabajo no es válido.');
              if (rawKm && kmVal && !(nextKm > kmVal)) return err('El kilometraje del próximo trabajo tiene que ser mayor al actual.');
              vehicleData.works.push({ typeId: wEl.dataset.type, nextKm: nextKm || null, nextDate: $('.w-date', wEl).value || null });
            }
          }
        }
        const common = {
          type: d.type, date: d.date, accountId: acc.id, currency: cur, rate,
          categoryId: d.categoryId, subcategoryId: d.type === 'egreso' ? (d.subcategoryId || '') : '',
          description: d.description, createdAt: keepCreated, updatedAt: now,
          ...(vehicleData ? { vehicle: vehicleData } : {}),
        };
        if (n === 1) {
          newTx.push({ ...common, id: existing ? existing.id : uid(), amount: sign * round2(amt), period: d.period });
        } else {
          const gid = group ? existing.groupId : uid();
          const each = round2(amt / n);
          for (let i = 1; i <= n; i++) {
            const a = i < n ? each : round2(amt - each * (n - 1));
            newTx.push({
              ...common, id: uid(), groupId: gid, installmentNo: i, installmentsTotal: n,
              totalAmount: sign * round2(amt), amount: sign * a, period: addMonths(d.period, i - 1),
            });
          }
        }
      }

      if (existing) {
        s.transactions = s.transactions.filter((t) => (group ? t.groupId !== existing.groupId : t.id !== existing.id));
      }
      s.transactions.push(...newTx);
      S.lastAccount[d.type] = acc.id;
      const extraMsg = !existing && preset.onSaved ? preset.onSaved(newTx) : null;
      closeModal();
      const p = newTx[0].period;
      commit(extraMsg || (p !== S.month && !S.filters.all ? `Guardado en ${ymLabel(p)}` : 'Movimiento guardado'));
    });

    refreshAll();
    if (!existing) setTimeout(() => el('f-amount')?.focus(), 50);
  }

  // ============================================================
  //  Vista: Cuentas
  // ============================================================
  function renderAccounts() {
    const s = st();
    const bal = balances();
    const nw = netWorth(bal);
    const thisMonth = ymOf(todayISO());
    const order = Object.keys(ACCOUNT_TYPES);
    const accs = [...s.accounts].sort((a, b) => (b.active - a.active) || order.indexOf(a.type) - order.indexOf(b.type) || a.name.localeCompare(b.name));
    const rows = accs.map((a) => {
      const linked = linkedTarget(a);
      let sub = ACCOUNT_TYPES[a.type] || a.type;
      if (a.type === 'credito') {
        const parts = [];
        if (a.closingDay) parts.push(`cierra el ${a.closingDay}`);
        if (a.dueDay) parts.push(`vence el ${a.dueDay}`);
        if (parts.length) sub += `, ${parts.join(' y ')}`;
      }
      if (linked) sub += `, opera sobre ${linked.name}`;
      if (a.inProjection && !linked) sub += ', en saldo de proyección';
      let amt;
      if (linked) amt = '<div class="sub">usa el saldo de la cuenta vinculada</div>';
      else {
        const v = bal[a.id] || 0;
        const r = latestRate(a.currency);
        amt = `<div class="num ${v < 0 ? 'neg' : ''}">${money(v, a.currency)}</div>`;
        if (a.currency !== BASE) amt += `<div class="sub num">${r === null ? 'sin cotización' : '≈ ' + money(v * r)}</div>`;
        if (a.type === 'credito') {
          const fut = s.transactions.filter((t) => t.accountId === a.id && t.type === 'egreso' && t.period > thisMonth).reduce((x, t) => x + t.amount, 0);
          if (fut > 0) amt += `<div class="sub num">cuotas futuras ${money(round2(fut), a.currency)}</div>`;
        }
      }
      return `<li class="clickable" data-action="edit-account" data-id="${esc(a.id)}">
        <div class="grow"><div class="title">${esc(a.name)}${a.currency !== BASE && !linked ? `<span class="badge">${esc(a.currency)}</span>` : ''}${a.active ? '' : '<span class="badge off">inactiva</span>'}</div>
        <div class="sub">${esc(sub)}</div></div>
        <div class="amt">${amt}</div></li>`;
    }).join('');
    return `<div class="view-head"><h1>Cuentas</h1><button class="btn primary" data-action="new-account">Nueva cuenta</button></div>
      <section class="panel">
        <ul class="list">${rows}</ul>
        <div class="total-row"><span>Patrimonio en pesos</span><span class="num ${nw.total < 0 ? 'neg' : ''}">${money(nw.total)}</span></div>
        ${nw.missing.length ? `<p class="hint" style="margin-top:.5rem">Falta la cotización de ${esc(nw.missing.join(', '))}. <button class="btn ghost small" data-view="currencies">Cargar cotización</button></p>` : ''}
      </section>
      <p class="muted small">En las tarjetas de crédito el saldo negativo es lo que debés, incluidas las cuotas futuras. El pago del resumen se registra como transferencia desde la cuenta bancaria hacia la tarjeta.</p>`;
  }

  function openAccountForm(acc) {
    const s = st();
    const used = !!acc && s.transactions.some((t) => t.accountId === acc.id || t.toAccountId === acc.id);
    const isLinkTarget = !!acc && s.accounts.some((a) => a.linkedAccountId === acc.id);
    const d = acc ? { ...acc } : { name: '', type: 'banco', currency: BASE, initialBalance: 0, active: true, closingDay: '', dueDay: '', linkedAccountId: '' };
    const linkables = s.accounts.filter((a) => (a.type === 'banco' || a.type === 'billetera') && (!acc || a.id !== acc.id));
    const body = openModal(acc ? 'Editar cuenta' : 'Nueva cuenta', `
      <form id="acf" novalidate>
        <label class="field"><span>Nombre</span><input id="a-name" maxlength="60" value="${esc(d.name)}" placeholder="Ej.: Galicia caja de ahorro, Visa Santander" autocomplete="off"></label>
        <label class="field"><span>Tipo</span><select id="a-type">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div id="w-link">
          <label class="field"><span>Cuenta sobre la que opera</span><select id="a-link">
            <option value="">Ninguna (saldo propio)</option>
            ${linkables.map((a) => `<option value="${esc(a.id)}" ${a.id === d.linkedAccountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select></label>
          <p class="hint">Si la vinculás, los gastos con esta tarjeta descuentan del saldo de esa cuenta.</p>
        </div>
        <div id="w-own">
          <div class="row">
            <label class="field"><span>Moneda</span><select id="a-cur" ${used ? 'disabled' : ''}>${s.currencies.map((c) => `<option value="${esc(c.code)}" ${c.code === d.currency ? 'selected' : ''}>${esc(c.code)}, ${esc(c.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Saldo inicial</span><input id="a-init" inputmode="decimal" autocomplete="off" value="${esc(numForInput(d.initialBalance))}"></label>
          </div>
          ${used ? '<p class="hint">La moneda no se puede cambiar porque la cuenta ya tiene movimientos.</p>' : ''}
          <p class="hint" id="a-init-hint">Saldo al momento de empezar a registrar movimientos.</p>
          ${acc && !linkedTarget(acc) ? `<label class="field"><span>Saldo real hoy (opcional)</span><input id="a-real" inputmode="decimal" autocomplete="off" placeholder="Saldo actual según la app: ${esc(numForInput(balances()[acc.id] || 0))}"></label>
          <p class="hint">Si lo completás, se corrige el saldo inicial para que el saldo actual coincida con el real. Útil después de importar historial.</p>` : ''}
        </div>
        <div class="row" id="w-card">
          <label class="field"><span>Día de cierre</span><input id="a-close" type="number" min="1" max="31" inputmode="numeric" value="${esc(d.closingDay || '')}"></label>
          <label class="field"><span>Día de vencimiento</span><input id="a-due" type="number" min="1" max="31" inputmode="numeric" value="${esc(d.dueDay || '')}"></label>
        </div>
        <label class="check"><input type="checkbox" id="a-active" ${d.active ? 'checked' : ''}>Cuenta activa</label>
        <label class="check" id="w-proj"><input type="checkbox" id="a-proj" ${d.inProjection ? 'checked' : ''}>Se incluye en saldo inicial de proyección</label>
        <p class="error" id="a-err"></p>
        <div class="actions">
          ${acc ? '<button type="button" class="btn danger" id="a-del">Eliminar</button><span class="spacer"></span>' : ''}
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="submit" class="btn primary">Guardar</button>
        </div>
      </form>`);
    const el = (id) => $('#' + id, body);
    function sync() {
      const type = el('a-type').value;
      const linked = type === 'debito' && el('a-link').value;
      el('w-link').hidden = type !== 'debito';
      el('w-own').hidden = !!linked;
      el('w-proj').hidden = !!linked;
      el('w-card').hidden = type !== 'credito';
      el('a-init-hint').textContent = type === 'credito'
        ? 'Si ya debés algo en la tarjeta, ingresalo en negativo (por ejemplo -150000).'
        : 'Saldo al momento de empezar a registrar movimientos.';
    }
    el('a-type').addEventListener('change', sync);
    el('a-link').addEventListener('change', sync);
    sync();

    if (acc) {
      el('a-del').addEventListener('click', () => {
        if (used || isLinkTarget) {
          el('a-err').textContent = used ? 'Tiene movimientos registrados: desmarcá "Cuenta activa" para ocultarla.' : 'Hay tarjetas de débito vinculadas a esta cuenta.';
          return;
        }
        if (!confirm(`¿Eliminar la cuenta "${acc.name}"?`)) return;
        s.accounts = s.accounts.filter((a) => a.id !== acc.id);
        closeModal();
        commit('Cuenta eliminada');
      });
    }
    el('acf').addEventListener('submit', (e) => {
      e.preventDefault();
      const err = (m) => { el('a-err').textContent = m; };
      const name = el('a-name').value.trim();
      if (!name) return err('Ingresá un nombre.');
      const type = el('a-type').value;
      const link = type === 'debito' ? el('a-link').value : '';
      const init = link ? 0 : (el('a-init').value.trim() === '' ? 0 : parseAmount(el('a-init').value));
      if (Number.isNaN(init)) return err('El saldo inicial no es un número válido.');
      let closingDay = '', dueDay = '';
      if (type === 'credito') {
        closingDay = el('a-close').value ? parseInt(el('a-close').value, 10) : '';
        dueDay = el('a-due').value ? parseInt(el('a-due').value, 10) : '';
        if ((closingDay && (closingDay < 1 || closingDay > 31)) || (dueDay && (dueDay < 1 || dueDay > 31))) return err('Los días tienen que estar entre 1 y 31.');
      }
      let initFinal = init;
      const realEl = el('a-real');
      if (acc && realEl && realEl.value.trim()) {
        const real = parseAmount(realEl.value);
        if (Number.isNaN(real)) return err('El saldo real no es un número válido. Usá coma para los decimales.');
        const nowBal = balances()[acc.id] || 0;
        initFinal = (Number(acc.initialBalance) || 0) + (real - nowBal);
      }
      const data = {
        name, type, currency: link ? (account(link)?.currency || BASE) : el('a-cur').value,
        initialBalance: round2(initFinal), active: el('a-active').checked, closingDay, dueDay, linkedAccountId: link,
        inProjection: !link && el('a-proj').checked,
      };
      if (acc) Object.assign(acc, data);
      else s.accounts.push({ id: uid(), ...data });
      closeModal();
      commit(acc ? 'Cuenta actualizada' : 'Cuenta creada');
    });
    if (!acc) setTimeout(() => el('a-name')?.focus(), 50);
  }

  // ============================================================
  //  Formulario simple reutilizable
  // ============================================================
  function simpleForm({ title, fields, onSave, onDelete, deleteBlocked }) {
    const body = openModal(title, `
      <form id="sf" novalidate>
        ${fields.map((f) => {
          if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}>${esc(f.label)}</label>`;
          if (f.type === 'select') return `<label class="field"><span>${esc(f.label)}</span><select name="${f.name}" ${f.disabled ? 'disabled' : ''}>${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}`;
          return `<label class="field"><span>${esc(f.label)}</span><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.readonly ? 'readonly' : ''} autocomplete="off"></label>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}`;
        }).join('')}
        <p class="error" id="sf-err"></p>
        <div class="actions">
          ${onDelete ? '<button type="button" class="btn danger" id="sf-del">Eliminar</button><span class="spacer"></span>' : ''}
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="submit" class="btn primary">Guardar</button>
        </div>
      </form>`);
    const form = $('#sf', body);
    const errEl = $('#sf-err', body);
    if (onDelete) {
      $('#sf-del', body).addEventListener('click', () => {
        if (deleteBlocked) { errEl.textContent = deleteBlocked; return; }
        if (onDelete() !== false) { closeModal(); }
      });
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      fields.forEach((f) => {
        const input = form.elements[f.name];
        values[f.name] = f.type === 'checkbox' ? input.checked : input.value.trim();
      });
      const msg = onSave(values);
      if (msg) { errEl.textContent = msg; return; }
      closeModal();
    });
    const firstInput = form.querySelector('input:not([type=checkbox]):not([readonly])');
    if (firstInput) setTimeout(() => { if (firstInput.isConnected) firstInput.focus(); }, 50);
  }

  // ============================================================
  //  Vista: Categorías
  // ============================================================
  function moveItem(list, idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return false;
    [list[idx], list[j]] = [list[j], list[idx]];
    return true;
  }
  function renderCategorySort() {
    const s = st();
    const arrows = (kind, id, i, n, cat = '') => `<span class="sort-btns">
      <button class="icon-btn" data-action="cat-move" data-kind="${kind}" data-id="${esc(id)}" data-cat="${esc(cat)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
      <button class="icon-btn" data-action="cat-move" data-kind="${kind}" data-id="${esc(id)}" data-cat="${esc(cat)}" data-dir="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button></span>`;
    const exp = s.expenseCategories.map((c, i) => `<li class="sort-cat"><div class="sort-row"><strong class="grow">${esc(c.name)}${c.active ? '' : '<span class="badge off">inactiva</span>'}</strong>${arrows('e', c.id, i, s.expenseCategories.length)}</div>
      ${c.subs.length > 1 ? `<ul class="sort-subs">${c.subs.map((x, j) => `<li class="sort-row"><span class="grow">${esc(x.name)}</span>${arrows('s', x.id, j, c.subs.length, c.id)}</li>`).join('')}</ul>` : ''}</li>`).join('');
    const inc = s.incomeCategories.map((c, i) => `<li class="sort-row"><strong class="grow">${esc(c.name)}${c.active ? '' : '<span class="badge off">inactiva</span>'}</strong>${arrows('i', c.id, i, s.incomeCategories.length)}</li>`).join('');
    return `<div class="view-head"><h1>Ordenar categorías</h1><button class="btn primary" data-action="cat-sort-done">Listo</button></div>
      <p class="muted small">Este orden se usa en Presupuesto y en todos los análisis. Con las flechas subís o bajás cada categoría y cada subcategoría.</p>
      <div class="grid2">
        <section class="panel"><div class="panel-head"><h2>Egresos</h2></div><ul class="sort-list">${exp}</ul></section>
        <section class="panel"><div class="panel-head"><h2>Ingresos</h2></div><ul class="sort-list">${inc}</ul></section>
      </div>`;
  }

  function renderCategories() {
    const s = st();
    if (S.catSort) return renderCategorySort();
    const incChips = s.incomeCategories.map((c) => `<button class="chip ${c.active ? '' : 'off'}" data-action="edit-inc-cat" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('');
    const expBlocks = s.expenseCategories.map((c) => `
      <div class="cat-block">
        <div class="cat-line"><span class="grow ${c.active ? '' : 'muted'}">${esc(c.name)}${c.active ? '' : '<span class="badge off">inactiva</span>'}</span>
          <button class="btn ghost small" data-action="edit-exp-cat" data-id="${esc(c.id)}">Editar</button></div>
        <div class="chips">
          ${c.subs.map((x) => `<button class="chip ${x.active ? '' : 'off'}" data-action="edit-sub" data-cat="${esc(c.id)}" data-id="${esc(x.id)}">${esc(x.name)}${x.kind && vehicle(x.vehicleId) ? `<span class="chip-tag">${x.kind === 'combustible' ? 'combustible' : 'mantenimiento'}</span>` : ''}</button>`).join('')}
          <button class="chip add" data-action="new-sub" data-cat="${esc(c.id)}">+ Subcategoría</button>
        </div>
      </div>`).join('');
    return `<div class="view-head"><h1>Categorías</h1><button class="btn" data-action="cat-sort">Ordenar</button></div>
      <div class="grid2">
        <section class="panel">
          <div class="panel-head"><h2>Egresos</h2><button class="btn small" data-action="new-exp-cat">Nueva categoría</button></div>
          ${expBlocks || '<p class="muted">No hay categorías de egreso.</p>'}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Ingresos</h2><button class="btn small" data-action="new-inc-cat">Nueva categoría</button></div>
          <div class="chips">${incChips}</div>
          <p class="muted small" style="margin-top:1rem">Tocá una categoría para renombrarla o desactivarla. Las categorías con movimientos no se pueden eliminar, pero sí desactivar para que no aparezcan al cargar.</p>
        </section>
      </div>`;
  }

  function nameForm(title, item, inUse, onSaveName, onDelete) {
    simpleForm({
      title,
      fields: [
        { name: 'name', label: 'Nombre', value: item ? item.name : '', maxlength: 60 },
        ...(item ? [{ name: 'active', label: 'Activa', type: 'checkbox', value: item.active }] : []),
      ],
      onSave: (v) => {
        if (!v.name) return 'Ingresá un nombre.';
        onSaveName(v.name, item ? v.active : true);
        commit('Guardado');
        return null;
      },
      onDelete: item ? () => { if (!confirm(`¿Eliminar "${item.name}"?`)) return false; onDelete(); commit('Eliminado'); return true; } : null,
      deleteBlocked: inUse ? 'Tiene movimientos registrados. Desmarcá "Activa" para ocultarla.' : null,
    });
  }

  function subForm(c, x) {
    const s = st();
    const used = !!x && s.transactions.some((t) => t.subcategoryId === x.id);
    const vs = s.vehicles.filter((v) => v.active || (x && v.id === x.vehicleId));
    simpleForm({
      title: x ? `Editar subcategoría de ${c.name}` : `Nueva subcategoría de ${c.name}`,
      fields: [
        { name: 'name', label: 'Nombre', value: x ? x.name : '', maxlength: 60 },
        { name: 'kind', label: 'Datos adicionales al cargar un gasto', type: 'select', value: x && x.kind ? x.kind : '',
          options: [{ value: '', label: 'Ninguno' }, ...Object.entries(VEH_KINDS).map(([value, label]) => ({ value, label }))] },
        { name: 'vehicleId', label: 'Vehículo', type: 'select', value: x && x.vehicleId ? x.vehicleId : '',
          options: [{ value: '', label: vs.length ? 'Elegí un vehículo' : 'Primero creá un vehículo en Vehículos' }, ...vs.map((v) => ({ value: v.id, label: v.name }))],
          hint: 'Si cambiás de auto, creá el vehículo nuevo y elegilo acá. Los registros anteriores quedan con el auto anterior.' },
        ...(x ? [{ name: 'active', label: 'Activa', type: 'checkbox', value: x.active }] : []),
      ],
      onSave: (v) => {
        if (!v.name) return 'Ingresá un nombre.';
        if (v.kind && !v.vehicleId) return 'Elegí el vehículo.';
        const data = { name: v.name, kind: v.kind || '', vehicleId: v.kind ? v.vehicleId : '', active: x ? v.active : true };
        if (x) Object.assign(x, data); else c.subs.push({ id: uid(), ...data });
        commit('Guardado');
        return null;
      },
      onDelete: x ? () => { if (!confirm(`¿Eliminar "${x.name}"?`)) return false; c.subs = c.subs.filter((y) => y.id !== x.id); commit('Eliminado'); return true; } : null,
      deleteBlocked: used ? 'Tiene movimientos registrados. Desmarcá "Activa" para ocultarla.' : null,
    });
  }

  function renderVehicles() {
    const s = st();
    const year = todayISO().slice(0, 4);
    const vs = [...s.vehicles].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
    const panels = vs.map((v) => {
      const fs = fuelStats(v.id);
      const rem = reminders(v.id);
      const cur = currentKm(v.id);
      const maint = vehRecords(v.id, 'mantenimiento').sort((a, b) => b.t.date.localeCompare(a.t.date) || (b.v.km || 0) - (a.v.km || 0));
      const fuelYear = vehRecords(v.id, 'combustible').filter((r) => r.t.date.startsWith(year)).reduce((a, r) => a + r.cost, 0);
      const maintYear = maint.filter((r) => r.t.date.startsWith(year)).reduce((a, r) => a + r.cost, 0);
      const subs = s.expenseCategories.flatMap((c) => c.subs.filter((x) => x.kind && x.vehicleId === v.id).map((x) => `${c.name} › ${x.name}`));
      const fuelRows = fs.rows.slice(0, 12).map((r) => `<tr class="clickable" data-action="edit-tx" data-id="${esc(r.t.id)}">
          <td>${esc(dateShort(r.t.date))}</td><td class="r num">${r.v.km ? esc(kmFmt.format(r.v.km)) : '—'}</td>
          <td class="r num">${r.v.liters ? esc(l100Fmt.format(r.v.liters)) : '—'}${r.v.liters && !r.v.fullTank ? ' <span class="badge">parcial</span>' : ''}</td>
          <td class="r num">${r.v.liters ? money(r.cost / r.v.liters) : '—'}</td><td class="r num">${r.l100 !== null ? esc(l100Fmt.format(r.l100)) : '—'}</td>
          <td class="r num">${money(r.cost)}</td></tr>`).join('');
      const maintRows = maint.slice(0, 12).map((r) => {
        const works = (r.v.works || []).map((w) => mtype(w.typeId)?.name).filter(Boolean).join(', ');
        return `<li class="clickable" data-action="edit-tx" data-id="${esc(r.t.id)}"><div class="grow">
          <div class="title">${esc(works || r.t.description || 'Reparación')}</div>
          <div class="sub">${esc([dateShort(r.t.date), r.v.km ? km(r.v.km) : null, works ? r.t.description : null].filter(Boolean).join(', '))}</div></div>
          <div class="amt num">${money(r.cost)}</div></li>`;
      }).join('');
      const remRows = rem.map((x) => `<li class="clickable" data-action="edit-tx" data-id="${esc(x.txId)}"><div class="grow">
          <div class="title">${esc(x.name)}</div>
          <div class="sub">Próximo ${esc(reminderText(x))}. Último: ${esc(dateShort(x.lastDate))}${x.lastKm ? ', ' + esc(km(x.lastKm)) : ''}</div></div>${statusBadge(x.status)}</li>`).join('');
      return `<section class="panel">
        <div class="panel-head"><h2>${esc(v.name)}${v.active ? '' : '<span class="badge off">inactivo</span>'}</h2>
          <div class="head-actions"><button class="btn small" data-action="update-km" data-id="${esc(v.id)}">Actualizar km</button>
          <button class="btn ghost small" data-action="edit-vehicle" data-id="${esc(v.id)}">Editar</button></div></div>
        <div class="kpis">
          <div><span>Kilometraje</span><strong class="num">${cur ? km(cur) : '—'}</strong></div>
          <div><span>Consumo promedio</span><strong class="num">${fs.avg !== null ? l100(fs.avg) : '—'}</strong></div>
          <div><span>Última medición</span><strong class="num">${fs.last !== null ? l100(fs.last) : '—'}</strong></div>
          <div><span>Combustible por km</span><strong class="num">${fs.costKm !== null ? money(fs.costKm) : '—'}</strong></div>
        </div>
        <p class="muted small">${subs.length ? `Se registra desde ${esc(subs.join(', '))}.` : 'Todavía no hay subcategorías vinculadas: elegí este vehículo al editar una subcategoría en Categorías.'}
          En ${year} gastaste ${money(round2(fuelYear))} en combustible y ${money(round2(maintYear))} en mantenimiento.</p>
        <h3>Próximos mantenimientos</h3>
        ${remRows ? `<ul class="list">${remRows}</ul>` : '<p class="muted">Sin recordatorios. Se crean al registrar una reparación con fecha o kilometraje del próximo trabajo.</p>'}
        <h3>Cargas de combustible</h3>
        ${fuelRows ? `<div class="scroll-x"><table class="simple"><thead><tr><th>Fecha</th><th class="r">Km</th><th class="r">Litros</th><th class="r">$ / litro</th><th class="r">L/100 km</th><th class="r">Total</th></tr></thead><tbody>${fuelRows}</tbody></table></div>`
          : '<p class="muted">Sin cargas registradas.</p>'}
        <h3>Mantenimientos y reparaciones</h3>
        ${maintRows ? `<ul class="list">${maintRows}</ul>` : '<p class="muted">Sin reparaciones registradas.</p>'}
      </section>`;
    }).join('');
    const types = s.maintenanceTypes.map((m) => `<button class="chip ${m.active ? '' : 'off'}" data-action="edit-mtype" data-id="${esc(m.id)}">${esc(m.name)}<span class="chip-tag">${esc(intervalText(m))}</span></button>`).join('');
    return `<div class="view-head"><h1>Vehículos</h1><button class="btn primary" data-action="new-vehicle">Nuevo vehículo</button></div>
      ${panels || `<section class="panel empty"><h2>Todavía no hay vehículos</h2><p>Creá tu vehículo y después, en Categorías, vinculalo a las subcategorías de combustible y reparaciones.</p><button class="btn primary" data-action="new-vehicle">Nuevo vehículo</button></section>`}
      <section class="panel">
        <div class="panel-head"><h2>Tipos de trabajo</h2><button class="btn small" data-action="new-mtype">Nuevo tipo</button></div>
        <div class="chips">${types}</div>
        <p class="hint" style="margin:1rem 0 0">Los intervalos se usan para sugerir el próximo trabajo. Son valores generales: ajustalos según el manual de tus autos.</p>
      </section>`;
  }

  function vehicleForm(v) {
    const s = st();
    const used = !!v && (s.transactions.some((t) => t.vehicle && t.vehicle.vehicleId === v.id) || s.expenseCategories.some((c) => c.subs.some((x) => x.vehicleId === v.id)));
    simpleForm({
      title: v ? 'Editar vehículo' : 'Nuevo vehículo',
      fields: [
        { name: 'name', label: 'Nombre', value: v ? v.name : '', placeholder: 'Ej.: VW Taos', maxlength: 40 },
        ...(v ? [{ name: 'active', label: 'Activo', type: 'checkbox', value: v.active }] : []),
      ],
      onSave: (x) => {
        if (!x.name) return 'Ingresá un nombre.';
        if (v) Object.assign(v, { name: x.name, active: x.active });
        else s.vehicles.push({ id: uid(), name: x.name, active: true, kmReadings: [] });
        commit(v ? 'Vehículo actualizado' : 'Vehículo creado. Vinculalo a sus subcategorías en Categorías.');
        return null;
      },
      onDelete: v ? () => { if (!confirm(`¿Eliminar ${v.name}?`)) return false; s.vehicles = s.vehicles.filter((x) => x.id !== v.id); commit('Vehículo eliminado'); return true; } : null,
      deleteBlocked: used ? 'Tiene registros o subcategorías vinculadas. Desmarcá "Activo" para ocultarlo.' : null,
    });
  }

  function kmForm(v) {
    simpleForm({
      title: `Kilometraje de ${v.name}`,
      fields: [
        { name: 'date', label: 'Fecha', type: 'date', value: todayISO() },
        { name: 'km', label: 'Kilometraje actual', value: '', inputmode: 'numeric', placeholder: currentKm(v.id) ? kmFmt.format(currentKm(v.id)) : 'Ej.: 45.230', hint: 'Sirve para que los recordatorios por kilometraje estén al día entre una carga y otra.' },
      ],
      onSave: (x) => {
        const n = parseKm(x.km);
        if (!(n > 0)) return 'Ingresá el kilometraje.';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return 'Ingresá una fecha válida.';
        v.kmReadings.push({ id: uid(), date: x.date, km: n });
        commit('Kilometraje actualizado');
        return null;
      },
    });
  }

  function mtypeForm(m) {
    const s = st();
    const used = !!m && s.transactions.some((t) => t.vehicle && (t.vehicle.works || []).some((w) => w.typeId === m.id));
    simpleForm({
      title: m ? 'Editar tipo de trabajo' : 'Nuevo tipo de trabajo',
      fields: [
        { name: 'name', label: 'Nombre', value: m ? m.name : '', placeholder: 'Ej.: Cambio de amortiguadores', maxlength: 50 },
        { name: 'intervalKm', label: 'Repetir cada (km)', value: m && m.intervalKm ? kmFmt.format(m.intervalKm) : '', inputmode: 'numeric', placeholder: 'Opcional' },
        { name: 'intervalMonths', label: 'O cada (meses)', value: m && m.intervalMonths ? String(m.intervalMonths) : '', inputmode: 'numeric', placeholder: 'Opcional' },
        ...(m ? [{ name: 'active', label: 'Activo', type: 'checkbox', value: m.active }] : []),
      ],
      onSave: (x) => {
        if (!x.name) return 'Ingresá un nombre.';
        const ik = x.intervalKm ? parseKm(x.intervalKm) : null;
        const im = x.intervalMonths ? parseInt(x.intervalMonths, 10) : null;
        if (x.intervalKm && !(ik > 0)) return 'El intervalo en km no es válido.';
        if (x.intervalMonths && !(im > 0 && im <= 240)) return 'El intervalo en meses no es válido.';
        const data = { name: x.name, intervalKm: ik, intervalMonths: im, active: m ? x.active : true };
        if (m) Object.assign(m, data); else s.maintenanceTypes.push({ id: uid(), ...data });
        commit('Guardado');
        return null;
      },
      onDelete: m ? () => { if (!confirm(`¿Eliminar "${m.name}"?`)) return false; s.maintenanceTypes = s.maintenanceTypes.filter((x) => x.id !== m.id); commit('Eliminado'); return true; } : null,
      deleteBlocked: used ? 'Ya se usó en reparaciones. Desmarcá "Activo" para ocultarlo.' : null,
    });
  }

  // ============================================================
  //  Vista: Monedas y cotizaciones
  // ============================================================
  function renderCurrencies() {
    const s = st();
    const curRows = s.currencies.map((c) => `<li class="clickable" data-action="edit-currency" data-code="${esc(c.code)}">
        <div class="grow"><div class="title">${esc(c.code)}<span class="badge">${esc(c.symbol)}</span>${c.code === BASE ? '<span class="badge gold">moneda base</span>' : ''}</div><div class="sub">${esc(c.name)}</div></div>
        ${c.code !== BASE ? `<div class="amt"><div class="num">${latestRate(c.code) === null ? '<span class="muted">sin cotización</span>' : money(latestRate(c.code))}</div><div class="sub">última cotización</div></div>` : ''}
      </li>`).join('');
    const foreign = s.currencies.filter((c) => c.code !== BASE);
    const ratePanels = foreign.map((c) => {
      const list = s.rates.filter((r) => r.currency === c.code).sort((a, b) => b.date.localeCompare(a.date));
      const shown = list.slice(0, 24);
      return `<section class="panel">
        <div class="panel-head"><h2>Cotizaciones de ${esc(c.code)}</h2><button class="btn small" data-action="new-rate" data-code="${esc(c.code)}">Agregar cotización</button></div>
        ${shown.length ? `<div class="scroll-x"><table class="simple"><thead><tr><th>Fecha</th><th class="r">Pesos por ${esc(c.symbol)}</th><th>Referencia</th></tr></thead><tbody>
          ${shown.map((r) => `<tr class="clickable" data-action="edit-rate" data-id="${esc(r.id)}"><td>${esc(dateShort(r.date))}</td><td class="r num">${esc(rateFmt.format(r.rate))}</td><td class="muted">${esc(r.note || '')}</td></tr>`).join('')}
        </tbody></table></div>${list.length > shown.length ? `<p class="muted small">Se muestran las últimas ${shown.length} de ${list.length}.</p>` : ''}`
          : '<p class="muted">Todavía no cargaste cotizaciones. Se usan para calcular el equivalente en pesos de cada movimiento y de los saldos.</p>'}
      </section>`;
    }).join('');
    return `<div class="view-head"><h1>Monedas y cotizaciones</h1><button class="btn primary" data-action="new-currency">Nueva moneda</button></div>
      <div class="grid2">
        <section class="panel"><ul class="list">${curRows}</ul></section>
        <div class="stack">${ratePanels || '<section class="panel"><p class="muted">Agregá una moneda extranjera para cargar cotizaciones.</p></section>'}</div>
      </div>
      <p class="muted small">Cada movimiento en moneda extranjera guarda la cotización que usaste al cargarlo, así los reportes de meses anteriores no cambian cuando actualizás la cotización.</p>`;
  }

  function openCurrencyForm(cur) {
    const s = st();
    const used = !!cur && (s.accounts.some((a) => a.currency === cur.code) || s.transactions.some((t) => t.currency === cur.code || t.toCurrency === cur.code));
    simpleForm({
      title: cur ? 'Editar moneda' : 'Nueva moneda',
      fields: [
        { name: 'code', label: 'Código', value: cur ? cur.code : '', placeholder: 'Ej.: EUR, BRL', maxlength: 3, readonly: !!cur, hint: cur ? '' : 'Código de 3 letras (ISO 4217).' },
        { name: 'name', label: 'Nombre', value: cur ? cur.name : '', placeholder: 'Ej.: Euro', maxlength: 40 },
        { name: 'symbol', label: 'Símbolo', value: cur ? cur.symbol : '', placeholder: 'Ej.: €', maxlength: 5 },
      ],
      onSave: (v) => {
        const code = v.code.toUpperCase();
        if (!/^[A-Z]{3}$/.test(code)) return 'El código tiene que tener 3 letras.';
        if (!cur && s.currencies.some((c) => c.code === code)) return 'Esa moneda ya existe.';
        if (!v.name) return 'Ingresá un nombre.';
        const data = { code, name: v.name, symbol: v.symbol || code };
        if (cur) Object.assign(cur, data); else s.currencies.push(data);
        commit(cur ? 'Moneda actualizada' : 'Moneda agregada');
        return null;
      },
      onDelete: cur && cur.code !== BASE ? () => {
        if (!confirm(`¿Eliminar ${cur.code} y todas sus cotizaciones?`)) return false;
        s.currencies = s.currencies.filter((c) => c.code !== cur.code);
        s.rates = s.rates.filter((r) => r.currency !== cur.code);
        commit('Moneda eliminada');
        return true;
      } : null,
      deleteBlocked: used ? 'Hay cuentas o movimientos en esta moneda.' : null,
    });
  }

  function openRateForm(rate, code) {
    const s = st();
    const c = currency(rate ? rate.currency : code);
    simpleForm({
      title: rate ? `Editar cotización de ${c.code}` : `Nueva cotización de ${c.code}`,
      fields: [
        { name: 'date', label: 'Fecha', type: 'date', value: rate ? rate.date : todayISO() },
        { name: 'rate', label: `Pesos por 1 ${c.symbol}`, value: rate ? numForInput(rate.rate) : '', inputmode: 'decimal', placeholder: 'Ej.: 1450,50' },
        { name: 'note', label: 'Referencia', value: rate ? rate.note || '' : '', placeholder: 'Opcional: oficial, MEP, tarjeta…', maxlength: 30 },
      ],
      onSave: (v) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return 'Ingresá una fecha válida.';
        const r = parseAmount(v.rate);
        if (!(r > 0)) return 'Ingresá una cotización mayor a cero.';
        const dup = s.rates.find((x) => x.currency === c.code && x.date === v.date && (!rate || x.id !== rate.id));
        if (dup) return 'Ya hay una cotización para esa fecha. Editala en lugar de crear otra.';
        const data = { currency: c.code, date: v.date, rate: r, note: v.note };
        if (rate) Object.assign(rate, data); else s.rates.push({ id: uid(), ...data });
        commit('Cotización guardada');
        return null;
      },
      onDelete: rate ? () => {
        if (!confirm('¿Eliminar esta cotización?')) return false;
        s.rates = s.rates.filter((x) => x.id !== rate.id);
        commit('Cotización eliminada');
        return true;
      } : null,
    });
  }

  // ============================================================
  //  Presupuesto
  // ============================================================
  // Partidas: "e|categoría|subcategoría" (subcategoría vacía si la categoría no tiene) e "i|categoría".
  // versions: presupuesto vigente desde un mes en adelante. overrides: presupuesto propio de un mes puntual.
  const monthsBetween = (a, b) => { const out = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; };
  const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  // Orden definido por el usuario en Categorías (el orden de las listas)
  function orderOf(kind) {
    const list = kind === 'i' ? st().incomeCategories : st().expenseCategories;
    const m = new Map(list.map((c, i) => [c.id, i]));
    return (a, b) => (m.has(a) ? m.get(a) : 1e9) - (m.has(b) ? m.get(b) : 1e9);
  }
  const byOrderObj = (kind) => { const f = orderOf(kind); return (a, b) => f(a.id, b.id); };
  function subOrderOf(catId) {
    const c = expCat(catId);
    const m = new Map((c ? c.subs : []).map((x, i) => [x.id, i]));
    const pos = (id) => (id === '' ? 1e9 - 1 : m.has(id) ? m.get(id) : 1e9);
    return (a, b) => pos(a) - pos(b);
  }
  function budgetVersion(ym) {
    return st().budget.versions.filter((v) => v.from <= ym).sort((a, b) => b.from.localeCompare(a.from))[0] || null;
  }
  // Detalle opcional de cada partida: { "e|cat|sub": [{ id, text, amount }] }
  function budgetDetails(ym) {
    const b = st().budget;
    if (b.overrides[ym]) return (b.overrideDetails && b.overrideDetails[ym]) || {};
    const v = budgetVersion(ym);
    return (v && v.details) || {};
  }
  function budItemsHtml(items) {
    if (!items || !items.length) return '';
    return `<ul class="bud-items">${items.map((it) => `<li><span>${esc(it.text || 'Sin detalle')}</span><span class="num">${money(it.amount || 0)}</span></li>`).join('')}</ul>`;
  }
  function budgetValues(ym) {
    const ov = st().budget.overrides[ym];
    if (ov) return ov;
    const v = budgetVersion(ym);
    return v ? v.values : {};
  }
  function emptyAgg() { return { exp: {}, inc: {}, expT: 0, incT: 0 }; }
  function aggAdd(agg, kind, cat, sub, v) {
    if (!v) return;
    if (kind === 'e') {
      const c = agg.exp[cat] || (agg.exp[cat] = { total: 0, subs: {} });
      c.total += v; c.subs[sub] = (c.subs[sub] || 0) + v; agg.expT += v;
    } else { agg.inc[cat] = (agg.inc[cat] || 0) + v; agg.incT += v; }
  }
  function budgetAgg(from, to = from) {
    const agg = emptyAgg();
    for (const ym of monthsBetween(from, to)) {
      for (const [k, v] of Object.entries(budgetValues(ym))) {
        const [kind, cat, sub = ''] = k.split('|');
        aggAdd(agg, kind, cat, sub, Number(v) || 0);
      }
    }
    return agg;
  }
  function actualAgg(from, to = from) {
    const agg = emptyAgg();
    for (const t of st().transactions) {
      if (t.type === 'transferencia' || t.period < from || t.period > to) continue;
      aggAdd(agg, t.type === 'egreso' ? 'e' : 'i', t.categoryId, t.type === 'egreso' ? (t.subcategoryId || '') : '', txBase(t));
    }
    return agg;
  }
  // Valor de una partida (o de una categoría completa con "E|cat") dentro de un agregado
  function aggValue(agg, key) {
    const [kind, cat, sub = ''] = key.split('|');
    if (kind === 'E') return agg.exp[cat] ? agg.exp[cat].total : 0;
    if (kind === 'e') return agg.exp[cat] ? agg.exp[cat].subs[sub] || 0 : 0;
    return agg.inc[cat] || 0;
  }
  function keyLabel(key) {
    const [kind, cat, sub = ''] = key.split('|');
    if (kind === 'i') return incCat(cat)?.name || 'Sin categoría';
    const c = expCat(cat);
    if (kind === 'E' || !sub) return c?.name || 'Sin categoría';
    return `${c?.name || ''} › ${subOf(c, sub)?.name || 'Sin subcategoría'}`;
  }
  const pctFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const compactFmt = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });

  function monthPace(ym) {
    const today = todayISO();
    if (ymOf(today) !== ym) return null;
    const [y, m] = ym.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    return { day: Number(today.slice(8, 10)), days, pct: (Number(today.slice(8, 10)) / days) * 100 };
  }

  function dashBudgetLine(realExp) {
    const b = budgetAgg(S.month);
    if (!(b.expT > 0)) return '';
    const pct = (realExp / b.expT) * 100;
    return `<p class="result-budget">Llevás el ${pctFmt.format(pct)}% del presupuesto de egresos (${money(round2(b.expT))}).
      <button class="btn ghost small" data-view="budget">Ver presupuesto</button></p>`;
  }

  function budRow(name, b, r, kind, pace, small) {
    const pct = b > 0 ? (r / b) * 100 : (r > 0 ? 100 : 0);
    let cls, text;
    if (kind === 'out') {
      cls = b === 0 ? (r > 0 ? 'over' : 'ok') : pct > 100 ? 'over' : pct >= 90 ? 'warn' : 'ok';
      text = b === 0 ? (r > 0 ? 'Sin presupuesto' : '') : r <= b ? `Quedan ${money(round2(b - r))}` : `Excedido en ${money(round2(r - b))}`;
    } else {
      cls = 'in';
      text = b === 0 ? (r > 0 ? 'Sin presupuesto' : '') : r < b ? `Falta cobrar ${money(round2(b - r))}` : `Superado por ${money(round2(r - b))}`;
    }
    return `<div class="brow ${small ? 'small-row' : ''}">
      <div class="brow-head"><span class="brow-name">${esc(name)}</span><span class="num">${money(round2(r))}<span class="muted"> de ${money(round2(b))}</span></span></div>
      <div class="bar-track"><div class="bar-fill b-${cls}" data-w="${pct}"></div>${pace && !small ? `<i class="pace" data-l="${pace.pct}"></i>` : ''}</div>
      <div class="brow-foot"><span class="t-${cls}">${text}</span><span class="muted">${b > 0 ? pctFmt.format(pct) + '%' : ''}</span></div>
    </div>`;
  }

  function renderBudget() {
    const s = st(), ym = S.month;
    const bud = budgetAgg(ym), act = actualAgg(ym);
    const details = budgetDetails(ym);
    const ver = budgetVersion(ym), ov = s.budget.overrides[ym];
    const pace = monthPace(ym);
    const head = `<div class="view-head"><h1>Presupuesto</h1>
      <div class="head-actions">${monthNav()}<button class="btn primary" data-action="edit-budget">Editar presupuesto</button></div></div>`;
    if (!s.budget.versions.length && !Object.keys(s.budget.overrides).length) {
      return `${head}<section class="panel empty"><h2>Todavía no armaste un presupuesto</h2>
        <p>Definí cuánto esperás cobrar y gastar por mes en cada categoría. Después vas a ver acá cuánto llevás usado y en qué categorías te pasaste.</p>
        <button class="btn primary" data-action="edit-budget">Crear presupuesto</button></section>`;
    }
    const source = ov ? `${ymTitle(ym)} tiene un presupuesto propio.` : ver ? (ver.from ? `Presupuesto vigente desde ${ymLabel(ver.from)}.` : 'Presupuesto general, aplicado también a los meses anteriores.') : 'No hay presupuesto cargado para este mes.';

    // Egresos por categoría (con detalle por subcategoría)
    const expIds = [...new Set([...Object.keys(bud.exp), ...Object.keys(act.exp)])];
    expIds.sort(orderOf('e'));
    const expRows = expIds.map((cid) => {
      const c = expCat(cid);
      const bt = bud.exp[cid]?.total || 0, rt = act.exp[cid]?.total || 0;
      const subIds = [...new Set([...Object.keys(bud.exp[cid]?.subs || {}), ...Object.keys(act.exp[cid]?.subs || {})])];
      const main = budRow(c ? c.name : 'Sin categoría', bt, rt, 'out', pace);
      if (subIds.length <= 1 && (subIds[0] || '') === '') {
        const items = details[`e|${cid}|`];
        return items && items.length ? `<details class="bcat"><summary>${main}</summary><div class="bsubs">${budItemsHtml(items)}</div></details>` : `<div class="bcat">${main}</div>`;
      }
      const so = subOrderOf(cid);
      const subRows = subIds.map((sid) => ({ sid, name: sid ? (subOf(c, sid)?.name || 'Subcategoría eliminada') : 'Sin subcategoría' }))
        .sort((x, y) => so(x.sid, y.sid)).map(({ sid, name }) => budRow(name, bud.exp[cid]?.subs[sid] || 0, act.exp[cid]?.subs[sid] || 0, 'out', null, true) + budItemsHtml(details[`e|${cid}|${sid}`])).join('');
      return `<details class="bcat"><summary>${main}</summary><div class="bsubs">${subRows}</div></details>`;
    }).join('');
    const incIds = [...new Set([...Object.keys(bud.inc), ...Object.keys(act.inc)])].sort(orderOf('i'));
    const incRows = incIds.map((cid) => `<div class="bcat">${budRow(incCat(cid)?.name || 'Sin categoría', bud.inc[cid] || 0, act.inc[cid] || 0, 'in', pace)}</div>`).join('');

    const resB = round2(bud.incT - bud.expT), resR = round2(act.incT - act.expT);
    return `${head}
      <p class="muted small">${esc(source)}${pace ? ` Van ${pace.day} de ${pace.days} días del mes: la marca vertical en cada barra muestra hasta dónde “debería” ir el gasto si fuera parejo.` : ''}</p>
      <section class="panel">
        <div class="bsum">
          <div>${budRow('Egresos', bud.expT, act.expT, 'out', pace)}</div>
          <div>${budRow('Ingresos', bud.incT, act.incT, 'in', pace)}</div>
          <div class="bres"><span class="muted small">Resultado</span>
            <strong class="num ${resR < 0 ? 'neg' : 'pos'}">${money(resR)}</strong>
            <span class="muted small">previsto ${money(resB)}</span></div>
        </div>
      </section>
      <div class="grid2">
        <section class="panel"><div class="panel-head"><h2>Egresos</h2><span class="muted small">tocá una categoría para ver el detalle</span></div>${expRows || '<p class="muted">Sin datos.</p>'}</section>
        <section class="panel"><div class="panel-head"><h2>Ingresos</h2></div>${incRows || '<p class="muted">Sin datos.</p>'}</section>
      </div>`;
  }

  function openBudgetEditor() {
    const s = st(), ym = S.month;
    const ov = s.budget.overrides[ym];
    const ver = budgetVersion(ym);
    const vals = budgetValues(ym);
    const later = s.budget.versions.filter((v) => v.from > ym).sort((a, b) => a.from.localeCompare(b.from));
    const hasVal = (prefix) => Object.keys(vals).some((k) => k.startsWith(prefix) && vals[k]);
    const dets = budgetDetails(ym);
    const itemRow = (it = {}) => `<div class="det-item"><input class="det-text" maxlength="80" placeholder="Detalle (ej.: pintura del living)" value="${esc(it.text || '')}" autocomplete="off"><input class="det-amt" inputmode="decimal" placeholder="0" value="${it.amount ? esc(numForInput(it.amount)) : ''}" autocomplete="off"><button type="button" class="icon-btn det-del" aria-label="Quitar">×</button></div>`;
    const input = (key, label) => {
      const field = `<input data-key="${esc(key)}" inputmode="decimal" autocomplete="off" placeholder="0" value="${vals[key] ? esc(numForInput(vals[key])) : ''}"`;
      if (!key.startsWith('e|')) return `<label class="bud-line"><span>${esc(label)}</span>${field}></label>`;
      const items = dets[key] || [];
      return `<div class="bud-leaf" data-leaf="${esc(key)}">
        <label class="bud-line"><span>${esc(label)} <button type="button" class="det-btn">${items.length ? `Detalle (${items.length})` : '+ Detalle'}</button></span>${field} ${items.length ? 'readonly' : ''}></label>
        <div class="det-list" ${items.length ? '' : 'hidden'}>${items.map(itemRow).join('')}<button type="button" class="chip add det-add">+ Agregar gasto</button></div>
      </div>`;
    };

    const expBlocks = [...s.expenseCategories].filter((c) => c.active || hasVal(`e|${c.id}|`)).map((c) => {
      const subs = c.subs.filter((x) => x.active || vals[`e|${c.id}|${x.id}`]);
      let lines = subs.map((x) => input(`e|${c.id}|${x.id}`, x.name)).join('');
      if (!subs.length || vals[`e|${c.id}|`]) lines += input(`e|${c.id}|`, subs.length ? 'Sin subcategoría' : c.name);
      return `<div class="bud-cat" data-cat="${esc(c.id)}"><div class="bud-cat-head"><strong>${esc(c.name)}</strong><span class="num muted" data-total></span></div>${lines}</div>`;
    }).join('');
    const incBlock = [...s.incomeCategories].filter((c) => c.active || vals[`i|${c.id}`]).map((c) => input(`i|${c.id}`, c.name)).join('');

    const body = openModal(`Presupuesto de ${ymLabel(ym)}`, `
      <form id="bf" novalidate>
        <div class="seg" id="b-scope" role="group" aria-label="Alcance">
          <button type="button" data-scope="from">Desde ${esc(ymLabel(ym))} en adelante</button>
          <button type="button" data-scope="only">Solo ${esc(ymLabel(ym))}</button>
        </div>
        <p class="hint" id="b-scope-hint"></p>
        <label class="check" id="b-back-w"><input type="checkbox" id="b-back">Aplicar también a los meses anteriores, para comparar el historial</label>
        <div class="actions" style="justify-content:flex-start;margin:0 0 1rem"><button type="button" class="btn small" id="b-avg">Completar vacíos con el promedio de los últimos 3 meses</button></div>
        <div class="bud-grid">
          <div><h3>Egresos</h3>${expBlocks}</div>
          <div><h3>Ingresos</h3><div class="bud-cat">${incBlock}</div></div>
        </div>
        <div class="bud-total"><span>Egresos <strong class="num neg" id="b-exp"></strong></span><span>Ingresos <strong class="num pos" id="b-inc"></strong></span><span>Resultado previsto <strong class="num" id="b-res"></strong></span></div>
        <p class="error" id="b-err"></p>
        <div class="actions">
          ${ov ? '<button type="button" class="btn danger" id="b-clear">Quitar el presupuesto propio de este mes</button><span class="spacer"></span>' : ''}
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="submit" class="btn primary">Guardar</button>
        </div>
      </form>`, { wide: true });
    const el = (id) => $('#' + id, body);
    let scope = ov ? 'only' : 'from';
    const canBackfill = !s.budget.versions.some((v) => v.from < ym);
    function syncScope() {
      $$('#b-scope button', body).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
      const parts = [];
      if (scope === 'from') {
        if (ver && ver.from < ym) parts.push(`Los meses anteriores a ${ymLabel(ym)} mantienen el presupuesto que tenían.`);
        else parts.push(`Rige desde ${ymLabel(ym)}.`);
        if (later.length) parts.push(`Desde ${ymLabel(later[0].from)} ya hay otro presupuesto cargado, que no se modifica.`);

      } else parts.push('Solo cambia este mes. Los demás siguen con su presupuesto.');
      el('b-scope-hint').textContent = parts.join(' ');
      el('b-back-w').hidden = !(scope === 'from' && canBackfill);
      if (scope === 'from' && canBackfill && el('b-back').checked) el('b-scope-hint').textContent = 'Se aplica a todos los meses, también a los anteriores.';
    }
    $$('#b-scope button', body).forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; syncScope(); }));
    el('b-back').addEventListener('change', syncScope);
    syncScope();

    function totals() {
      let e = 0, i = 0;
      $$('.bud-cat[data-cat]', body).forEach((blk) => {
        let t = 0;
        $$('input[data-key]', blk).forEach((inp) => { const v = parseAmount(inp.value); if (v > 0) t += v; });
        $('[data-total]', blk).textContent = t ? money(round2(t)) : '';
        e += t;
      });
      $$('input[data-key^="i|"]', body).forEach((inp) => { const v = parseAmount(inp.value); if (v > 0) i += v; });
      el('b-exp').textContent = money(round2(e)); el('b-inc').textContent = money(round2(i));
      el('b-res').textContent = money(round2(i - e));
      el('b-res').className = `num ${i - e < 0 ? 'neg' : 'pos'}`;
    }
    // Detalle de gastos dentro de una partida: la partida pasa a ser la suma del detalle
    function syncLeaf(leaf) {
      const items = $$('.det-item', leaf);
      const main = $('input[data-key]', leaf);
      const btn = $('.det-btn', leaf);
      if (items.length) {
        const sum = items.reduce((a, it) => { const v = parseAmount($('.det-amt', it).value); return a + (v > 0 ? v : 0); }, 0);
        main.value = sum ? numForInput(round2(sum)) : '';
        main.readOnly = true;
        btn.textContent = `Detalle (${items.length})`;
      } else {
        main.readOnly = false;
        btn.textContent = '+ Detalle';
        $('.det-list', leaf).hidden = true;
      }
    }
    el('bf').addEventListener('click', (e) => {
      const leaf = e.target.closest('.bud-leaf');
      if (!leaf) return;
      const list = $('.det-list', leaf);
      if (e.target.closest('.det-btn')) {
        e.preventDefault();
        if (list.hidden) {
          list.hidden = false;
          if (!$('.det-item', leaf)) {
            const cur = parseAmount($('input[data-key]', leaf).value);
            $('.det-add', leaf).insertAdjacentHTML('beforebegin', itemRow({ amount: cur > 0 ? cur : '' }));
          }
          $('.det-text', leaf)?.focus();
        } else if (!$('.det-item', leaf)) list.hidden = true;
        else list.hidden = true;
        syncLeaf(leaf); totals();
      } else if (e.target.closest('.det-add')) {
        $('.det-add', leaf).insertAdjacentHTML('beforebegin', itemRow());
        const items = $$('.det-text', leaf); items[items.length - 1].focus();
        syncLeaf(leaf);
      } else if (e.target.closest('.det-del')) {
        e.target.closest('.det-item').remove();
        syncLeaf(leaf); totals();
      }
    });
    el('bf').addEventListener('input', (e) => {
      if (e.target.matches('.det-amt')) syncLeaf(e.target.closest('.bud-leaf'));
      if (e.target.matches('input[data-key], .det-amt')) totals();
    });
    totals();

    el('b-avg').addEventListener('click', () => {
      const months = [1, 2, 3].map((n) => addMonths(ym, -n));
      const aggs = months.map((m) => actualAgg(m));
      let filled = 0;
      $$('input[data-key]', body).forEach((inp) => {
        if (inp.value.trim() || inp.readOnly) return;
        const avg = aggs.reduce((a, g) => a + aggValue(g, inp.dataset.key), 0) / 3;
        if (avg > 0) { inp.value = numForInput(Math.round(avg / 100) * 100); filled++; }
      });
      totals();
      toast(filled ? `Se completaron ${filled} partidas` : 'No hay movimientos en los últimos 3 meses para esas partidas');
    });

    if (ov) {
      el('b-clear').addEventListener('click', () => {
        if (!confirm(`¿Quitar el presupuesto propio de ${ymLabel(ym)}? Vuelve a regir el presupuesto general.`)) return;
        delete s.budget.overrides[ym];
        if (s.budget.overrideDetails) delete s.budget.overrideDetails[ym];
        closeModal();
        commit('Presupuesto actualizado');
      });
    }

    el('bf').addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {}, details = {};
      for (const leaf of $$('.bud-leaf', body)) {
        const items = [];
        for (const it of $$('.det-item', leaf)) {
          const text = $('.det-text', it).value.trim();
          const raw = $('.det-amt', it).value.trim();
          const amount = raw ? parseAmount(raw) : 0;
          if (raw && !(amount >= 0)) { $('.det-amt', it).focus(); el('b-err').textContent = 'Hay un importe del detalle que no es válido. Usá coma para los decimales.'; return; }
          if (text || amount) items.push({ id: uid(), text, amount: round2(amount) });
        }
        if (items.length) details[leaf.dataset.leaf] = items;
      }
      for (const inp of $$('input[data-key]', body)) {
        if (!inp.value.trim()) continue;
        const v = parseAmount(inp.value);
        if (!(v >= 0)) { inp.focus(); el('b-err').textContent = 'Hay un monto que no es válido. Usá coma para los decimales.'; return; }
        if (v > 0) values[inp.dataset.key] = round2(v);
      }
      if (scope === 'from') {
        const from = canBackfill && el('b-back').checked ? '' : ym; // '' = sin fecha de inicio
        s.budget.versions = s.budget.versions.filter((v) => v.from !== from && (from !== '' || v.from > ym));
        s.budget.versions.push({ from, values, details });
        delete s.budget.overrides[ym];
        if (s.budget.overrideDetails) delete s.budget.overrideDetails[ym];
      } else {
        s.budget.overrides[ym] = values;
        s.budget.overrideDetails = s.budget.overrideDetails || {};
        s.budget.overrideDetails[ym] = details;
      }
      closeModal();
      commit('Presupuesto guardado');
    });
  }

  // ============================================================
  //  Vencimientos
  // ============================================================
  const RECURRENCE = { '': 'No se repite', '1': 'Todos los meses', '2': 'Cada 2 meses', '3': 'Cada 3 meses', '4': 'Cada 4 meses', '6': 'Cada 6 meses', '12': 'Todos los años' };
  const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const dayMonthFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' });
  const dayMonth = (iso) => { const [y, m, d] = iso.split('-').map(Number); return dayMonthFmt.format(new Date(y, m - 1, d)).replace('.', ''); };
  const paidTx = (d) => (d.paidTxId ? st().transactions.find((t) => t.id === d.paidTxId) : null);
  function dueStatus(d) {
    if (paidTx(d)) return 'pagado';
    const today = todayISO();
    if (d.dueDate >= today) return 'pendiente';
    if (d.secondDueDate && d.secondDueDate >= today) return 'segundo';
    return 'vencido';
  }
  const amountNow = (d) => (dueStatus(d) !== 'pendiente' && d.secondDueDate && d.secondAmount ? d.secondAmount : d.amount);
  const effectiveDate = (d) => (dueStatus(d) === 'segundo' ? d.secondDueDate : d.dueDate);
  function dueBadge(st0) {
    return { pagado: '<span class="badge pay">pagado</span>', pendiente: '<span class="badge">pendiente</span>', segundo: '<span class="badge gold">en 2.º vencimiento</span>', vencido: '<span class="badge off">vencido</span>' }[st0];
  }
  function dueCurrency(d) { const a = account(d.accountId); return a ? accCurrency(a) : BASE; }

  function dueRow(d, compact) {
    const st0 = dueStatus(d);
    const c = expCat(d.categoryId), x = subOf(c, d.subcategoryId);
    const tx = paidTx(d);
    const date = st0 === 'pagado' ? d.dueDate : effectiveDate(d);
    const [, , dd] = date.split('-');
    const sub = [c ? (x ? `${c.name} › ${x.name}` : c.name) : null, accName(d.accountId)].filter(Boolean).join(', ');
    const right = st0 === 'pagado'
      ? `<div class="num">${money(tx.amount, tx.currency)}</div><div class="sub">pagado el ${esc(dateShort(tx.date))}</div>`
      : `<div class="num ${st0 === 'vencido' ? 'neg' : ''}">${money(amountNow(d), dueCurrency(d))}</div><button class="btn small primary" data-action="pay-due" data-id="${esc(d.id)}">Pagar</button>`;
    return `<li class="clickable due-row" data-action="edit-due" data-id="${esc(d.id)}">
      <div class="due-date ${st0}"><strong>${Number(dd)}</strong><span>${esc(dayMonth(date).replace(/^\d+\s*(de\s*)?/, ''))}</span></div>
      <div class="grow"><div class="title">${esc(d.title)}${dueBadge(st0)}${d.estimated && st0 !== 'pagado' ? '<span class="badge">monto estimado</span>' : ''}</div>
        <div class="sub">${esc(sub)}${!compact && d.secondDueDate && st0 === 'pendiente' ? `, 2.º vto. ${esc(dateShort(d.secondDueDate))}` : ''}</div></div>
      <div class="amt due-amt">${right}</div></li>`;
  }

  function dashDues() {
    const today = new Date(todayISO() + 'T00:00');
    const soon = st().dues.filter((d) => {
      const s0 = dueStatus(d);
      if (s0 === 'pagado') return false;
      return daysBetween(today, new Date(effectiveDate(d) + 'T00:00')) <= 10;
    }).sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)));
    if (!soon.length) return '';
    return `<section class="panel"><div class="panel-head"><h2>Vencimientos de los próximos 10 días</h2><button class="btn ghost small" data-view="dues">Ver calendario</button></div>
      <ul class="list">${soon.slice(0, 8).map((d) => dueRow(d, true)).join('')}</ul>${soon.length > 8 ? `<p class="muted small">Y ${soon.length - 8} más.</p>` : ''}</section>`;
  }

  function renderDues() {
    const s = st(), ym = S.month, today = todayISO();
    const monthDues = s.dues.filter((d) => ymOf(d.dueDate) === ym || (d.secondDueDate && ymOf(d.secondDueDate) === ym && ymOf(d.dueDate) < ym && dueStatus(d) !== 'pagado'));
    const overdue = s.dues.filter((d) => dueStatus(d) === 'vencido').sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // Calendario
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(y, m, 0).getDate();
    const byDay = {};
    for (const d of s.dues) {
      const dates = [d.dueDate];
      if (d.secondDueDate && dueStatus(d) !== 'pagado') dates.push(d.secondDueDate);
      for (const dt of dates) if (ymOf(dt) === ym) (byDay[dt] = byDay[dt] || []).push(d);
    }
    let cells = WEEKDAYS.map((w) => `<div class="cal-h">${w}</div>`).join('');
    for (let i = 0; i < offset; i++) cells += '<div class="cal-c empty"></div>';
    for (let dd = 1; dd <= days; dd++) {
      const iso = `${ym}-${pad(dd)}`;
      const list = byDay[iso] || [];
      const dots = list.slice(0, 4).map((d) => `<i class="cal-dot ${dueStatus(d)}"></i>`).join('');
      cells += `<button type="button" class="cal-c ${iso === today ? 'today' : ''} ${S.dueDay === iso ? 'sel' : ''} ${list.length ? 'has' : ''}" data-action="due-day" data-day="${iso}" ${list.length ? '' : 'disabled'} aria-label="${dd}${list.length ? `, ${list.length} vencimiento${list.length > 1 ? 's' : ''}` : ''}">
        <span>${dd}</span><span class="cal-dots">${dots}</span></button>`;
    }

    const shown = (S.dueDay ? (byDay[S.dueDay] || []) : monthDues)
      .sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)) || a.title.localeCompare(b.title));
    const pend = monthDues.filter((d) => dueStatus(d) !== 'pagado');
    const paid = monthDues.filter((d) => dueStatus(d) === 'pagado');
    const sumBy = (list, f) => {
      const t = {};
      list.forEach((d) => { const c = f === 'paid' ? (paidTx(d).currency || BASE) : dueCurrency(d); const v = f === 'paid' ? paidTx(d).amount : amountNow(d); t[c] = (t[c] || 0) + v; });
      return Object.entries(t).map(([c, v]) => money(round2(v), c)).join(' + ') || money(0);
    };
    const rules = s.importRules.map((r) => `<button class="chip" data-action="edit-rule" data-id="${esc(r.id)}">“${esc(r.match)}”<span class="chip-tag">${esc(r.title || '')}</span></button>`).join('');

    return `<div class="view-head"><h1>Vencimientos</h1>
        <div class="head-actions">${monthNav()}<button class="btn" data-action="import-pdf">Importar factura PDF</button><button class="btn primary" data-action="new-due">Nuevo vencimiento</button></div></div>
      ${overdue.length ? `<section class="panel overdue"><div class="panel-head"><h2>Vencidos sin pagar</h2></div><ul class="list">${overdue.map((d) => dueRow(d)).join('')}</ul></section>` : ''}
      <div class="grid2 dues-grid">
        <section class="panel">
          <div class="cal">${cells}</div>
          <div class="legend cal-legend"><span><i class="cal-dot pendiente"></i>Pendiente</span><span><i class="cal-dot segundo"></i>2.º vencimiento</span><span><i class="cal-dot vencido"></i>Vencido</span><span><i class="cal-dot pagado"></i>Pagado</span></div>
          <div class="totals" style="margin-top:1rem"><span>A pagar <strong class="num">${sumBy(pend)}</strong></span><span>Pagado <strong class="num pos">${sumBy(paid, 'paid')}</strong></span></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>${S.dueDay ? esc(cap(dateLabel(S.dueDay))) : `Vencimientos de ${esc(ymLabel(ym))}`}</h2>${S.dueDay ? `<button class="btn ghost small" data-action="due-day" data-day="${S.dueDay}">Ver todo el mes</button>` : ''}</div>
          ${shown.length ? `<ul class="list">${shown.map((d) => dueRow(d)).join('')}</ul>` : `<div class="empty"><p>No hay vencimientos ${S.dueDay ? 'ese día' : 'este mes'}.</p><button class="btn" data-action="import-pdf">Importar factura PDF</button></div>`}
        </section>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Avisos en tu calendario</h2></div>
        <p>Descargá los vencimientos pendientes como archivo de calendario (.ics) para importarlos en Google Calendar o en el Calendario del iPhone, con un aviso 2 días antes.</p>
        <button class="btn" data-action="export-ics">Exportar vencimientos</button>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Reglas de importación</h2></div>
        ${rules ? `<div class="chips">${rules}</div>` : ''}
        <p class="hint" style="margin:.8rem 0 0">Cuando importás una factura podés pedir que se recuerde el concepto, la categoría y la cuenta para las próximas facturas que contengan cierto texto (por ejemplo, el número de partida o de cliente). Tocá una regla para editarla.</p>
      </section>`;
  }

  function openDueForm(due, prefill = {}, afterSave) {
    const s = st();
    const src = due || prefill;
    const d = {
      categoryId: src.categoryId || '', subcategoryId: src.subcategoryId || '',
      accountId: src.accountId || (s.accounts.find((a) => a.active) || {}).id || '',
    };
    const tx = due ? paidTx(due) : null;
    const accOpts = s.accounts.filter((a) => a.active || a.id === d.accountId)
      .map((a) => `<option value="${esc(a.id)}" ${a.id === d.accountId ? 'selected' : ''}>${esc(a.name)}${accCurrency(a) !== BASE ? ' (' + esc(accCurrency(a)) + ')' : ''}</option>`).join('');
    const catOpts = () => '<option value="">Elegí una categoría</option>' + [...s.expenseCategories].filter((c) => c.active || c.id === d.categoryId).sort(byName)
      .map((c) => `<option value="${esc(c.id)}" ${c.id === d.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const subOpts = () => {
      const c = expCat(d.categoryId);
      const subs = c ? c.subs.filter((x) => x.active || x.id === d.subcategoryId).sort(byName) : [];
      return { n: subs.length, html: '<option value="">Elegí una subcategoría</option>' + subs.map((x) => `<option value="${esc(x.id)}" ${x.id === d.subcategoryId ? 'selected' : ''}>${esc(x.name)}</option>`).join('') };
    };
    const det = prefill.detected || null;
    const chips = (list, kind) => list.map((c) => `<button type="button" class="chip pick" data-kind="${kind}" data-value="${esc(c.value)}">${esc(c.label)}</button>`).join('');
    const detHtml = det ? `<div class="det">
        <p class="small"><strong>${det.issuer ? `Detectado: ${esc(det.issuer)}.` : 'No se reconoció el emisor.'}</strong> ${det.rule ? `Se aplicó tu regla “${esc(det.rule)}”.` : ''} Revisá los datos antes de guardar.</p>
        ${det.dates.length ? `<p class="small muted" style="margin-bottom:.3rem">Fechas encontradas (tocá para usarla como vencimiento):</p><div class="chips">${chips(det.dates, 'date')}</div>` : ''}
        ${det.amounts.length ? `<p class="small muted" style="margin:.6rem 0 .3rem">Importes encontrados:</p><div class="chips">${chips(det.amounts, 'amount')}</div>` : ''}
        <details style="margin-top:.6rem"><summary class="small muted">Ver el texto leído del PDF</summary><pre class="pdf-text">${esc(det.text.slice(0, 6000))}</pre></details>
      </div>` : '';
    const body = openModal(due ? 'Editar vencimiento' : (det ? `Factura: ${prefill.fileName || ''}` : 'Nuevo vencimiento'), `
      <form id="duf" novalidate>
        ${detHtml}
        <label class="field"><span>Concepto</span><input id="u-title" maxlength="80" value="${esc(src.title || '')}" placeholder="Ej.: ARBA Inmobiliario, Edenor" autocomplete="off"></label>
        <div class="row">
          <label class="field"><span>Vencimiento</span><input id="u-date" type="date" value="${esc(src.dueDate || '')}"></label>
          <label class="field"><span>Importe</span><input id="u-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(numForInput(src.amount))}"></label>
        </div>
        <div class="row">
          <label class="field"><span>2.º vencimiento (opcional)</span><input id="u-date2" type="date" value="${esc(src.secondDueDate || '')}"></label>
          <label class="field"><span>Importe al 2.º vencimiento</span><input id="u-amount2" inputmode="decimal" autocomplete="off" value="${esc(numForInput(src.secondAmount))}"></label>
        </div>
        <label class="field"><span>Se paga desde</span><select id="u-acc">${accOpts}</select></label>
        <div class="row">
          <label class="field"><span>Categoría del gasto</span><select id="u-cat">${catOpts()}</select></label>
          <label class="field" id="u-sub-w"><span>Subcategoría</span><select id="u-sub"></select></label>
        </div>
        <label class="field"><span>Repetir</span><select id="u-rec">${Object.entries(RECURRENCE).map(([k, l]) => `<option value="${k}" ${String(src.recurrence || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="hint">Al pagarlo se agenda solo el próximo vencimiento con el mismo importe como estimado.</p>
        <label class="field"><span>Referencia</span><input id="u-ref" maxlength="80" value="${esc(src.reference || '')}" placeholder="Opcional: partida, n.º de cliente, dominio" autocomplete="off"></label>
        ${det ? `<label class="check"><input type="checkbox" id="u-learn" ${det.rule ? '' : 'checked'}>Recordar concepto, categoría, cuenta y repetición para facturas que contengan:</label>
          <label class="field" style="margin-top:-.4rem"><input id="u-match" maxlength="60" value="${esc(det.suggestMatch || '')}" autocomplete="off"></label>` : ''}
        ${tx ? `<div class="preview">Pagado el ${esc(dateShort(tx.date))} desde ${esc(accName(tx.accountId))} por ${money(tx.amount, tx.currency)}.
          <div class="actions" style="justify-content:flex-start;margin-top:.5rem"><button type="button" class="btn small" id="u-open-tx">Ver el pago</button><button type="button" class="btn small" id="u-unpay">Desvincular el pago</button></div></div>` : ''}
        <p class="error" id="u-err"></p>
        <div class="actions">
          ${due ? '<button type="button" class="btn danger" id="u-del">Eliminar</button><span class="spacer"></span>' : ''}
          <button type="button" class="btn" data-close>${det ? 'Descartar' : 'Cancelar'}</button>
          <button type="submit" class="btn primary">Guardar</button>
        </div>
      </form>`);
    const el = (i) => $('#' + i, body);
    const syncSub = () => { const so = subOpts(); el('u-sub').innerHTML = so.html; el('u-sub-w').hidden = !so.n; };
    syncSub();
    el('u-cat').addEventListener('change', (e) => { d.categoryId = e.target.value; d.subcategoryId = ''; syncSub(); });
    el('u-sub').addEventListener('change', (e) => { d.subcategoryId = e.target.value; });
    $$('.chip.pick', body).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.kind === 'date') { if (!el('u-date').value || el('u-date').dataset.picked) el('u-date').value = b.dataset.value; else el('u-date2').value = b.dataset.value; el('u-date').dataset.picked = '1'; }
      else { const tgt = el('u-amount').value && el('u-amount').dataset.picked ? 'u-amount2' : 'u-amount'; el(tgt).value = numForInput(Number(b.dataset.value)); el('u-amount').dataset.picked = '1'; }
    }));
    if (tx) {
      el('u-open-tx').addEventListener('click', () => openTxForm(tx));
      el('u-unpay').addEventListener('click', () => {
        if (!confirm('El vencimiento vuelve a quedar pendiente. El movimiento del pago no se borra. ¿Continuar?')) return;
        due.paidTxId = null; closeModal(); commit('Pago desvinculado');
      });
    }
    if (due) {
      el('u-del').addEventListener('click', () => {
        if (!confirm(`¿Eliminar el vencimiento “${due.title}”?${tx ? ' El movimiento del pago se mantiene.' : ''}`)) return;
        s.dues = s.dues.filter((x) => x.id !== due.id); closeModal(); commit('Vencimiento eliminado');
      });
    }
    el('duf').addEventListener('submit', (e) => {
      e.preventDefault();
      const err = (m) => { el('u-err').textContent = m; };
      const title = el('u-title').value.trim();
      if (!title) return err('Ingresá el concepto.');
      const dueDate = el('u-date').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return err('Ingresá la fecha de vencimiento.');
      const amount = parseAmount(el('u-amount').value);
      if (!(amount > 0)) return err('Ingresá el importe.');
      const secondDueDate = el('u-date2').value || '';
      if (secondDueDate && secondDueDate <= dueDate) return err('El 2.º vencimiento tiene que ser posterior al primero.');
      const a2raw = el('u-amount2').value.trim();
      const secondAmount = a2raw ? parseAmount(a2raw) : null;
      if (a2raw && !(secondAmount > 0)) return err('El importe al 2.º vencimiento no es válido.');
      if (!d.categoryId) return err('Elegí la categoría a la que se va a imputar el pago.');
      const c = expCat(d.categoryId);
      if (c && c.subs.some((x) => x.active) && !d.subcategoryId) return err('Elegí la subcategoría.');
      const accountId = el('u-acc').value;
      if (!account(accountId)) return err('Elegí la cuenta desde la que vas a pagar.');
      const data = {
        title, dueDate, amount: round2(amount), secondDueDate, secondAmount: secondAmount ? round2(secondAmount) : null,
        accountId, categoryId: d.categoryId, subcategoryId: d.subcategoryId || '', recurrence: el('u-rec').value,
        reference: el('u-ref').value.trim(),
      };
      if (due) {
        if (data.amount !== due.amount) data.estimated = false;
        Object.assign(due, data);
      } else s.dues.push({ id: uid(), ...data, estimated: false, paidTxId: null, createdAt: new Date().toISOString() });
      if (det && el('u-learn').checked) {
        const match = el('u-match').value.trim();
        if (match) {
          const r = s.importRules.find((x) => normText(x.match) === normText(match));
          const rd = { match, title, categoryId: data.categoryId, subcategoryId: data.subcategoryId, accountId, recurrence: data.recurrence };
          if (r) Object.assign(r, rd); else s.importRules.push({ id: uid(), ...rd });
        }
      }
      closeModal();
      commit(due ? 'Vencimiento actualizado' : `Vencimiento agendado para el ${dateShort(dueDate)}`);
    });
    // Al cerrar (guardando o descartando) sigue con la próxima factura de la cola
    if (afterSave) $('#modal').addEventListener('close', () => setTimeout(afterSave, 250), { once: true });
  }

  function payDue(due) {
    openTxForm(null, {
      type: 'egreso', title: `Pagar: ${due.title}`, accountId: due.accountId, amount: amountNow(due),
      categoryId: due.categoryId, subcategoryId: due.subcategoryId, description: due.title, date: todayISO(),
      onSaved: (txs) => {
        due.paidTxId = txs[0].id;
        if (due.recurrence && !due.nextId) {
          const n = Number(due.recurrence);
          const next = {
            ...due, id: uid(), dueDate: addMonthsISO(due.dueDate, n),
            secondDueDate: due.secondDueDate ? addMonthsISO(due.secondDueDate, n) : '',
            amount: due.amount,
            paidTxId: null, nextId: null, estimated: true, createdAt: new Date().toISOString(),
          };
          st().dues.push(next);
          due.nextId = next.id;
          return `Pago registrado. Próximo vencimiento agendado: ${dateShort(next.dueDate)}`;
        }
        return 'Pago registrado';
      },
    });
  }

  function exportIcsForm() {
    const pend = st().dues.filter((d) => dueStatus(d) !== 'pagado');
    if (!pend.length) { toast('No hay vencimientos pendientes para exportar'); return; }
    simpleForm({
      title: 'Exportar vencimientos',
      fields: [
        { name: 'amounts', label: 'Incluir los importes', type: 'checkbox', value: false },
        { name: 'second', label: 'Agregar también los segundos vencimientos', type: 'checkbox', value: false },
      ],
      onSave: (v) => {
        const icsEsc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
        const ev = (d, date, label, amt) => {
          const day = date.replace(/-/g, '');
          const end = addDaysISO(date, 1).replace(/-/g, '');
          const sum = `Vence ${label}${v.amounts ? ` (${money(amt, dueCurrency(d)).replace('−', '-')})` : ''}`;
          return ['BEGIN:VEVENT', `UID:${d.id}${label.includes('2.º') ? '-2' : ''}@finanzas`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end}`,
            `SUMMARY:${icsEsc(sum)}`, 'TRANSP:TRANSPARENT',
            'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(sum)}`, 'TRIGGER:-P2D', 'END:VALARM', 'END:VEVENT'].join('\r\n');
        };
        const events = [];
        for (const d of pend) {
          if (d.dueDate >= todayISO() || dueStatus(d) === 'vencido') events.push(ev(d, d.dueDate, d.title, d.amount));
          if (v.second && d.secondDueDate) events.push(ev(d, d.secondDueDate, `${d.title} (2.º vto.)`, d.secondAmount || d.amount));
        }
        const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finanzas personales//ES', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
        downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), `vencimientos-${todayISO()}.ics`);
        toast(`${events.length} vencimientos exportados`);
        return null;
      },
    });
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'El archivo no está cifrado: cualquiera que lo vea puede leer los conceptos (y los importes, si los incluís). Si lo reimportás más adelante, los eventos se actualizan en lugar de duplicarse.';
    $('#sf').insertBefore(hint, $('#sf-err'));
  }
  function addDaysISO(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }

  function openRuleForm(r) {
    const s = st();
    simpleForm({
      title: 'Regla de importación',
      fields: [
        { name: 'match', label: 'Si el PDF contiene el texto', value: r.match, maxlength: 60, hint: 'No distingue mayúsculas ni acentos. Cuanto más específico (n.º de partida, de cliente, dominio), mejor.' },
        { name: 'title', label: 'Usar el concepto', value: r.title, maxlength: 80 },
        { name: 'accountId', label: 'Pagar desde', type: 'select', value: r.accountId, options: s.accounts.filter((a) => a.active || a.id === r.accountId).map((a) => ({ value: a.id, label: a.name })) },
        { name: 'recurrence', label: 'Repetir', type: 'select', value: String(r.recurrence || ''), options: Object.entries(RECURRENCE).map(([value, label]) => ({ value, label })) },
      ],
      onSave: (v) => {
        if (!v.match) return 'Ingresá el texto a buscar.';
        Object.assign(r, { match: v.match, title: v.title, accountId: v.accountId, recurrence: v.recurrence });
        commit('Regla actualizada');
        return null;
      },
      onDelete: () => { if (!confirm('¿Eliminar esta regla?')) return false; s.importRules = s.importRules.filter((x) => x.id !== r.id); commit('Regla eliminada'); return true; },
    });
    const c = expCat(r.categoryId), x = subOf(c, r.subcategoryId);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = `Categoría: ${c ? c.name + (x ? ' › ' + x.name : '') : 'sin definir'}. Para cambiarla, importá una factura de este emisor y guardala con la nueva categoría.`;
    $('#sf').insertBefore(hint, $('#sf-err'));
  }

  // ============================================================
  //  Conciliación de resúmenes bancarios y de tarjeta
  // ============================================================
  const curStmt = () => st().statements.find((x) => x.id === S.reconId) || null;
  const MONTHS_EN = { jan: 1, apr: 4, aug: 8, dec: 12 };
  const monthFromName = (m) => MONTHS[m.slice(0, 3)] || MONTHS_EN[m.slice(0, 3)] || null;

  // ----- Lectura de archivos -----
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''); }
    catch { return new TextDecoder('windows-1252').decode(buf); }
  }
  function parseCSV(text) {
    const sample = text.split(/\r?\n/).slice(0, 15).join('\n');
    const delim = [';', ',', '\t', '|'].map((d) => [d, sample.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim()));
  }
  function parseHtmlTable(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const tables = [...doc.querySelectorAll('table')];
    if (!tables.length) return null;
    const t = tables.sort((a, b) => b.rows.length - a.rows.length)[0];
    return [...t.rows].map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  }
  async function unzip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for (let i = 0; i < count && dv.getUint32(p, true) === 0x02014b50; i++) {
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const name = td.decode(new Uint8Array(buf, p + 46, nlen));
      entries[name] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) };
      p += 46 + nlen + xlen + clen;
    }
    return async (name) => {
      const e = entries[name];
      if (!e) return null;
      const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
      const data = new Uint8Array(buf, start, e.size);
      if (e.method === 0) return td.decode(data);
      if (e.method !== 8 || !window.DecompressionStream) throw new Error('zip-method');
      const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      return td.decode(out);
    };
  }
  async function readXlsx(buf) {
    const read = await unzip(buf);
    const parser = new DOMParser();
    const xml = async (n) => { const t = await read(n); return t ? parser.parseFromString(t, 'application/xml') : null; };
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const sh = wb.getElementsByTagName('sheet')[0];
      const rid = sh && (sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rel = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
    }
    const ssDoc = await xml('xl/sharedStrings.xml');
    const ss = ssDoc ? [...ssDoc.getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
    const sheet = await xml(sheetPath);
    if (!sheet) throw new Error('xlsx-sheet');
    const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const rows = [];
    for (const r of sheet.getElementsByTagName('row')) {
      const row = [];
      let auto = 0;
      for (const c of r.getElementsByTagName('c')) {
        const ref = c.getAttribute('r');
        const ci = ref ? colIdx(ref) : auto;
        auto = ci + 1;
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 's') val = ss[Number(v ? v.textContent : -1)] ?? '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        else if (t === 'str' || t === 'b' || t === 'e') val = v ? v.textContent : '';
        else if (v) val = Number(v.textContent); // número real de Excel
        row[ci] = val;
      }
      rows.push(Array.from(row, (x) => (x === undefined ? '' : x)));
    }
    return rows.filter((r) => r.some((x) => String(x).trim()));
  }
  async function readStatementFile(file) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 8));
    const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
    if (isPdf) return { type: 'pdf', lines: await pdfToText(file, undefined, 40) };
    if (head[0] === 0x50 && head[1] === 0x4b) return { type: 'table', rows: await readXlsx(buf) };
    if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error('xls-binario');
    const text = decodeText(buf);
    if (/^\s*</.test(text) && /<table/i.test(text)) { const rows = parseHtmlTable(text); if (rows) return { type: 'table', rows }; }
    return { type: 'table', rows: parseCSV(text) };
  }

  // ----- Interpretación de celdas -----
  function cellDate(v) {
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
      return null;
    }
    const t = normText(v);
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return validISO(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    if (m) return validISO(+m[3], +m[2], +m[1]);
    m = t.match(/^(\d{1,2})[\s/.-]*([a-z]{3})[a-z]*\.?[\s/.-]*(\d{2,4})\b/);
    if (m && monthFromName(m[2])) return validISO(+m[3], monthFromName(m[2]), +m[1]);
    return null;
  }
  function validISO(y, m, d) {
    if (y < 100) y += 2000;
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  function cellNum(v) {
    if (typeof v === 'number') return v;
    let t = String(v ?? '').trim();
    if (!t) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/-\s*$/.test(t)) { neg = true; t = t.replace(/-\s*$/, ''); }
    t = t.replace(/^[^\d\-]+/, '').replace(/[^\d.,\-]+$/, '');
    const n = parseAmount(t);
    return Number.isNaN(n) ? NaN : (neg ? -Math.abs(n) : n);
  }

  // ----- Tablas: encabezados y columnas -----
  const ROLE_RE = {
    date: /fecha/, desc: /descrip|concepto|detalle|movimiento|referencia|leyenda|comercio|establecimiento/,
    amount: /importe|monto|valor|pesos/, debit: /debito|debe|egreso|retiro|cargo/, credit: /credito|haber|ingreso|deposito|abono/, balance: /saldo/,
  };
  const ROLE_LABEL = { date: 'Fecha', desc: 'Descripción', amount: 'Importe (una sola columna)', debit: 'Débitos', credit: 'Créditos', balance: 'Saldo' };
  function detectHeader(rows) {
    let best = -1, bestScore = 1;
    for (let i = 0; i < Math.min(40, rows.length); i++) {
      const cells = rows[i].map((c) => normText(c));
      const sc = ['date', 'desc', 'amount', 'debit', 'credit', 'balance'].filter((k) => cells.some((c) => c.length < 40 && ROLE_RE[k].test(c))).length;
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    return best;
  }
  function guessRoles(headers) {
    const used = new Set(), roles = {};
    for (const k of ['balance', 'debit', 'credit', 'date', 'desc', 'amount']) {
      const i = headers.findIndex((h, j) => !used.has(j) && ROLE_RE[k].test(normText(h)));
      roles[k] = i; if (i >= 0) used.add(i);
    }
    if (roles.debit >= 0 && roles.credit >= 0) roles.amount = -1;
    return roles;
  }
  function tableRows(rows, start, roles, invert) {
    const out = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const date = roles.date >= 0 ? cellDate(r[roles.date]) : null;
      if (!date) continue;
      let amt;
      if (roles.amount >= 0) amt = cellNum(r[roles.amount]);
      else {
        const d = roles.debit >= 0 ? cellNum(r[roles.debit]) : NaN, c = roles.credit >= 0 ? cellNum(r[roles.credit]) : NaN;
        if (Number.isNaN(d) && Number.isNaN(c)) continue;
        amt = (Number.isNaN(c) ? 0 : Math.abs(c)) - (Number.isNaN(d) ? 0 : Math.abs(d));
      }
      if (Number.isNaN(amt) || !amt) continue;
      if (invert) amt = -amt;
      const desc = roles.desc >= 0 ? String(r[roles.desc]).replace(/\s+/g, ' ').trim() : '';
      const bal = roles.balance >= 0 ? cellNum(r[roles.balance]) : NaN;
      out.push({ date, desc, amount: round2(amt), balance: Number.isNaN(bal) ? null : round2(bal), order: i, inst: instOf(desc) });
    }
    return out;
  }
  function instOf(desc) {
    const m = String(desc).match(/(?:^|\s)(?:c(?:uota)?\.?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i) || String(desc).match(/\bc(?:uota)?\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i);
    if (!m) return null;
    const k = +m[1], n = +m[2];
    return k >= 1 && n >= 2 && k <= n && n <= 60 ? { k, n } : null;
  }

  // ----- Resúmenes en PDF (pensado para tarjetas de crédito) -----
  function pdfStatement(lines) {
    const rows = [];
    let due = null, closing = null;
    const dateRe = /^\s*(\d{1,2})[\s/.-]*(\d{1,2}|[a-zA-Z]{3,10})\.?[\s/.-]*(\d{2,4})\b/;
    const amtRe = /-?\s?\$?\s?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(\s?-)?(?!\d)/g;
    lines.forEach((ln, order) => {
      const n = normText(ln);
      const anyDate = (s0) => { const mm = s0.match(/(\d{1,2})[/.-](\d{1,2}|[a-z]{3})[/.-](\d{2,4})/); return mm ? cellDate(mm[0]) : null; };
      if (!due && /vencimiento/.test(n) && !/proximo|prox\./.test(n)) due = anyDate(n.slice(n.indexOf('vencimiento')));
      if (!closing && /cierre/.test(n) && !/proximo|prox\./.test(n)) closing = anyDate(n.slice(n.indexOf('cierre')));
      const m = ln.match(dateRe);
      if (!m) return;
      const date = cellDate(m[0].trim());
      if (!date) return;
      const rest = ln.slice(m[0].length);
      const nr = normText(rest);
      if (/saldo anterior|saldo actual|saldo pendiente|total consumos|subtotal|pago minimo|limite de|tasa|cierre|vencimiento|tna|tea|cft/.test(nr)) return;
      const amts = [...rest.matchAll(amtRe)];
      if (!amts.length) return;
      const last = amts[amts.length - 1];
      let v = parseAmount(last[1]);
      if (!(v > 0)) return;
      const negative = /-/.test(last[0].replace(/\s/g, '').slice(0, 1)) || !!last[2];
      let desc = rest.slice(0, amts[0].index).replace(/\s+/g, ' ').trim();
      const inst = instOf(desc);
      if (inst) desc = desc.replace(/(?:\s(?:c(?:uota)?\.?\s*)?\d{1,2}\s*\/\s*\d{1,2})\s*$/i, '').trim();
      desc = desc.replace(/^\d{3,}\s+/, '').replace(/^[*\s]+/, '');
      const cur = /\busd\b|u\$s|dolar/.test(n) ? 'USD' : null;
      if (cur) desc = desc.replace(/\s*\b(usd|u\$s)\b\s*/gi, ' ').trim();
      // En un resumen de tarjeta los consumos son positivos: para la cuenta son salidas
      rows.push({ date, desc, amount: round2(negative ? v : -v), inst, cur, order });
    });
    return { rows, due, closing };
  }

  // ----- Memoria de descripciones -----
  const STOPW = new Set(['www', 'com', 'del', 'con', 'por', 'los', 'las', 'srl', 'sas', 'para', 'compra', 'cuota', 'pesos']);
  const descKey = (d) => normText(d).replace(/[^a-z ]/g, ' ').split(' ').filter((w) => w.length >= 3 && !STOPW.has(w)).slice(0, 3).join(' ');
  function suggestFor(row) {
    const k = descKey(row.desc);
    const mem = k && st().descMemory[k];
    if (mem) return { ...mem };
    if (k) {
      const t = [...st().transactions].reverse().find((x) => x.description && x.type !== 'transferencia' && descKey(x.description) === k);
      if (t) return { type: t.type, categoryId: t.categoryId, subcategoryId: t.subcategoryId || '' };
    }
    if (/su pago|pago tarjeta|pago de tarjeta|pago resumen|pago visa|pago master|transferencia|transf\b|debin/.test(normText(row.desc))) return { type: 'transferencia' };
    if (row.amount > 0 && /devoluc|reintegro|bonific|anulac|reverso|contracargo|cashback|descuento/.test(normText(row.desc))) return { type: 'egreso' };
    return { type: row.amount < 0 ? 'egreso' : 'ingreso' };
  }
  function draftOf(row) {
    if (!S.reconDraft[row.id]) {
      const sg = suggestFor(row);
      S.reconDraft[row.id] = { sel: !!(sg.categoryId || sg.otherAccountId), type: sg.type, categoryId: sg.categoryId || '', subcategoryId: sg.subcategoryId || '', otherAccountId: sg.otherAccountId || '', rest: true };
    }
    return S.reconDraft[row.id];
  }

  // ----- Motor de conciliación -----
  const daysDiff = (a, b) => Math.abs(daysBetween(new Date(a + 'T00:00'), new Date(b + 'T00:00')));
  function similarity(a, b) {
    const ta = new Set(normText(a).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length >= 3));
    const tb = new Set(normText(b).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length >= 3));
    if (!ta.size || !tb.size) return 0;
    let n = 0; ta.forEach((w) => { if (tb.has(w)) n++; });
    return n / Math.min(ta.size, tb.size);
  }
  // Efecto de cada movimiento sobre una cuenta (+ entra, − sale)
  function effectsFor(accId) {
    const out = [];
    for (const t of st().transactions) {
      if (t.type === 'ingreso' && ledgerId(t.accountId) === accId) out.push({ t, eff: t.amount });
      else if (t.type === 'egreso' && ledgerId(t.accountId) === accId) out.push({ t, eff: -t.amount });
      else if (t.type === 'transferencia') {
        if (ledgerId(t.accountId) === accId) out.push({ t, eff: -t.amount });
        else if (ledgerId(t.toAccountId) === accId) out.push({ t, eff: t.toAmount });
      }
    }
    return out;
  }
  const stmtAccounts = (x) => [x.accountId, x.usdAccountId].filter((id) => id && account(id));
  function reconcile(x) {
    const txIds = new Set(st().transactions.map((t) => t.id));
    for (const r of x.rows) {
      if ((r.status === 'match' || r.status === 'diff' || r.status === 'created') && !txIds.has(r.txId)) { r.status = 'missing'; r.txId = null; }
    }
    const used = new Set(x.rows.filter((r) => r.txId).map((r) => r.txId));
    const isCard = (id) => account(id)?.type === 'credito';
    const pool = [];
    for (const accId of stmtAccounts(x)) {
      for (const e of effectsFor(accId)) if (!used.has(e.t.id) && (!e.t.recon || e.t.recon === x.id)) pool.push({ ...e, accId });
    }
    const pending = x.rows.filter((r) => r.status === 'missing');
    // 1) mismo importe, fecha cercana (más margen para cuotas, que llevan la fecha de compra)
    const pairs = [];
    for (const r of pending) for (const e of pool) {
      if (e.accId !== r.accountId || Math.abs(e.eff - r.amount) > 0.01 || (r.rejected || []).includes(e.t.id)) continue;
      const dd = daysDiff(r.date, e.t.date);
      const instOk = r.inst && e.t.installmentsTotal ? (r.inst.k === e.t.installmentNo && r.inst.n === e.t.installmentsTotal) : null;
      const win = r.inst || e.t.installmentsTotal ? 45 : (isCard(r.accountId) ? 7 : 5);
      if (dd > win || instOk === false) continue;
      pairs.push({ r, e, score: 100 - dd * 2 + (instOk ? 30 : 0) + similarity(r.desc, e.t.description || '') * 10 });
    }
    const takenR = new Set(), takenT = new Set();
    pairs.sort((a, b) => b.score - a.score).forEach(({ r, e }) => {
      if (takenR.has(r.id) || takenT.has(e.t.id)) return;
      takenR.add(r.id); takenT.add(e.t.id); r.status = 'match'; r.txId = e.t.id;
    });
    // 2) importe parecido (hasta 10 %) con fecha muy cercana o descripción parecida
    const near = [];
    for (const r of pending) if (!takenR.has(r.id)) for (const e of pool) {
      if (takenT.has(e.t.id) || e.accId !== r.accountId || Math.sign(e.eff) !== Math.sign(r.amount) || (r.rejected || []).includes(e.t.id)) continue;
      const ratio = Math.abs(e.eff - r.amount) / Math.abs(r.amount);
      const dd = daysDiff(r.date, e.t.date);
      const sim = similarity(r.desc, e.t.description || '');
      if (ratio <= 0.1 && dd <= 3 && (sim >= 0.34 || (dd <= 1 && ratio <= 0.03))) near.push({ r, e, score: sim * 10 - dd - ratio * 50 });
    }
    near.sort((a, b) => b.score - a.score).forEach(({ r, e }) => {
      if (takenR.has(r.id) || takenT.has(e.t.id)) return;
      takenR.add(r.id); takenT.add(e.t.id); r.status = 'diff'; r.txId = e.t.id;
    });
    // Marcas de conciliado en los movimientos
    const linked = new Set(x.rows.filter((r) => r.txId && r.status !== 'diff').map((r) => r.txId));
    for (const t of st().transactions) {
      if (linked.has(t.id)) t.recon = x.id;
      else if (t.recon === x.id) delete t.recon;
    }
  }
  // Movimientos de la app que deberían figurar en el resumen y no están
  function appOnly(x) {
    const used = new Set(x.rows.filter((r) => r.txId).map((r) => r.txId));
    const out = [];
    for (const accId of stmtAccounts(x)) {
      const card = account(accId)?.type === 'credito';
      for (const e of effectsFor(accId)) {
        if (used.has(e.t.id) || (e.t.recon && e.t.recon !== x.id)) continue;
        const inRange = card && x.period ? e.t.period === x.period : (e.t.date >= x.from && e.t.date <= x.to);
        if (inRange) out.push(e);
      }
    }
    return out.sort((a, b) => a.t.date.localeCompare(b.t.date));
  }
  function balanceAt(accId, date) {
    const acc = account(accId);
    let b = Number(acc.initialBalance) || 0;
    for (const e of effectsFor(accId)) if (e.t.date <= date) b += e.eff;
    return round2(b);
  }

  // ----- Alta del resumen -----
  function createStatement({ acc, usdAcc, fileName, kind, rows, period }) {
    const s = st();
    const dates = rows.map((r) => r.date).sort();
    const accCur = accCurrency(acc);
    let endBalance = null;
    const withBal = rows.filter((r) => r.balance !== null && r.balance !== undefined);
    if (withBal.length && acc.type !== 'credito') {
      const maxDate = dates[dates.length - 1];
      const desc = rows.length > 1 && rows[0].date > rows[rows.length - 1].date;
      const cands = withBal.filter((r) => r.date === maxDate).sort((a, b) => a.order - b.order);
      const pick = cands.length ? (desc ? cands[0] : cands[cands.length - 1]) : null;
      if (pick) endBalance = { date: maxDate, amount: pick.balance };
    }
    const x = {
      id: uid(), accountId: acc.id, usdAccountId: usdAcc ? usdAcc.id : '', fileName, kind,
      importedAt: new Date().toISOString(), from: dates[0], to: dates[dates.length - 1], period: period || '', endBalance,
      rows: rows.map((r) => {
        const cur = r.cur || accCur;
        const target = cur === accCur ? acc : (usdAcc && accCurrency(usdAcc) === cur ? usdAcc : null);
        return { id: uid(), date: r.date, desc: r.desc, amount: r.amount, currency: cur, accountId: target ? target.id : acc.id, inst: r.inst || null,
          status: target ? 'missing' : 'ignored', note: target ? '' : `en ${cur}: elegí una cuenta en esa moneda al importar`, txId: null };
      }),
    };
    // Renglones que ya vinieron en otro resumen importado de la misma cuenta
    const key = (r) => `${r.accountId}|${r.date}|${r.amount}|${descKey(r.desc)}`;
    const prev = new Set(s.statements.filter((o) => o.accountId === acc.id).flatMap((o) => o.rows.filter((r) => r.status !== 'dup').map(key)));
    x.rows.forEach((r) => { if (r.status === 'missing' && prev.has(key(r))) { r.status = 'dup'; r.note = 'ya estaba en otro resumen importado'; } });
    s.statements.push(x);
    reconcile(x);
    return x;
  }
  function importMsg(x) {
    const dup = x.rows.filter((r) => r.status === 'dup').length;
    if (dup === x.rows.length) return 'Estos movimientos ya estaban en un resumen importado antes';
    return dup ? `Resumen conciliado. ${dup} movimientos ya estaban importados y se ignoraron` : 'Resumen importado y conciliado';
  }
  function deleteStatement(id) {
    const s = st();
    const x = s.statements.find((y) => y.id === id);
    if (!x || !confirm('¿Eliminar este resumen importado? Los movimientos registrados se mantienen; solo se quita la marca de conciliado.')) return;
    s.transactions.forEach((t) => { if (t.recon === id) delete t.recon; });
    s.statements = s.statements.filter((y) => y.id !== id);
    S.reconId = null;
    commit('Resumen eliminado');
  }

  // ----- Importación (asistente) -----
  function openStatementImport() {
    const accs = st().accounts.filter((a) => a.active && !linkedTarget(a));
    if (!accs.length) { toast('Primero creá una cuenta.'); return; }
    const body = openModal('Importar resumen', `
      <form id="sif" novalidate>
        <label class="field"><span>Cuenta del resumen</span><select id="si-acc">${accs.map((a) => `<option value="${esc(a.id)}" ${a.id === S.lastReconAcc ? 'selected' : ''}>${esc(a.name)}${accCurrency(a) !== BASE ? ' (' + esc(accCurrency(a)) + ')' : ''}</option>`).join('')}</select></label>
        <label class="field"><span>Archivo</span><input type="file" id="si-file" accept=".csv,.txt,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
        <p class="hint">Para cuentas bancarias conviene el Excel o CSV que exporta el home banking. Para tarjetas sirve el PDF del resumen. Todo se procesa en tu dispositivo.</p>
        <p class="error" id="si-err"></p>
        <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary" id="si-ok">Leer archivo</button></div>
      </form>`);
    $('#sif', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = (m) => { $('#si-err', body).textContent = m; };
      const acc = account($('#si-acc', body).value);
      const file = $('#si-file', body).files[0];
      if (!file) return err('Elegí el archivo del resumen.');
      S.lastReconAcc = acc.id;
      const btn = $('#si-ok', body); btn.disabled = true; btn.textContent = 'Leyendo…';
      let parsed;
      try { parsed = await readStatementFile(file); } catch (ex) {
        btn.disabled = false; btn.textContent = 'Leer archivo';
        const msg = String(ex && ex.message);
        if (ex && ex.name === 'PasswordException') return err('El PDF está protegido con contraseña. Abrilo, guardalo sin contraseña e importalo de nuevo.');
        if (msg === 'xls-binario') return err('Es un Excel antiguo (.xls). Abrilo y guardalo como .xlsx o .csv, e importalo de nuevo.');
        if (/zip-method/.test(msg)) return err('Este navegador no puede abrir este Excel. Guardalo como .csv e importalo de nuevo.');
        console.error(ex);
        return err('No se pudo leer el archivo. Probá exportarlo en otro formato (.csv o .xlsx).');
      }
      if (parsed.type === 'pdf') stepPdf(acc, file, parsed.lines); else stepTable(acc, file, parsed.rows);
    });
  }

  function previewHtml(rows, accCur) {
    if (!rows.length) return '<p class="error">No se encontraron movimientos con estos ajustes.</p>';
    return `<div class="scroll-x"><table class="simple"><thead><tr><th>Fecha</th><th>Descripción</th><th class="r">Importe</th></tr></thead><tbody>
      ${rows.slice(0, 8).map((r) => `<tr><td>${esc(dateShort(r.date))}</td><td>${esc(r.desc)}${r.inst ? ` <span class="badge gold">cuota ${r.inst.k}/${r.inst.n}</span>` : ''}${r.cur && r.cur !== accCur ? ` <span class="badge">${esc(r.cur)}</span>` : ''}</td>
        <td class="r num ${r.amount < 0 ? 'neg' : 'pos'}">${r.amount < 0 ? '−' : '+'}${money(Math.abs(r.amount), r.cur || accCur)}</td></tr>`).join('')}
      </tbody></table></div><p class="hint" style="margin:.4rem 0 0">${rows.length} movimientos. En rojo, lo que sale de la cuenta (gastos); en verde, lo que entra.</p>`;
  }
  function periodSelect(id, sel) {
    const opts = []; for (let i = -6; i <= 3; i++) opts.push(addMonths(ymOf(todayISO()), i));
    if (sel && !opts.includes(sel)) opts.push(sel);
    return `<select id="${id}">${opts.sort().map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${esc(ymTitle(m))}</option>`).join('')}</select>`;
  }

  function stepTable(acc, file, rows) {
    const hdr = detectHeader(rows);
    const width = Math.max(...rows.slice(0, 60).map((r) => r.length));
    const headers = hdr >= 0 ? Array.from({ length: width }, (_, i) => String(rows[hdr][i] ?? '').trim() || `Columna ${i + 1}`) : Array.from({ length: width }, (_, i) => `Columna ${i + 1}`);
    const start = hdr >= 0 ? hdr + 1 : 0;
    const prof = st().importProfiles[acc.id];
    let roles = guessRoles(headers);
    let invert = acc.type === 'credito';
    if (prof && prof.headers && prof.headers.join('|') === headers.join('|')) { roles = { ...prof.roles }; invert = prof.invert; }
    const isCard = acc.type === 'credito';
    const body = openModal(`Importar: ${file.name}`, `
      <form id="stf" novalidate>
        <p class="small">${prof && prof.headers && prof.headers.join('|') === headers.join('|') ? 'Se usó la configuración guardada para esta cuenta.' : 'Indicá qué contiene cada columna. Se recuerda para la próxima vez.'}</p>
        <div class="map-grid">${Object.entries(ROLE_LABEL).map(([k, l]) => `<label class="field"><span>${l}</span><select data-role="${k}"><option value="-1">—</option>${headers.map((h, i) => `<option value="${i}" ${roles[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>
        <label class="check"><input type="checkbox" id="st-inv" ${invert ? 'checked' : ''}>Los gastos vienen en positivo (invertir signos)</label>
        ${isCard ? `<label class="field"><span>Mes del resumen (imputación de lo que registres)</span>${periodSelect('st-period', suggestedPeriod(acc, todayISO()))}</label>` : ''}
        <div id="st-prev"></div>
        <p class="error" id="st-err"></p>
        <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary">Conciliar</button></div>
      </form>`, { wide: true });
    const read = () => {
      $$('[data-role]', body).forEach((sel) => { roles[sel.dataset.role] = Number(sel.value); });
      invert = $('#st-inv', body).checked;
      return tableRows(rows, start, roles, invert);
    };
    const refresh = () => { $('#st-prev', body).innerHTML = previewHtml(read(), accCurrency(acc)); };
    $('#stf', body).addEventListener('change', refresh);
    refresh();
    $('#stf', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const out = read();
      if (roles.date < 0) return void ($('#st-err', body).textContent = 'Indicá la columna de la fecha.');
      if (roles.amount < 0 && roles.debit < 0 && roles.credit < 0) return void ($('#st-err', body).textContent = 'Indicá la columna del importe, o las de débitos y créditos.');
      if (!out.length) return void ($('#st-err', body).textContent = 'No se encontró ningún movimiento.');
      st().importProfiles[acc.id] = { headers, roles: { ...roles }, invert };
      const x = createStatement({ acc, fileName: file.name, kind: 'tabla', rows: out, period: isCard ? $('#st-period', body).value : '' });
      closeModal(); S.reconId = x.id; S.reconDraft = {};
      if (S.view !== 'recon') go('recon');
      commit(importMsg(x));
    });
  }

  function stepPdf(acc, file, lines) {
    const p = pdfStatement(lines);
    const isCard = acc.type === 'credito';
    const accCur = accCurrency(acc);
    const hasOther = p.rows.some((r) => r.cur && r.cur !== accCur);
    const others = st().accounts.filter((a) => a.active && a.id !== acc.id && accCurrency(a) !== accCur);
    const mode = st().settings.cardImputation;
    const defPeriod = isCard ? ((mode === 'vencimiento' && p.due) ? ymOf(p.due) : (mode === 'cierre' && p.closing) ? ymOf(p.closing) : suggestedPeriod(acc, p.closing || todayISO())) : '';
    let invert = false;
    const body = openModal(`Importar: ${file.name}`, `
      <form id="spf" novalidate>
        ${p.rows.length ? '' : '<div class="warn">No se reconocieron movimientos en este PDF. Si es un resumen bancario, probá con el Excel o CSV del home banking.</div>'}
        ${p.due || p.closing ? `<p class="small">${p.closing ? `Cierre: ${esc(dateShort(p.closing))}. ` : ''}${p.due ? `Vencimiento: ${esc(dateShort(p.due))}.` : ''}</p>` : ''}
        ${isCard ? `<label class="field"><span>Mes del resumen (imputación de lo que registres)</span>${periodSelect('sp-period', defPeriod)}</label>` : ''}
        ${hasOther ? `<label class="field"><span>Cuenta para los consumos en dólares</span><select id="sp-usd"><option value="">No importarlos</option>${others.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(accCurrency(a))})</option>`).join('')}</select></label>` : ''}
        <label class="check"><input type="checkbox" id="sp-inv">Invertir signos</label>
        <div id="sp-prev"></div>
        <p class="error" id="sp-err"></p>
        <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary" ${p.rows.length ? '' : 'disabled'}>Conciliar</button></div>
      </form>`, { wide: true });
    const rowsNow = () => p.rows.map((r) => ({ ...r, amount: invert ? -r.amount : r.amount }));
    const refresh = () => { invert = $('#sp-inv', body).checked; $('#sp-prev', body).innerHTML = previewHtml(rowsNow(), accCur); };
    $('#spf', body).addEventListener('change', refresh);
    refresh();
    $('#spf', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const usdAcc = hasOther ? account($('#sp-usd', body).value) : null;
      const x = createStatement({ acc, usdAcc, fileName: file.name, kind: 'pdf', rows: rowsNow(), period: isCard ? $('#sp-period', body).value : '' });
      closeModal(); S.reconId = x.id; S.reconDraft = {};
      if (S.view !== 'recon') go('recon');
      commit(importMsg(x));
    });
  }

  // ----- Vista -----
  function stmtCounts(x) {
    const c = { match: 0, diff: 0, missing: 0, created: 0, ignored: 0, dup: 0 };
    x.rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    c.ok = c.match + c.created;
    return c;
  }
  function renderRecon() {
    const x = curStmt();
    if (x) return renderStatement(x);
    S.reconId = null;
    const list = [...st().statements].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    const items = list.map((y) => {
      const c = stmtCounts(y);
      const pend = c.missing + c.diff;
      return `<li class="clickable" data-action="open-stmt" data-id="${esc(y.id)}"><div class="grow">
        <div class="title">${esc(accName(y.accountId))}${y.period ? `<span class="badge">${esc(ymShort(y.period))}</span>` : ''}${pend ? `<span class="badge off">${pend} por revisar</span>` : '<span class="badge pay">conciliado</span>'}</div>
        <div class="sub">${esc(dateShort(y.from))} al ${esc(dateShort(y.to))}, ${y.rows.length} movimientos, ${esc(y.fileName)}</div></div>
        <div class="amt small muted">${esc(new Date(y.importedAt).toLocaleDateString('es-AR'))}</div></li>`;
    }).join('');
    return `<div class="view-head"><h1>Conciliación</h1><button class="btn primary" data-action="import-stmt">Importar resumen</button></div>
      ${items ? `<section class="panel"><ul class="list">${items}</ul></section>` : `<section class="panel empty"><h2>Compará tus registros con el banco</h2>
        <p>Importá el resumen de una cuenta o tarjeta (Excel, CSV o PDF). La app lo compara con lo que cargaste y te muestra qué coincide, qué falta registrar y qué tiene diferencias.</p>
        <button class="btn primary" data-action="import-stmt">Importar resumen</button></section>`}`;
  }

  function txLabel(t) {
    return `${dateShort(t.date)}, ${t.description || categoryText(t)}, ${money(t.amount, t.currency || BASE)}`;
  }
  function candidatesFor(x, r) {
    const used = new Set(x.rows.filter((y) => y.txId).map((y) => y.txId));
    return effectsFor(r.accountId).filter((e) => !used.has(e.t.id) && (!e.t.recon || e.t.recon === x.id) && Math.sign(e.eff) === Math.sign(r.amount)
      && Math.abs(e.eff - r.amount) / Math.abs(r.amount) <= 0.3 && daysDiff(e.t.date, r.date) <= 20)
      .sort((a, b) => Math.abs(a.eff - r.amount) - Math.abs(b.eff - r.amount)).slice(0, 6);
  }
  function rowAmount(r) {
    return `<span class="num ${r.amount < 0 ? 'neg' : 'pos'}">${r.amount < 0 ? '−' : '+'}${money(Math.abs(r.amount), r.currency)}</span>`;
  }
  function missingRow(x, r) {
    const d = draftOf(r);
    const s = st();
    const cats = d.type === 'ingreso' ? s.incomeCategories : s.expenseCategories;
    const catSel = `<select data-r="cat" aria-label="Categoría"><option value="">Categoría</option>${[...cats].filter((c) => c.active || c.id === d.categoryId).sort(byName).map((c) => `<option value="${esc(c.id)}" ${c.id === d.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
    const ec = d.type === 'egreso' ? expCat(d.categoryId) : null;
    const subs = ec ? ec.subs.filter((y) => y.active || y.id === d.subcategoryId).sort(byName) : [];
    const subSel = subs.length ? `<select data-r="sub" aria-label="Subcategoría"><option value="">Subcategoría</option>${subs.map((y) => `<option value="${esc(y.id)}" ${y.id === d.subcategoryId ? 'selected' : ''}>${esc(y.name)}</option>`).join('')}</select>` : '';
    const rowCur = r.currency;
    const otherSel = `<select data-r="other" aria-label="Otra cuenta"><option value="">${r.amount < 0 ? 'Hacia la cuenta' : 'Desde la cuenta'}</option>${s.accounts.filter((a) => a.active && a.id !== r.accountId && accCurrency(a) === rowCur).map((a) => `<option value="${esc(a.id)}" ${a.id === d.otherAccountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
    const cands = candidatesFor(x, r);
    const isCardRow = account(r.accountId)?.type === 'credito';
    return `<div class="rrow ${d.sel ? 'on' : ''}" data-row="${esc(r.id)}">
      <label class="rsel"><input type="checkbox" data-r="sel" ${d.sel ? 'checked' : ''} aria-label="Seleccionar"></label>
      <div class="rmain">
        <div class="rtop"><span class="rdate">${esc(dateShort(r.date))}</span><span class="rdesc">${esc(r.desc || 'Sin descripción')}${r.inst ? ` <span class="badge gold">cuota ${r.inst.k}/${r.inst.n}</span>` : ''}</span>${rowAmount(r)}</div>
        <div class="rctl">
          <select data-r="type" aria-label="Tipo"><option value="egreso" ${d.type === 'egreso' ? 'selected' : ''}>Egreso</option><option value="ingreso" ${d.type === 'ingreso' ? 'selected' : ''}>Ingreso</option><option value="transferencia" ${d.type === 'transferencia' ? 'selected' : ''}>Transferencia</option></select>
          ${d.type === 'transferencia' ? otherSel : catSel + subSel}
        </div>
        ${r.inst && isCardRow && d.type === 'egreso' && r.inst.k < r.inst.n ? `<label class="check small-check"><input type="checkbox" data-r="rest" ${d.rest ? 'checked' : ''}>Registrar también las cuotas ${r.inst.k + 1} a ${r.inst.n} en los meses siguientes</label>` : ''}
        ${cands.length ? `<select data-r="link" class="rlink" aria-label="Vincular"><option value="">¿Ya lo cargaste? Vinculalo con un movimiento…</option>${cands.map((e) => `<option value="${esc(e.t.id)}">${esc(txLabel(e.t))}</option>`).join('')}</select>` : ''}
      </div></div>`;
  }

  function renderStatement(x) {
    const c = stmtCounts(x);
    const byTx = (id) => st().transactions.find((t) => t.id === id);
    const missing = x.rows.filter((r) => r.status === 'missing').sort((a, b) => a.date.localeCompare(b.date));
    const diffs = x.rows.filter((r) => r.status === 'diff');
    const ok = x.rows.filter((r) => r.status === 'match' || r.status === 'created').sort((a, b) => a.date.localeCompare(b.date));
    const skipped = x.rows.filter((r) => r.status === 'ignored' || r.status === 'dup');
    const only = appOnly(x);
    const selN = missing.filter((r) => draftOf(r).sel).length;
    let balHtml = '';
    if (x.endBalance) {
      const app = balanceAt(x.accountId, x.endBalance.date);
      const dif = round2(x.endBalance.amount - app);
      balHtml = `<section class="panel"><div class="panel-head"><h2>Saldo al ${esc(dateShort(x.endBalance.date))}</h2></div>
        <div class="totals"><span>Según el resumen <strong class="num">${money(x.endBalance.amount, accCurrency(account(x.accountId)))}</strong></span>
        <span>Según la app <strong class="num">${money(app, accCurrency(account(x.accountId)))}</strong></span>
        <span>Diferencia <strong class="num ${Math.abs(dif) < 0.01 ? 'pos' : 'neg'}">${Math.abs(dif) < 0.01 ? 'ninguna' : money(dif, accCurrency(account(x.accountId)))}</strong></span></div>
        ${Math.abs(dif) >= 0.01 ? '<p class="hint" style="margin:.5rem 0 0">Si ya registraste todo lo que falta y la diferencia sigue, revisá el saldo inicial de la cuenta o movimientos anteriores a este resumen.</p>' : ''}</section>`;
    }
    const kpi = (n, l, cls) => `<div><strong class="num ${cls}">${n}</strong><span>${l}</span></div>`;
    return `<div class="view-head"><div><button class="btn ghost small" data-action="close-stmt">‹ Resúmenes</button><h1>${esc(accName(x.accountId))}</h1>
        <p class="muted small">${esc(dateShort(x.from))} al ${esc(dateShort(x.to))}${x.period ? `, imputado a ${esc(ymLabel(x.period))}` : ''}, ${esc(x.fileName)}</p></div>
        <div class="head-actions"><button class="btn" data-action="rematch">Volver a conciliar</button><button class="btn ghost" data-action="del-stmt">Eliminar</button></div></div>
      <section class="panel"><div class="recon-kpis">
        ${kpi(c.ok, 'coinciden', 'pos')}${kpi(c.diff, 'con diferencias', c.diff ? 'gold-t' : '')}${kpi(c.missing, 'no registrados', c.missing ? 'neg' : '')}${kpi(only.length, 'solo en la app', only.length ? 'gold-t' : '')}
      </div></section>
      ${balHtml}
      ${missing.length ? `<section class="panel" id="recon-missing">
        <div class="panel-head"><h2>En el resumen, no registrados</h2>
          <div class="head-actions"><button class="btn ghost small" data-action="recon-selall" data-on="${selN === missing.length ? '0' : '1'}">${selN === missing.length ? 'Quitar selección' : 'Seleccionar todos'}</button></div></div>
        <p class="hint" style="margin:0 0 .6rem">Las categorías se sugieren según lo que registraste antes con descripciones parecidas. Revisalas, tildá los que querés registrar y confirmá.</p>
        ${missing.map((r) => missingRow(x, r)).join('')}
        <p class="error" id="recon-err"></p>
        <div class="actions recon-actions"><button class="btn" data-action="recon-ignore" ${selN ? '' : 'disabled'}>Ignorar seleccionados</button><button class="btn primary" data-action="recon-register" ${selN ? '' : 'disabled'}>Registrar seleccionados (${selN})</button></div>
      </section>` : ''}
      ${diffs.length ? `<section class="panel"><div class="panel-head"><h2>Coinciden con diferencias</h2></div><ul class="list">
        ${diffs.map((r) => { const t = byTx(r.txId); return `<li><div class="grow"><div class="title">${esc(r.desc)}</div>
          <div class="sub">Resumen: ${esc(dateShort(r.date))}, ${money(Math.abs(r.amount), r.currency)}. En la app: ${esc(t ? txLabel(t) : '')}</div>
          <div class="actions" style="justify-content:flex-start;margin-top:.4rem"><button class="btn small primary" data-action="diff-accept" data-id="${esc(r.id)}">Usar el importe del resumen</button><button class="btn small" data-action="diff-reject" data-id="${esc(r.id)}">No es el mismo</button></div></div></li>`; }).join('')}
      </ul></section>` : ''}
      ${only.length ? `<section class="panel"><div class="panel-head"><h2>En la app, no en el resumen</h2></div>
        <p class="hint" style="margin:0 0 .4rem">Puede ser algo que todavía no se debitó (aparecerá en el próximo resumen), un error de carga o un movimiento registrado en otra cuenta.</p>
        <ul class="list">${only.map((e) => txRow(e.t)).join('')}</ul></section>` : ''}
      ${ok.length ? `<details class="panel"><summary class="panel-head"><h2>Coinciden (${ok.length})</h2></summary><ul class="list">
        ${ok.map((r) => { const t = byTx(r.txId); return `<li class="${t ? 'clickable' : ''}" ${t ? `data-action="edit-tx" data-id="${esc(t.id)}"` : ''}><div class="grow"><div class="title">${esc(r.desc)}${r.status === 'created' ? '<span class="badge">registrado desde el resumen</span>' : ''}</div><div class="sub">${esc(dateShort(r.date))}${t ? `, en la app: ${esc(t.description || categoryText(t))}` : ''}</div></div><div class="amt">${rowAmount(r)}</div></li>`; }).join('')}
      </ul></details>` : ''}
      ${skipped.length ? `<details class="panel"><summary class="panel-head"><h2>Ignorados (${skipped.length})</h2></summary><ul class="list">
        ${skipped.map((r) => `<li><div class="grow"><div class="title">${esc(r.desc)}</div><div class="sub">${esc(dateShort(r.date))}${r.note ? ', ' + esc(r.note) : ''}</div></div><div class="amt">${rowAmount(r)}<div><button class="btn ghost small" data-action="recon-unignore" data-id="${esc(r.id)}">Recuperar</button></div></div></li>`).join('')}
      </ul></details>` : ''}`;
  }

  function bindRecon() {
    const box = $('#recon-missing');
    if (!box) return;
    box.addEventListener('change', (e) => {
      const f = e.target.dataset.r;
      const rowEl = e.target.closest('[data-row]');
      if (!f || !rowEl) return;
      const x = curStmt();
      const r = x.rows.find((y) => y.id === rowEl.dataset.row);
      const d = draftOf(r);
      if (f === 'sel') { d.sel = e.target.checked; render(); return; }
      if (f === 'type') { d.type = e.target.value; d.categoryId = ''; d.subcategoryId = ''; d.otherAccountId = ''; }
      if (f === 'cat') { d.categoryId = e.target.value; d.subcategoryId = ''; }
      if (f === 'sub') d.subcategoryId = e.target.value;
      if (f === 'other') d.otherAccountId = e.target.value;
      if (f === 'rest') d.rest = e.target.checked;
      if (f === 'link' && e.target.value) {
        r.status = 'match'; r.txId = e.target.value;
        const t = st().transactions.find((y) => y.id === r.txId); if (t) t.recon = x.id;
        commit('Vinculado');
        return;
      }
      if (['cat', 'sub', 'other'].includes(f) && (d.categoryId || d.otherAccountId)) d.sel = true;
      render();
    });
  }
  function selectAllMissing(on) {
    const x = curStmt(); if (!x) return;
    x.rows.filter((r) => r.status === 'missing').forEach((r) => { draftOf(r).sel = on; });
    render();
  }
  function ignoreSelected() {
    const x = curStmt(); if (!x) return;
    const sel = x.rows.filter((r) => r.status === 'missing' && draftOf(r).sel);
    sel.forEach((r) => { r.status = 'ignored'; r.note = 'ignorado a mano'; delete S.reconDraft[r.id]; });
    commit(`${sel.length} ignorados`);
  }
  function registerSelected() {
    const x = curStmt(); if (!x) return;
    const s = st();
    const sel = x.rows.filter((r) => r.status === 'missing' && draftOf(r).sel);
    // Validación
    for (const r of sel) {
      const d = draftOf(r);
      const bad = d.type === 'transferencia' ? !account(d.otherAccountId)
        : !d.categoryId || (d.type === 'egreso' && expCat(d.categoryId)?.subs.some((y) => y.active) && !d.subcategoryId);
      if (bad) {
        $('#recon-err').textContent = `Falta completar “${r.desc || dateShort(r.date)}”: ${d.type === 'transferencia' ? 'la otra cuenta' : 'la categoría o subcategoría'}.`;
        $(`[data-row="${r.id}"]`)?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
        return;
      }
    }
    const now = new Date().toISOString();
    let created = 0;
    for (const r of sel) {
      const d = draftOf(r);
      const acc = account(r.accountId);
      const cur = r.currency;
      const rate = cur === BASE ? 1 : (latestRate(cur, r.date) || 1);
      const v = Math.abs(r.amount);
      const isCard = acc.type === 'credito';
      const period = isCard && x.period ? x.period : ymOf(r.date);
      const base = { date: r.date, accountId: acc.id, currency: cur, description: r.desc, createdAt: now, updatedAt: now };
      let txs = [];
      if (d.type === 'transferencia') {
        const other = account(d.otherAccountId);
        const out = r.amount < 0;
        txs.push({ ...base, id: uid(), type: 'transferencia', period: ymOf(r.date), rate: undefined,
          accountId: out ? acc.id : other.id, toAccountId: out ? other.id : acc.id, amount: v, currency: cur, toAmount: v, toCurrency: cur });
      } else {
        const sub = d.type === 'egreso' ? subOf(expCat(d.categoryId), d.subcategoryId) : null;
        const veh = sub && sub.kind && vehicle(sub.vehicleId) ? { vehicle: { vehicleId: sub.vehicleId, kind: sub.kind, km: null, ...(sub.kind === 'combustible' ? { liters: null, fullTank: true } : { works: [] }) } } : {};
        // Egreso que entra a la cuenta = reintegro (monto negativo); ingreso que sale = monto negativo
        const sgn = (d.type === 'egreso' ? r.amount < 0 : r.amount > 0) ? 1 : -1;
        const common = { ...base, type: d.type, rate, categoryId: d.categoryId, subcategoryId: d.type === 'egreso' ? (d.subcategoryId || '') : '', ...veh };
        if (r.inst && isCard && d.type === 'egreso' && d.rest && r.inst.k < r.inst.n) {
          const gid = uid();
          for (let k = r.inst.k; k <= r.inst.n; k++) {
            txs.push({ ...common, id: uid(), groupId: gid, installmentNo: k, installmentsTotal: r.inst.n, totalAmount: sgn * round2(v * r.inst.n), amount: sgn * v, period: addMonths(period, k - r.inst.k) });
          }
        } else {
          txs.push({ ...common, id: uid(), amount: sgn * v, period, ...(r.inst ? { description: `${r.desc} (cuota ${r.inst.k}/${r.inst.n})` } : {}) });
        }
      }
      txs[0].recon = x.id;
      s.transactions.push(...txs);
      r.status = 'created'; r.txId = txs[0].id;
      const k = descKey(r.desc);
      if (k) s.descMemory[k] = { type: d.type, categoryId: d.categoryId, subcategoryId: d.subcategoryId, otherAccountId: d.otherAccountId };
      delete S.reconDraft[r.id];
      created++;
    }
    commit(`${created} movimientos registrados`);
  }
  function diffAccept(rowId) {
    const x = curStmt(); const r = x && x.rows.find((y) => y.id === rowId); if (!r) return;
    const t = st().transactions.find((y) => y.id === r.txId); if (!t) return;
    const v = Math.abs(r.amount);
    if (t.type === 'transferencia') { if (ledgerId(t.toAccountId) === r.accountId) t.toAmount = v; else t.amount = v; }
    else t.amount = t.type === 'egreso' ? -r.amount : r.amount; // conserva el signo (reintegros)
    if (t.groupId) {
      const g = st().transactions.filter((y) => y.groupId === t.groupId);
      g.forEach((y) => { y.totalAmount = round2(g.reduce((a, z) => a + z.amount, 0)); });
    }
    t.updatedAt = new Date().toISOString();
    r.status = 'match'; t.recon = x.id;
    commit('Importe corregido');
  }
  function diffReject(rowId) {
    const x = curStmt(); const r = x && x.rows.find((y) => y.id === rowId); if (!r) return;
    r.rejected = [...(r.rejected || []), r.txId];
    r.status = 'missing'; r.txId = null;
    reconcile(x);
    commit('Separado: quedó como no registrado');
  }

  // ============================================================
  //  Lectura de facturas en PDF (todo ocurre en el dispositivo)
  // ============================================================
  // Para comparar reglas se ignoran mayúsculas, acentos, espacios y signos (055-123456-7 = 0551234567)
  const matchKey = (t) => normText(t).replace(/[^a-z0-9]/g, '');
  const normText = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  let pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./pdf.min.mjs').then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', location.href).href;
        return lib;
      }).catch((e) => { pdfjsPromise = null; throw e; });
    }
    return pdfjsPromise;
  }
  async function pdfToText(file, password, maxPages = 6) {
    const lib = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data, password, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
    const lines = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const yy = it.transform[5], xx = it.transform[4];
        let row = rows.find((r) => Math.abs(r.y - yy) < 3);
        if (!row) { row = { y: yy, items: [] }; rows.push(row); }
        row.items.push({ x: xx, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) lines.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join('  '));
    }
    await doc.destroy();
    return lines;
  }

  const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
  const ISSUERS = [
    { re: /\barba\b|agencia de recaudacion de la provincia de buenos aires/, name: 'ARBA', sub: [[/automotor|patente/, 'ARBA Automotor'], [/inmobiliario/, 'ARBA Inmobiliario'], [/embarcacion/, 'ARBA Embarcaciones']] },
    { re: /\bagip\b|administracion gubernamental de ingresos publicos/, name: 'AGIP', sub: [[/patente/, 'AGIP Patentes'], [/\babl\b|alumbrado|barrido|inmobiliario/, 'AGIP ABL']] },
    { re: /\barca\b|\bafip\b|agencia de recaudacion y control aduanero|administracion federal de ingresos publicos/, name: 'ARCA', sub: [[/monotributo|regimen simplificado/, 'Monotributo'], [/bienes personales/, 'Bienes Personales'], [/ganancias/, 'Ganancias'], [/autonomo/, 'Autónomos']] },
    { re: /\bedenor\b/, name: 'Edenor' }, { re: /\bedesur\b/, name: 'Edesur' }, { re: /\bedelap\b/, name: 'Edelap' }, { re: /\bedea\b/, name: 'EDEA' }, { re: /\bepec\b/, name: 'EPEC' },
    { re: /\bmetrogas\b/, name: 'Metrogas' }, { re: /\bnaturgy\b|gas natural ban/, name: 'Naturgy' }, { re: /\bcamuzzi\b/, name: 'Camuzzi' }, { re: /ecogas/, name: 'Ecogas' }, { re: /litoral gas/, name: 'Litoral Gas' },
    { re: /\baysa\b|agua y saneamientos argentinos/, name: 'AySA' }, { re: /\babsa\b|aguas bonaerenses/, name: 'ABSA' },
    { re: /telecom|fibertel|\bflow\b/, name: 'Telecom' }, { re: /\bpersonal\b.*(linea|plan|movil)/, name: 'Personal' }, { re: /movistar|telefonica/, name: 'Movistar' }, { re: /\bclaro\b|amx argentina/, name: 'Claro' },
    { re: /telecentro/, name: 'Telecentro' }, { re: /directv/, name: 'DirecTV' }, { re: /\biplan\b/, name: 'IPLAN' },
    { re: /\bosde\b/, name: 'OSDE' }, { re: /swiss medical/, name: 'Swiss Medical' }, { re: /\bgaleno\b/, name: 'Galeno' }, { re: /medicus/, name: 'Medicus' }, { re: /omint/, name: 'OMINT' },
    { re: /\bexpensas\b|consorcio de propietarios/, name: 'Expensas' },
  ];
  function parseBill(lines) {
    const text = lines.join('\n');
    const nlines = lines.map(normText);
    const ntext = nlines.join('\n');
    // Emisor
    let issuer = null;
    for (const i of ISSUERS) {
      if (i.re.test(ntext)) {
        issuer = i.name;
        if (i.sub) for (const [re, n] of i.sub) if (re.test(ntext)) { issuer = n; break; }
        break;
      }
    }
    if (!issuer) { const mm = ntext.match(/municipalidad de ([a-z ]{3,30})/); if (mm) issuer = `Municipalidad de ${cap(mm[1].trim())}`; }
    // Fechas
    const today = todayISO();
    const dates = [];
    const pushDate = (y, m, d, li, idx) => {
      y = y < 100 ? 2000 + y : y;
      if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate() || y < 2000 || y > 2100) return;
      dates.push({ iso: `${y}-${pad(m)}-${pad(d)}`, li, idx });
    };
    nlines.forEach((ln, li) => {
      for (const mt of ln.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) pushDate(Number(mt[3]), Number(mt[2]), Number(mt[1]), li, mt.index);
      for (const mt of ln.matchAll(/\b(\d{1,2})\s*(?:de\s+|[-/.]\s*)?(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?\s*(?:de\s+|[-/.]\s*)?(\d{4}|\d{2})\b/g)) pushDate(Number(mt[3]), MONTHS[mt[2]], Number(mt[1]), li, mt.index);
    });
    // Importes en formato argentino (1.234,56) o con $ y punto decimal
    const amounts = [];
    nlines.forEach((ln, li) => {
      for (const mt of ln.matchAll(/(?:\$|ars)?\s?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?!\d)/g)) {
        const v = parseAmount(mt[1]);
        if (v > 0) amounts.push({ v, li, idx: mt.index });
      }
      for (const mt of ln.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?!\d)/g)) {
        const v = Number(mt[1].replace(/,/g, ''));
        if (v > 0) amounts.push({ v, li, idx: mt.index });
      }
    });
    const ctx = (li, idx) => `${nlines[li - 1] || ''} ${nlines[li].slice(Math.max(0, idx - 70), idx + 20)}`;
    const dueRe = /venc|vto|vence|pagar hasta|abonar hasta|fecha limite|fecha de pago/;
    const secondRe = /(2|segundo|2do|2°|2º)\s*\.?\s*(venc|vto)|segundo vencimiento/;
    const firstRe = /(1|primer|1er|1°|1º)\s*\.?\s*(venc|vto)|primer vencimiento/;
    const badDateRe = /emision|emitid|periodo|lectura|desde|fecha de factura|alta|nacimiento|inicio de actividad|proximo vencimiento|prox\. vto/;
    for (const dt of dates) {
      const c = ctx(dt.li, dt.idx);
      dt.score = (dueRe.test(c) ? 3 : 0) + (firstRe.test(c) ? 1 : 0) - (badDateRe.test(c) ? 2 : 0) + (dt.iso >= addMonthsISO(today, -2) ? 0.5 : 0);
      dt.second = secondRe.test(nlines[dt.li].slice(0, dt.idx + 1)) || (secondRe.test(c) && !firstRe.test(nlines[dt.li]));
    }
    const sortedDates = [...dates].sort((a, b) => b.score - a.score || a.iso.localeCompare(b.iso));
    let first = sortedDates.find((dt) => dt.score > 0 && !dt.second) || null;
    let second = dates.filter((dt) => dt.score > 0 && (!first || dt.iso > first.iso)).sort((a, b) => (b.second - a.second) || a.iso.localeCompare(b.iso))[0] || null;
    if (first && second && !second.second && second.score < first.score - 1) second = null;
    const totalRe = /total a pagar|importe a pagar|monto a pagar|saldo a pagar|total a abonar|importe total|total factura|a pagar|total\b|importe\b|cuota\b|saldo actual/;
    const badAmtRe = /\biva\b|subtotal|percep|cargo fijo|consumo|anterior|bonific|interes|alicuota|base imponible|valuacion|tasa\b|kwh|m3/;
    for (const a of amounts) {
      const c = ctx(a.li, a.idx);
      a.score = (totalRe.test(c) ? 3 : 0) + (/total a pagar|importe a pagar|monto a pagar|a abonar/.test(c) ? 2 : 0) - (badAmtRe.test(nlines[a.li].slice(Math.max(0, a.idx - 40), a.idx)) ? 2 : 0);
    }
    const lineAmount = (dt) => {
      if (!dt) return null;
      const same = amounts.filter((a) => a.li === dt.li && a.idx > dt.idx).sort((a, b) => a.idx - b.idx)[0];
      return same ? same.v : null;
    };
    let amount = lineAmount(first);
    if (amount === null) {
      const best = [...amounts].sort((a, b) => b.score - a.score || b.v - a.v)[0];
      amount = best ? best.v : null;
    }
    const secondAmount = second ? lineAmount(second) : null;
    // Referencia (partida, cliente, dominio)
    let reference = '';
    let refKey = '';
    const refM = text.match(/(partida|n[uú]mero de cuenta|n[°ºro.]*\s*de\s*cuenta|n[uú]mero de cliente|n[°ºro.]*\s*de\s*cliente|cuenta\s*n[°ºro.]*|cliente\s*n[°ºro.]*|dominio|objeto|cuit)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/.]{2,24}[A-Z0-9])/i);
    if (refM && /\d/.test(refM[2])) { reference = `${cap(refM[1].trim())} ${refM[2]}`; refKey = refM[2]; }
    const uniq = (arr, key) => arr.filter((x, i) => arr.findIndex((y) => key(y) === key(x)) === i);
    const dateChips = uniq([...dates].sort((a, b) => b.score - a.score || a.iso.localeCompare(b.iso)), (x) => x.iso).slice(0, 8)
      .map((x) => ({ value: x.iso, label: `${dateShort(x.iso)}${x.score > 0 ? (x.second ? ' (2.º vto.)' : ' (vto.)') : ''}` }));
    const amtChips = uniq([...amounts].sort((a, b) => b.score - a.score || b.v - a.v), (x) => x.v).slice(0, 8)
      .map((x) => ({ value: String(x.v), label: `${money(x.v)}${x.score >= 3 ? ' (total)' : ''}` }));
    return {
      text, issuer, reference, refKey,
      dueDate: first ? first.iso : '', secondDueDate: second ? second.iso : '',
      amount, secondAmount,
      dates: dateChips, amounts: amtChips,
    };
  }

  function pickPdfs() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf,.pdf'; inp.multiple = true;
    inp.addEventListener('change', () => { const files = [...inp.files]; if (files.length) importQueue(files); });
    inp.click();
  }
  async function importQueue(files) {
    const file = files.shift();
    if (!file) return;
    const next = () => importQueue(files);
    toast(`Leyendo ${file.name}…`);
    let lines;
    try {
      lines = await pdfToText(file);
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        const pw = prompt(`“${file.name}” está protegido. Ingresá la contraseña del PDF:`);
        if (pw) { try { lines = await pdfToText(file, pw); } catch { toast('La contraseña del PDF no es correcta.'); return next(); } }
        else return next();
      } else {
        console.error(e);
        toast(e && /import|module|fetch/i.test(String(e)) ? 'No se pudo cargar el lector de PDF. Verificá que pdf.min.mjs esté publicado.' : `No se pudo leer ${file.name}.`);
        return next();
      }
    }
    const textLen = lines.join('').replace(/\s/g, '').length;
    if (textLen < 30) {
      toast('El PDF no tiene texto (parece escaneado). Cargá los datos a mano.');
      openDueForm(null, { title: file.name.replace(/\.pdf$/i, '') }, files.length ? next : null);
      return;
    }
    const r = parseBill(lines);
    const ktext = matchKey(r.text);
    const rule = st().importRules.find((x) => matchKey(x.match) && ktext.includes(matchKey(x.match)));
    const sugTitle = rule ? rule.title : (r.issuer || '');
    const guessCat = guessCategory(sugTitle || r.issuer || '');
    const prefill = {
      title: sugTitle, dueDate: r.dueDate, amount: r.amount, secondDueDate: r.secondDueDate, secondAmount: r.secondAmount,
      reference: r.reference,
      accountId: rule ? rule.accountId : undefined,
      categoryId: rule ? rule.categoryId : guessCat.categoryId, subcategoryId: rule ? rule.subcategoryId : guessCat.subcategoryId,
      recurrence: rule ? rule.recurrence : '',
      fileName: file.name,
      detected: { ...r, rule: rule ? rule.match : null, suggestMatch: rule ? rule.match : (r.refKey || r.issuer || '') },
    };
    openDueForm(null, prefill, files.length ? next : null);
  }
  // Sugerencia de categoría por nombre del emisor (sin regla previa)
  function guessCategory(name) {
    const n = normText(name);
    const want = [
      [/edenor|edesur|edelap|edea|epec|luz/, 'luz'], [/metrogas|naturgy|camuzzi|ecogas|litoral gas|gas/, 'gas'], [/aysa|absa|agua/, 'agua'],
      [/telecom|fibertel|telecentro|iplan|internet/, 'internet'], [/personal|movistar|claro/, 'telefon'], [/directv/, 'streaming'],
      [/osde|swiss|galeno|medicus|omint/, 'prepaga'], [/expensas/, 'expensas'],
      [/automotor|patente/, 'automotor'], [/inmobiliario|abl/, 'inmobiliario'], [/monotributo/, 'monotributo'], [/bienes personales/, 'bienes personales'], [/ganancias/, 'ganancias'],
    ].find(([re]) => re.test(n));
    if (!want) return {};
    for (const c of st().expenseCategories) {
      for (const x of c.subs) if (x.active && normText(x.name).includes(want[1])) return { categoryId: c.id, subcategoryId: x.id };
    }
    return {};
  }

  // ============================================================
  //  Análisis: evolución, presupuesto vs real, comparativas
  // ============================================================
  let charts = [];
  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }
  const cv = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function rgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function chartBase(horizontal) {
    const valueAxis = { grid: { color: cv('--line') }, border: { display: false }, ticks: { color: cv('--muted'), callback: (v) => compactFmt.format(v) } };
    const catAxis = { grid: { display: false }, border: { color: cv('--line') }, ticks: { color: cv('--muted'), autoSkip: !horizontal } };
    return {
      responsive: true, maintainAspectRatio: false, animation: reduceMotion() ? false : { duration: 350 },
      indexAxis: horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: cv('--muted'), boxWidth: 12, boxHeight: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(horizontal ? ctx.parsed.x : ctx.parsed.y)}` } },
      },
      scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    };
  }
  function makeChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    charts.push(new window.Chart(canvas, config));
  }
  const chartBox = (id, h) => `<div class="chart-box" style="height:${h}px"><canvas id="${id}"></canvas></div>`;

  function renderAnalysis() {
    const tabs = [['evolucion', 'Evolución'], ['desvio', 'Presupuesto vs real'], ['comparar', 'Comparar períodos'], ['categoria', 'Por categoría']];
    const tabsHtml = `<div class="seg tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-action="an-tab" data-tab="${k}" aria-pressed="${S.an.tab === k}">${l}</button>`).join('')}</div>`;
    const fn = { evolucion: anEvolution, desvio: anDeviation, comparar: anCompare, categoria: anCategory }[S.an.tab] || anEvolution;
    const out = fn();
    return `<div class="view-head"><h1>Análisis</h1>${out.head || ''}</div>${tabsHtml}${window.Chart ? '' : '<div class="warn">No se pudo cargar el módulo de gráficos (chart.umd.js). Verificá que el archivo esté publicado junto con la app.</div>'}${out.html}`;
  }
  let pendingCharts = [];
  function bindAnalysis() {
    pendingCharts.forEach(([id, cfg]) => makeChart(id, cfg));
    pendingCharts = [];
    const r = $('#an-range'); if (r) r.addEventListener('change', (e) => { S.an.range = Number(e.target.value); render(); });
    const k = $('#an-key'); if (k) k.addEventListener('change', (e) => { S.an.key = e.target.value; render(); });
    const cr = $('#an-crange'); if (cr) cr.addEventListener('change', (e) => { S.an.catRange = Number(e.target.value); render(); });
    const av = $('#an-avg'); if (av) av.addEventListener('change', (e) => { S.an.avg = e.target.checked; render(); });
    const pf = $('#pj-from'); if (pf) pf.addEventListener('change', (e) => { S.an.proj.from = e.target.value; render(); });
    const pt = $('#pj-to'); if (pt) pt.addEventListener('change', (e) => { S.an.proj.to = e.target.value; render(); });
    $$('[data-pp] select').forEach((sel) => sel.addEventListener('change', () => {
      const which = sel.closest('[data-pp]').dataset.pp;
      const p = S.an.cmp[which];
      const f = sel.dataset.f;
      if (f === 'type') {
        const [a] = periodRange(p);
        S.an.cmp[which] = makePeriod(sel.value, a);
      } else p[f] = f === 'year' || f === 'q' ? Number(sel.value) : sel.value;
      render();
    }));
  }

  // ----- Proyección: presupuesto hacia adelante y cerrados contra lo real -----
  const short0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const moneyS = (n) => `${n < 0 ? '−' : ''}$ ${short0.format(Math.abs(Math.round(n)))}`;
  function projPreset(k) {
    const cur = ymOf(todayISO()), y = cur.slice(0, 4);
    const P = S.an.proj;
    if (k === 'next12') { P.from = cur; P.to = addMonths(cur, 11); }
    if (k === 'year') { P.from = `${y}-01`; P.to = `${y}-12`; }
    if (k === 'nextyear') { P.from = `${Number(y) + 1}-01`; P.to = `${Number(y) + 1}-12`; }
    if (k === 'around') { P.from = addMonths(cur, -6); P.to = addMonths(cur, 5); }
  }
  function renderProjection() {
    const out = anProjection();
    return `<div class="view-head"><h1>Proyección</h1></div>${window.Chart ? '' : '<div class="warn">No se pudo cargar el módulo de gráficos (chart.umd.js).</div>'}${out.html}`;
  }
  // Cuentas que forman el efectivo disponible de la proyección
  const projAccounts = () => st().accounts.filter((a) => a.inProjection && !linkedTarget(a));
  function availableAt(date) {
    return projAccounts().reduce((sum, a) => {
      const cur = accCurrency(a);
      const r = cur === BASE ? 1 : (latestRate(cur, date) || 0);
      return sum + balanceAt(a.id, date) * r;
    }, 0);
  }
  function anProjection() {
    const cur = ymOf(todayISO());
    if (!S.an.proj) S.an.proj = { from: cur, to: addMonths(cur, 11), mode: 'mix', open: {} };
    const P = S.an.proj;
    let from = P.from, to = P.to;
    if (to < from) [from, to] = [to, from];
    if (monthsBetween(from, to).length > 60) to = addMonths(from, 59);
    const months = monthsBetween(from, to);
    let accB = 0, accP = 0, accRc = 0, accBc = 0;
    const rows = months.map((m) => {
      const B = budgetAgg(m), A = actualAgg(m);
      const stt = m < cur ? 'cerrado' : m === cur ? 'curso' : 'futuro';
      const r = { m, stt, B, A, bi: round2(B.incT), be: round2(B.expT), ri: round2(A.incT), re: round2(A.expT) };
      r.bs = round2(r.bi - r.be); r.rs = round2(r.ri - r.re);
      accB += r.bs; r.accB = accB;
      accP += stt === 'cerrado' ? r.rs : r.bs; r.accP = accP;
      if (stt === 'cerrado') { accRc += r.rs; accBc += r.bs; }
      return r;
    });
    const closed = rows.filter((r) => r.stt === 'cerrado');
    const totBI = rows.reduce((a, r) => a + r.bi, 0), totBE = rows.reduce((a, r) => a + r.be, 0);
    const noBudget = !rows.some((r) => r.bi || r.be);
    const mix = P.mode === 'mix';
    const src = (r) => (mix && r.stt === 'cerrado' ? r.A : r.B);

    // Gráfico: ahorro mensual y acumulado
    pendingCharts.push(['ch-proj', {
      type: 'bar',
      data: { labels: months.map(ymShort), datasets: [
        { type: 'bar', label: 'Ahorro presupuestado', data: rows.map((r) => r.bs), backgroundColor: rows.map((r) => rgba(cv('--gold'), r.stt === 'futuro' ? 0.45 : 0.7)), borderRadius: 4, order: 3 },
        { type: 'bar', label: 'Ahorro real', data: rows.map((r) => (r.stt === 'futuro' ? null : r.rs)), backgroundColor: rows.map((r) => rgba(r.rs < 0 ? cv('--out') : cv('--in'), 0.8)), borderRadius: 4, order: 2 },
        { type: 'line', label: 'Acumulado presupuestado', data: rows.map((r) => r.accB), borderColor: cv('--gold'), borderDash: [6, 4], pointRadius: 0, tension: 0.2, order: 1 },
        { type: 'line', label: 'Acumulado real y proyectado', data: rows.map((r) => r.accP), borderColor: cv('--ink'), backgroundColor: cv('--ink'), pointRadius: rows.map((r) => (r.stt === 'cerrado' ? 3 : 0)), tension: 0.2, order: 0,
          segment: { borderDash: (c) => (rows[c.p1DataIndex] && rows[c.p1DataIndex].stt !== 'cerrado' ? [3, 3] : undefined) } },
      ] },
      options: chartBase(false),
    }]);

    // Saldo disponible: saldo real al inicio del primer mes; después, saldo final = inicial + ingresos − egresos
    const pAccs = projAccounts();
    const ini = [], fin = [];
    if (pAccs.length) {
      let start;
      if (from <= cur) start = availableAt(addDaysISO(`${from}-01`, -1));
      else {
        start = availableAt(addDaysISO(`${cur}-01`, -1));
        for (const m of monthsBetween(cur, addMonths(from, -1))) { const B = budgetAgg(m); start += B.incT - B.expT; }
      }
      rows.forEach((r, i) => {
        ini[i] = round2(i ? fin[i - 1] : start);
        fin[i] = round2(ini[i] + src(r).incT - src(r).expT);
      });
    }
    const kpi = (l, v, cls = '', sub = '') => `<div><span>${l}</span><strong class="num ${cls}">${v}</strong>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`;
    const desvC = round2(accRc - accBc);
    const kpis = `<div class="kpis proj-kpis">
      ${kpi('Ingresos presupuestados', moneyS(totBI), 'pos')}
      ${kpi('Egresos presupuestados', moneyS(totBE), 'neg')}
      ${kpi('Ahorro presupuestado', moneyS(totBI - totBE), totBI - totBE < 0 ? 'neg' : '', 'en todo el período')}
      ${kpi('Ahorro proyectado', moneyS(accP), accP < 0 ? 'neg' : '', closed.length ? 'real en meses cerrados + presupuesto en el resto' : 'según presupuesto')}
      ${closed.length ? kpi('Meses cerrados: real vs presupuesto', `${desvC >= 0 ? '+' : ''}${moneyS(desvC)}`, desvC < 0 ? 'neg' : 'pos', `ahorraste ${moneyS(accRc)} contra ${moneyS(accBc)} previstos`) : ''}
      ${pAccs.length ? kpi(`Disponible al cierre de ${ymLabel(to)}`, moneyS(fin[fin.length - 1]), fin[fin.length - 1] < 0 ? 'neg' : '', `partiendo de ${moneyS(ini[0])} al inicio de ${ymLabel(from)}`) : ''}
    </div>`;

    // Tabla mensual
    const tag = (st0) => ({ cerrado: '<span class="badge">cerrado</span>', curso: '<span class="badge gold">en curso</span>', futuro: '<span class="badge pay">futuro</span>' }[st0]);
    const mrow = rows.map((r) => {
      const real = r.stt !== 'futuro';
      const d = round2(r.rs - r.bs);
      return `<tr class="st-${r.stt}"><td>${esc(ymTitle(r.m))} ${tag(r.stt)}</td>
        <td class="r num">${moneyS(r.bi)}</td><td class="r num">${moneyS(r.be)}</td><td class="r num ${r.bs < 0 ? 'neg' : ''}">${moneyS(r.bs)}</td><td class="r num muted">${moneyS(r.accB)}</td>
        <td class="r num">${real ? moneyS(r.ri) : '—'}</td><td class="r num">${real ? moneyS(r.re) : (r.re ? `<span class="muted" title="Cuotas y gastos ya cargados para ese mes">${moneyS(r.re)} comprometido</span>` : '—')}</td>
        <td class="r num ${real ? (r.rs < 0 ? 'neg' : 'pos') : ''}">${real ? moneyS(r.rs) : '—'}</td>
        <td class="r num ${r.stt === 'cerrado' ? (d < 0 ? 'neg' : 'pos') : ''}">${r.stt === 'cerrado' ? `${d >= 0 ? '+' : ''}${moneyS(d)}` : '—'}</td>
        <td class="r num strong">${moneyS(r.accP)}</td></tr>`;
    }).join('');
    const monthly = `<div class="scroll-x"><table class="simple proj-table"><thead>
      <tr><th></th><th class="r grp" colspan="4">Presupuestado</th><th class="r grp" colspan="4">Real</th><th class="r">Proyección</th></tr>
      <tr><th>Mes</th><th class="r">Ingresos</th><th class="r">Egresos</th><th class="r">Ahorro</th><th class="r">Acumulado</th><th class="r">Ingresos</th><th class="r">Egresos</th><th class="r">Ahorro</th><th class="r">Desvío</th><th class="r">Ahorro acumulado</th></tr></thead>
      <tbody>${mrow}</tbody></table></div>
      <p class="hint" style="margin:.6rem 0 0">El ahorro acumulado proyectado usa lo real en los meses cerrados y lo presupuestado en el mes en curso y los futuros. En los meses futuros, “comprometido” son las cuotas y gastos que ya están cargados para ese mes.</p>`;

    // Matriz por categoría y subcategoría
    const mcols = rows.map((r) => `<th class="r ${mix && r.stt === 'cerrado' ? 'real-col' : ''}">${esc(ymShort(r.m))}${mix && r.stt === 'cerrado' ? '<br><small>real</small>' : ''}</th>`).join('');
    const line = (label, vals, cls = '', action = '') => {
      const tot = vals.reduce((a, v) => a + v, 0);
      if (!tot && !vals.some((v) => v)) return '';
      return `<tr class="${cls}" ${action}><td class="stick">${label}</td>${vals.map((v, i) => `<td class="r num ${mix && rows[i].stt === 'cerrado' ? 'real-col' : ''}">${v ? moneyS(v) : '<span class="muted">–</span>'}</td>`).join('')}<td class="r num strong">${moneyS(tot)}</td><td class="r num muted">${moneyS(tot / rows.length)}</td></tr>`;
    };
    const expIds = [...new Set(rows.flatMap((r) => Object.keys(src(r).exp)))]
      .map((id) => ({ id, name: expCat(id)?.name || 'Sin categoría', tot: rows.reduce((a, r) => a + (src(r).exp[id]?.total || 0), 0) }))
      .sort(byOrderObj('e'));
    let expHtml = '';
    for (const c of expIds) {
      const cat = expCat(c.id);
      const subIds = [...new Set(rows.flatMap((r) => Object.keys(src(r).exp[c.id]?.subs || {})))];
      const canOpen = subIds.length > 1 || (subIds[0] && subIds[0] !== '');
      const open = !!P.open[c.id];
      expHtml += line(`${canOpen ? `<span class="tog">${open ? '▾' : '▸'}</span>` : ''}${esc(c.name)}`, rows.map((r) => round2(src(r).exp[c.id]?.total || 0)), `cat-row ${canOpen ? 'clickable' : ''}`, canOpen ? `data-action="proj-toggle" data-id="${esc(c.id)}"` : '');
      if (open && canOpen) {
        subIds.map((sid) => ({ sid, name: sid ? (subOf(cat, sid)?.name || 'Subcategoría eliminada') : 'Sin subcategoría' })).sort((x, y) => subOrderOf(c.id)(x.sid, y.sid))
          .forEach(({ sid, name }) => { expHtml += line(esc(name), rows.map((r) => round2(src(r).exp[c.id]?.subs[sid] || 0)), 'sub-row'); });
      }
    }
    const incIds = [...new Set(rows.flatMap((r) => Object.keys(src(r).inc)))]
      .map((id) => ({ id, name: incCat(id)?.name || 'Sin categoría', tot: rows.reduce((a, r) => a + (src(r).inc[id] || 0), 0) })).sort(byOrderObj('i'));
    const incHtml = incIds.map((c) => line(esc(c.name), rows.map((r) => round2(src(r).inc[c.id] || 0)), 'cat-row')).join('');
    const totE = rows.map((r) => round2(src(r).expT)), totI = rows.map((r) => round2(src(r).incT));
    const balRow = (label, vals, endVal, cls) => `<tr class="${cls}"><td class="stick">${label}</td>${vals.map((v, i) => `<td class="r num ${v < 0 ? 'neg' : ''} ${mix && rows[i].stt === 'cerrado' ? 'real-col' : ''}">${moneyS(v)}</td>`).join('')}<td class="r num strong">${moneyS(endVal)}</td><td></td></tr>`;
    const matrix = `<div class="scroll-x"><table class="simple matrix"><thead><tr><th class="stick"></th>${mcols}<th class="r">Total</th><th class="r">Promedio</th></tr></thead><tbody>
      ${pAccs.length ? balRow('<strong>Saldo inicial disponible</strong>', ini, ini[0], 'bal-row') : ''}
      <tr class="sec-row"><td class="stick" colspan="${rows.length + 3}">Ingresos</td></tr>
      ${incHtml}${line('<strong>Total ingresos</strong>', totI, 'tot-row')}
      <tr class="sec-row"><td class="stick" colspan="${rows.length + 3}">Egresos</td></tr>
      ${expHtml}${line('<strong>Total egresos</strong>', totE, 'tot-row')}
      ${line('<strong>Ahorro</strong>', rows.map((_, i) => round2(totI[i] - totE[i])), 'tot-row save-row')}
      ${pAccs.length ? balRow('<strong>Saldo final disponible</strong>', fin, fin[fin.length - 1], 'bal-row bal-end') : ''}
      </tbody></table></div>
      <p class="hint" style="margin:.6rem 0 0">${pAccs.length ? `Saldo disponible: ${esc(pAccs.map((a) => a.name).join(', '))}. El saldo inicial del primer mes es el real; desde ahí, el saldo final de cada mes (inicial + ingresos − egresos) pasa a ser el inicial del siguiente.` : 'Para ver el saldo disponible mes a mes, marcá en Cuentas cuáles se incluyen en el saldo inicial de la proyección.'}</p>`;

    const cur0 = ymOf(todayISO());
    const mOpts = (sel) => { const o = []; for (let i = -60; i <= 36; i++) o.push(addMonths(cur0, i)); return o.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${esc(ymTitle(m))}</option>`).join(''); };
    return {
      head: '',
      html: `<section class="panel">
          <div class="pp-row proj-range">
            <label class="field"><span>Desde</span><select id="pj-from">${mOpts(from)}</select></label>
            <label class="field"><span>Hasta</span><select id="pj-to">${mOpts(to)}</select></label>
          </div>
          <div class="pp-presets"><span class="muted small">Atajos:</span>
            <button class="chip" data-action="proj-preset" data-preset="next12">Próximos 12 meses</button>
            <button class="chip" data-action="proj-preset" data-preset="year">Este año</button>
            <button class="chip" data-action="proj-preset" data-preset="nextyear">Año próximo</button>
            <button class="chip" data-action="proj-preset" data-preset="around">6 meses atrás y 6 adelante</button></div>
        </section>
        ${noBudget ? '<div class="warn">No hay presupuesto cargado para estos meses. Cargalo en la sección Presupuesto para ver la proyección.</div>' : ''}
        <section class="panel">${kpis}${chartBox('ch-proj', 300)}</section>
        <section class="panel"><div class="panel-head"><h2>Mes a mes</h2></div>${monthly}</section>
        <section class="panel"><div class="panel-head"><h2>Por categoría</h2>
            <div class="seg compact" role="group"><button type="button" data-action="proj-mode" data-mode="pres" aria-pressed="${!mix}">Solo presupuesto</button><button type="button" data-action="proj-mode" data-mode="mix" aria-pressed="${mix}">Real en meses cerrados</button></div></div>
          <p class="hint" style="margin:0 0 .6rem">Tocá una categoría para ver sus subcategorías.${mix ? ' Las columnas sombreadas muestran lo real de los meses cerrados.' : ''}</p>
          ${matrix}</section>`,
    };
  }

  // ----- Evolución -----
  function anEvolution() {
    const n = S.an.range;
    const months = monthsBetween(addMonths(S.month, -(n - 1)), S.month);
    const rows = months.map((m) => {
      const a = actualAgg(m), b = budgetAgg(m);
      return { m, inc: round2(a.incT), exp: round2(a.expT), res: round2(a.incT - a.expT), bexp: round2(b.expT) };
    });
    const tot = rows.reduce((t, r) => ({ inc: t.inc + r.inc, exp: t.exp + r.exp, bexp: t.bexp + r.bexp }), { inc: 0, exp: 0, bexp: 0 });
    const hasBudget = rows.some((r) => r.bexp > 0);
    const active = rows.filter((r) => r.inc || r.exp).length || 1;
    pendingCharts.push(['ch-evo', {
      type: 'bar',
      data: {
        labels: rows.map((r) => ymShort(r.m)),
        datasets: [
          { type: 'bar', label: 'Ingresos', data: rows.map((r) => r.inc), backgroundColor: rgba(cv('--in'), 0.75), borderRadius: 4, order: 2 },
          { type: 'bar', label: 'Egresos', data: rows.map((r) => r.exp), backgroundColor: rgba(cv('--out'), 0.75), borderRadius: 4, order: 2 },
          { type: 'line', label: 'Resultado', data: rows.map((r) => r.res), borderColor: cv('--ink'), backgroundColor: cv('--ink'), tension: 0.3, pointRadius: 3, order: 1 },
          ...(hasBudget ? [{ type: 'line', label: 'Presupuesto de egresos', data: rows.map((r) => r.bexp || null), borderColor: cv('--gold'), borderDash: [6, 4], pointRadius: 0, spanGaps: true, order: 0 }] : []),
        ],
      },
      options: chartBase(false),
    }]);
    const pctSave = (r) => (r.inc > 0 ? `${pctFmt.format((r.res / r.inc) * 100)}%` : '—');
    const table = `<div class="scroll-x"><table class="simple"><thead><tr><th>Mes</th><th class="r">Ingresos</th><th class="r">Egresos</th><th class="r">Resultado</th><th class="r">Ahorro</th>${hasBudget ? '<th class="r">Presup. egresos</th><th class="r">Desvío</th>' : ''}</tr></thead><tbody>
      ${[...rows].reverse().map((r) => `<tr><td>${esc(ymTitle(r.m))}</td><td class="r num">${money(r.inc)}</td><td class="r num">${money(r.exp)}</td>
        <td class="r num ${r.res < 0 ? 'neg' : 'pos'}">${money(r.res)}</td><td class="r num">${pctSave(r)}</td>
        ${hasBudget ? `<td class="r num">${r.bexp ? money(r.bexp) : '—'}</td><td class="r num ${r.bexp && r.exp > r.bexp ? 'neg' : 'pos'}">${r.bexp ? money(round2(r.bexp - r.exp)) : '—'}</td>` : ''}</tr>`).join('')}
      </tbody><tfoot>
        <tr><th>Total</th><th class="r num">${money(round2(tot.inc))}</th><th class="r num">${money(round2(tot.exp))}</th><th class="r num">${money(round2(tot.inc - tot.exp))}</th><th class="r num">${tot.inc > 0 ? pctFmt.format(((tot.inc - tot.exp) / tot.inc) * 100) + '%' : '—'}</th>${hasBudget ? `<th class="r num">${money(round2(tot.bexp))}</th><th class="r num">${money(round2(tot.bexp - tot.exp))}</th>` : ''}</tr>
        <tr><th>Promedio mensual</th><th class="r num">${money(round2(tot.inc / active))}</th><th class="r num">${money(round2(tot.exp / active))}</th><th class="r num">${money(round2((tot.inc - tot.exp) / active))}</th><th></th>${hasBudget ? '<th></th><th></th>' : ''}</tr>
      </tfoot></table></div>
      <p class="hint" style="margin:.6rem 0 0">El promedio considera los ${active} meses con movimientos. En el desvío, positivo es lo que quedó sin gastar.</p>`;
    return {
      head: `<div class="head-actions">${monthNav()}<select id="an-range" aria-label="Rango">${[6, 12, 24, 36].map((x) => `<option value="${x}" ${x === n ? 'selected' : ''}>Últimos ${x} meses</option>`).join('')}</select></div>`,
      html: `<section class="panel"><div class="panel-head"><h2>Ingresos, egresos y resultado</h2><span class="muted small">hasta ${esc(ymLabel(S.month))}</span></div>${chartBox('ch-evo', 320)}</section>
        <section class="panel">${table}</section>`,
    };
  }

  // ----- Presupuesto vs real -----
  function anDeviation() {
    const mode = S.an.desv;
    const from = mode === 'anio' ? `${S.month.slice(0, 4)}-01` : S.month;
    const b = budgetAgg(from, S.month), a = actualAgg(from, S.month);
    const ids = [...new Set([...Object.keys(b.exp), ...Object.keys(a.exp)])].sort(orderOf('e'));
    const names = ids.map((id) => expCat(id)?.name || 'Sin categoría');
    const bv = ids.map((id) => round2(b.exp[id]?.total || 0)), av = ids.map((id) => round2(a.exp[id]?.total || 0));
    if (ids.length) {
      pendingCharts.push(['ch-desv', {
        type: 'bar',
        data: { labels: names, datasets: [
          { label: 'Presupuesto', data: bv, backgroundColor: rgba(cv('--gold'), 0.55), borderRadius: 3 },
          { label: 'Real', data: av, backgroundColor: av.map((v, i) => rgba(v > bv[i] ? cv('--out') : cv('--in'), 0.8)), borderRadius: 3 },
        ] },
        options: chartBase(true),
      }]);
    }
    // Desvío mensual de los últimos 12 meses
    const months = monthsBetween(addMonths(S.month, -11), S.month);
    const dev = months.map((m) => { const bb = budgetAgg(m).expT; return bb > 0 ? round2(bb - actualAgg(m).expT) : null; });
    if (dev.some((x) => x !== null)) {
      const base = chartBase(false);
      base.plugins.legend.display = false;
      base.plugins.tooltip.callbacks.label = (ctx) => (ctx.parsed.y >= 0 ? `Quedó sin gastar ${money(ctx.parsed.y)}` : `Excedido en ${money(-ctx.parsed.y)}`);
      pendingCharts.push(['ch-devm', {
        type: 'bar',
        data: { labels: months.map(ymShort), datasets: [{ label: 'Desvío', data: dev, backgroundColor: dev.map((v) => rgba(v !== null && v < 0 ? cv('--out') : cv('--in'), 0.8)), borderRadius: 4 }] },
        options: base,
      }]);
    }
    const rows = ids.map((id, i) => {
      const d = round2(bv[i] - av[i]);
      return `<tr><td>${esc(names[i])}</td><td class="r num">${money(bv[i])}</td><td class="r num">${money(av[i])}</td>
        <td class="r num ${d < 0 ? 'neg' : 'pos'}">${money(d)}</td><td class="r num">${bv[i] > 0 ? pctFmt.format((av[i] / bv[i]) * 100) + '%' : '—'}</td></tr>`;
    }).join('');
    const label = mode === 'anio' ? `Enero a ${ymLabel(S.month)}` : ymTitle(S.month);
    const td = round2(b.expT - a.expT);
    return {
      head: `<div class="head-actions">${monthNav()}<div class="seg compact" role="group"><button type="button" data-action="an-desv" data-mode="mes" aria-pressed="${mode === 'mes'}">Mes</button><button type="button" data-action="an-desv" data-mode="anio" aria-pressed="${mode === 'anio'}">Acumulado del año</button></div></div>`,
      html: `<section class="panel"><div class="panel-head"><h2>Egresos por categoría</h2><span class="muted small">${esc(label)}</span></div>
          ${ids.length ? chartBox('ch-desv', Math.max(180, 60 + ids.length * 40)) : '<p class="muted">Sin presupuesto ni egresos en este período.</p>'}</section>
          <section class="panel"><div class="panel-head"><h2>Detalle</h2></div>
            <div class="scroll-x"><table class="simple"><thead><tr><th>Categoría</th><th class="r">Presupuesto</th><th class="r">Real</th><th class="r">Desvío</th><th class="r">Ejecutado</th></tr></thead>
            <tbody>${rows}</tbody><tfoot><tr><th>Total</th><th class="r num">${money(round2(b.expT))}</th><th class="r num">${money(round2(a.expT))}</th><th class="r num ${td < 0 ? 'neg' : 'pos'}">${money(td)}</th><th class="r num">${b.expT > 0 ? pctFmt.format((a.expT / b.expT) * 100) + '%' : '—'}</th></tr></tfoot></table></div>
            <p class="hint" style="margin:.6rem 0 0">Desvío positivo: lo que quedó sin gastar. Negativo: cuánto te pasaste.</p></section>
          <section class="panel"><div class="panel-head"><h2>Desvío mes a mes</h2><span class="muted small">últimos 12 meses</span></div>
            ${dev.some((x) => x !== null) ? chartBox('ch-devm', 260) : '<p class="muted">Aparece cuando haya meses con presupuesto.</p>'}</section>`,
    };
  }

  // ----- Comparar períodos -----
  function makePeriod(type, ym) {
    const year = Number(ym.slice(0, 4)), month = Number(ym.slice(5, 7));
    if (type === 'mes') return { type, ym };
    if (type === 'trimestre') return { type, year, q: Math.ceil(month / 3) };
    if (type === 'anio') return { type, year };
    return { type: 'rango', from: addMonths(ym, -2), to: ym };
  }
  function periodRange(p) {
    if (p.type === 'mes') return [p.ym, p.ym];
    if (p.type === 'trimestre') { const m0 = (p.q - 1) * 3 + 1; return [`${p.year}-${pad(m0)}`, `${p.year}-${pad(m0 + 2)}`]; }
    if (p.type === 'anio') return [`${p.year}-01`, `${p.year}-12`];
    return p.from <= p.to ? [p.from, p.to] : [p.to, p.from];
  }
  function periodLabel(p) {
    const [a, b] = periodRange(p);
    if (p.type === 'mes') return ymTitle(a);
    if (p.type === 'trimestre') return `${p.q}.º trimestre ${p.year}`;
    if (p.type === 'anio') return `Año ${p.year}`;
    return `${cap(ymShort(a))} a ${ymShort(b)}`;
  }
  function periodMonthsCount(p) {
    const [a, b] = periodRange(p);
    const cur = ymOf(todayISO());
    const withData = new Set(st().transactions.filter((t) => t.type !== 'transferencia' && t.period >= a && t.period <= b && t.period <= cur).map((t) => t.period));
    return withData.size || 1; // solo meses con movimientos: un año en curso o recién empezado no se diluye
  }
  function cmpPreset(kind) {
    const m = S.month;
    if (kind === 'prev') S.an.cmp = { a: makePeriod('mes', m), b: makePeriod('mes', addMonths(m, -1)) };
    if (kind === 'yoy') S.an.cmp = { a: makePeriod('mes', m), b: makePeriod('mes', addMonths(m, -12)) };
    if (kind === 'year') S.an.cmp = { a: makePeriod('anio', m), b: makePeriod('anio', addMonths(m, -12)) };
    if (kind === 'q') S.an.cmp = { a: makePeriod('trimestre', m), b: makePeriod('trimestre', addMonths(m, -3)) };
  }
  function periodPicker(which, p) {
    const cur = ymOf(todayISO());
    const months = []; for (let i = 12; i >= -60; i--) months.push(addMonths(cur, i));
    const y0 = Math.min(Number(cur.slice(0, 4)) - 5, ...st().transactions.map((t) => Number(t.period.slice(0, 4))));
    const years = []; for (let y = Number(cur.slice(0, 4)) + 1; y >= y0; y--) years.push(y);
    const mSel = (f, v) => `<select data-f="${f}" aria-label="Mes">${months.map((m) => `<option value="${m}" ${m === v ? 'selected' : ''}>${esc(ymTitle(m))}</option>`).join('')}</select>`;
    const ySel = (v) => `<select data-f="year" aria-label="Año">${years.map((y) => `<option value="${y}" ${y === v ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
    let ctl = '';
    if (p.type === 'mes') ctl = mSel('ym', p.ym);
    else if (p.type === 'trimestre') ctl = `<select data-f="q" aria-label="Trimestre">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${q === p.q ? 'selected' : ''}>${q}.º trimestre</option>`).join('')}</select>${ySel(p.year)}`;
    else if (p.type === 'anio') ctl = ySel(p.year);
    else ctl = `${mSel('from', p.from)}${mSel('to', p.to)}`;
    return `<div class="pp" data-pp="${which}"><span class="pp-tag">${which === 'a' ? 'Período A' : 'Período B'}</span>
      <select data-f="type" aria-label="Tipo de período">${[['mes', 'Mes'], ['trimestre', 'Trimestre'], ['anio', 'Año'], ['rango', 'Rango de meses']].map(([k, l]) => `<option value="${k}" ${k === p.type ? 'selected' : ''}>${l}</option>`).join('')}</select>${ctl}</div>`;
  }
  function varCell(a, b, goodIfUp) {
    const d = round2(a - b);
    const good = goodIfUp ? d >= 0 : d <= 0;
    const pct = b !== 0 ? `${d > 0 ? '+' : ''}${pctFmt.format((d / Math.abs(b)) * 100)}%` : (a ? 'nuevo' : '—');
    return `<td class="r num ${d === 0 ? '' : good ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${money(d)}</td><td class="r num muted">${pct}</td>`;
  }
  function anCompare() {
    if (!S.an.cmp) cmpPreset('prev');
    const { a: pa, b: pb } = S.an.cmp;
    const [a1, a2] = periodRange(pa), [b1, b2] = periodRange(pb);
    const A = actualAgg(a1, a2), B = actualAgg(b1, b2);
    const fa = S.an.avg ? 1 / periodMonthsCount(pa) : 1, fb = S.an.avg ? 1 / periodMonthsCount(pb) : 1;
    const la = periodLabel(pa), lb = periodLabel(pb);
    const ids = [...new Set([...Object.keys(A.exp), ...Object.keys(B.exp)])].sort(orderOf('e'));
    const top = ids;
    if (top.length) {
      pendingCharts.push(['ch-cmp', {
        type: 'bar',
        data: { labels: top.map((id) => expCat(id)?.name || 'Sin categoría'), datasets: [
          { label: la, data: top.map((id) => round2((A.exp[id]?.total || 0) * fa)), backgroundColor: rgba(cv('--ink'), 0.8), borderRadius: 3 },
          { label: lb, data: top.map((id) => round2((B.exp[id]?.total || 0) * fb)), backgroundColor: rgba(cv('--gold'), 0.7), borderRadius: 3 },
        ] },
        options: chartBase(true),
      }]);
    }
    const head = `<thead><tr><th></th><th class="r">${esc(la)}</th><th class="r">${esc(lb)}</th><th class="r">Diferencia</th><th class="r">%</th></tr></thead>`;
    const line = (name, va, vb, goodUp, cls = '') => `<tr class="${cls}"><td>${esc(name)}</td><td class="r num">${money(round2(va))}</td><td class="r num">${money(round2(vb))}</td>${varCell(va, vb, goodUp)}</tr>`;
    const summary = `<table class="simple">${head}<tbody>
      ${line('Ingresos', A.incT * fa, B.incT * fb, true)}
      ${line('Egresos', A.expT * fa, B.expT * fb, false)}
      ${line('Resultado', (A.incT - A.expT) * fa, (B.incT - B.expT) * fb, true, 'strong-row')}</tbody></table>`;
    const expRows = ids.map((id) => {
      const c = expCat(id);
      const subIds = [...new Set([...Object.keys(A.exp[id]?.subs || {}), ...Object.keys(B.exp[id]?.subs || {})])]
        .map((sid) => ({ sid, name: sid ? (subOf(c, sid)?.name || 'Subcategoría eliminada') : 'Sin subcategoría' })).sort((x, y) => subOrderOf(id)(x.sid, y.sid));
      let html = line(c?.name || 'Sin categoría', (A.exp[id]?.total || 0) * fa, (B.exp[id]?.total || 0) * fb, false, 'cat-row');
      if (subIds.length > 1 || (subIds[0] && subIds[0].sid)) {
        html += subIds.map(({ sid, name }) => line(name, (A.exp[id]?.subs[sid] || 0) * fa, (B.exp[id]?.subs[sid] || 0) * fb, false, 'sub-row')).join('');
      }
      return html;
    }).join('');
    const incIds = [...new Set([...Object.keys(A.inc), ...Object.keys(B.inc)])].sort(orderOf('i'));
    const incRows = incIds.map((id) => line(incCat(id)?.name || 'Sin categoría', (A.inc[id] || 0) * fa, (B.inc[id] || 0) * fb, true)).join('');
    const nA = periodMonthsCount(pa), nB = periodMonthsCount(pb);
    return {
      head: '',
      html: `<section class="panel">
          <div class="pp-row">${periodPicker('a', pa)}${periodPicker('b', pb)}</div>
          <div class="pp-presets"><span class="muted small">Atajos:</span>
            <button class="chip" data-action="cmp-preset" data-preset="prev">Mes vs mes anterior</button>
            <button class="chip" data-action="cmp-preset" data-preset="yoy">Mes vs mismo mes del año anterior</button>
            <button class="chip" data-action="cmp-preset" data-preset="q">Trimestre vs anterior</button>
            <button class="chip" data-action="cmp-preset" data-preset="year">Año vs año anterior</button></div>
          <label class="check" style="margin:.8rem 0 0"><input type="checkbox" id="an-avg" ${S.an.avg ? 'checked' : ''}>Comparar promedios mensuales</label>
          <p class="hint" style="margin:.3rem 0 0">${S.an.avg ? `Cada período se divide por la cantidad de meses con movimientos (${nA} y ${nB}).` : 'Útil cuando los períodos tienen distinta cantidad de meses.'} Los atajos toman como base el mes elegido en las otras solapas (${esc(ymLabel(S.month))}).</p>
        </section>
        <section class="panel"><div class="scroll-x">${summary}</div></section>
        <section class="panel"><div class="panel-head"><h2>Egresos por categoría</h2></div>
          ${top.length ? chartBox('ch-cmp', Math.max(180, 60 + top.length * 44)) : '<p class="muted">Sin egresos en estos períodos.</p>'}</section>
        <section class="panel"><div class="panel-head"><h2>Detalle de egresos</h2></div><div class="scroll-x"><table class="simple">${head}<tbody>${expRows || '<tr><td colspan="5" class="muted">Sin datos</td></tr>'}</tbody></table></div></section>
          <section class="panel"><div class="panel-head"><h2>Detalle de ingresos</h2></div><div class="scroll-x"><table class="simple">${head}<tbody>${incRows || '<tr><td colspan="5" class="muted">Sin datos</td></tr>'}</tbody></table></div></section>`,
    };
  }

  // ----- Por categoría -----
  function anCategory() {
    const s = st();
    if (!S.an.key) {
      const ids = Object.entries(actualAgg(addMonths(S.month, -2), S.month).exp).sort((x, y) => y[1].total - x[1].total);
      S.an.key = ids.length ? `E|${ids[0][0]}` : (s.expenseCategories[0] ? `E|${s.expenseCategories[0].id}` : '');
    }
    const key = S.an.key;
    const opts = `<optgroup label="Egresos">${[...s.expenseCategories].map((c) =>
      `<option value="E|${esc(c.id)}" ${key === 'E|' + c.id ? 'selected' : ''}>${esc(c.name)}</option>` +
      [...c.subs].map((x) => `<option value="e|${esc(c.id)}|${esc(x.id)}" ${key === `e|${c.id}|${x.id}` ? 'selected' : ''}>\u00a0\u00a0\u00a0\u00a0${esc(x.name)}</option>`).join('')).join('')}</optgroup>
      <optgroup label="Ingresos">${[...s.incomeCategories].map((c) => `<option value="i|${esc(c.id)}" ${key === 'i|' + c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
    const n = S.an.catRange;
    const months = monthsBetween(addMonths(S.month, -(n - 1)), S.month);
    const real = months.map((m) => round2(aggValue(actualAgg(m), key)));
    const bud = months.map((m) => round2(aggValue(budgetAgg(m), key)));
    const hasBud = bud.some((x) => x > 0);
    const isInc = key.startsWith('i|');
    pendingCharts.push(['ch-cat', {
      type: 'bar',
      data: { labels: months.map(ymShort), datasets: [
        { type: 'bar', label: 'Real', data: real, backgroundColor: rgba(isInc ? cv('--in') : cv('--out'), 0.75), borderRadius: 4, order: 1 },
        ...(hasBud ? [{ type: 'line', label: 'Presupuesto', data: bud, borderColor: cv('--gold'), backgroundColor: cv('--gold'), borderDash: [6, 4], pointRadius: 2, stepped: 'middle', order: 0 }] : []),
      ] },
      options: chartBase(false),
    }]);
    const withData = real.filter((x) => x > 0);
    const total = real.reduce((a, x) => a + x, 0);
    const avg = withData.length ? total / withData.length : 0;
    const last3 = real.slice(-3).reduce((a, x) => a + x, 0) / Math.min(3, real.length);
    const prev3 = real.length >= 6 ? real.slice(-6, -3).reduce((a, x) => a + x, 0) / 3 : null;
    const trend = prev3 ? ((last3 - prev3) / prev3) * 100 : null;
    const kpi = (l, v) => `<div><span>${l}</span><strong class="num">${v}</strong></div>`;
    return {
      head: `<div class="head-actions">${monthNav()}<select id="an-crange" aria-label="Rango">${[12, 24, 36].map((x) => `<option value="${x}" ${x === n ? 'selected' : ''}>Últimos ${x} meses</option>`).join('')}</select></div>`,
      html: `<section class="panel">
          <label class="field" style="max-width:520px"><span>Categoría o subcategoría</span><select id="an-key">${opts}</select></label>
          <div class="kpis">
            ${kpi('Total del período', money(round2(total)))}
            ${kpi('Promedio mensual', money(round2(avg)))}
            ${kpi('Máximo', withData.length ? money(Math.max(...withData)) : '—')}
            ${kpi('Últimos 3 meses vs 3 anteriores', trend === null ? '—' : `${trend > 0 ? '+' : ''}${pctFmt.format(trend)}%`)}
          </div>
          ${chartBox('ch-cat', 300)}
          <p class="hint" style="margin:.6rem 0 0">El promedio considera solo los meses con movimientos en esta ${key.startsWith('e|') ? 'subcategoría' : 'categoría'}.</p>
        </section>`,
    };
  }

  // ============================================================
  //  Importación de historial desde otra app
  // ============================================================
  function pickHistoryFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      let pkg;
      try { pkg = JSON.parse(await readFileAsText(f)); } catch { toast('El archivo no es válido.'); return; }
      if (!pkg || pkg.format !== 'finanzas-import' || !Array.isArray(pkg.tx)) { toast('No es un archivo de importación de historial.'); return; }
      openHistoryImport(pkg, f.name);
    });
    inp.click();
  }

  // ----- Búsqueda de la categoría existente más parecida -----
  const IMP_SYN = [
    [/nafta|combustible|ypf|shell|axion|gnc|estacion de servicio/, 'nafta combustible'],
    [/patente|automotor/, 'patentes automotor impuestos'],
    [/seguro.*auto|seguro autos/, 'seguros auto'],
    [/seguro.*casa|seguro hogar/, 'seguros hogar'],
    [/seguro papa|seguro de vida/, 'seguros vida'],
    [/cochera|estacionamiento|peaje/, 'peajes estacionamiento'],
    [/lavado|gomeria/, 'mantenimiento'],
    [/arreglo|reparaci|taller mec|mecanic|service\b|repuesto|cubierta|neumatico/, 'reparaciones'],
    [/impuesto municipal|\babl\b|tasa municipal/, 'inmobiliario abl impuestos municipal'],
    [/inmobiliario/, 'inmobiliario impuestos'],
    [/ganancias/, 'ganancias impuestos'], [/bienes personales/, 'bienes personales impuestos'], [/monotributo/, 'monotributo impuestos'],
    [/expensas/, 'expensas vivienda'], [/alquiler/, 'alquiler vivienda'], [/ptmo|hipoteca/, 'vivienda alquiler'],
    [/\bluz\b|edenor|edesur|factura de luz/, 'luz servicios'], [/\bgas\b|metrogas|naturgy/, 'gas servicios'], [/\bagua\b|obras sanitarias|aysa/, 'agua servicios'],
    [/internet|fibertel|telecentro|cablevision|cable e internet/, 'internet servicios'],
    [/celular|telefon|movistar|claro|personal/, 'telefonia servicios'],
    [/netflix|disney|hbo|star\+|star plus|spotify|google music|youtube|amazon|xbox|ps plus|playstation|paramount|streaming|suscrip/, 'streaming'],
    [/google almacenamiento|icloud|google one|almacenamiento/, 'streaming internet'],
    [/alarma|monitoreo|camaras|tuya/, 'alarma seguridad'],
    [/colegio|escuela|ingles|guitarra|piano|dibujo|\bdanza|clases|curso|taller de|universidad|facultad/, 'educacion cuotas cursos'],
    [/libro|libreria|utiles/, 'libros materiales educacion'],
    [/supermercado|\bsuper\b|\bcoto\b|carrefour|jumbo|\bvea\b|mercado chino|almacen\b|mayorista|changomas|walmart/, 'supermercado'],
    [/verduler|fruta|carnicer|pescader|panader|fiambrer|dietetica/, 'verduleria almacen supermercado'],
    [/farmacia|remedio|medicamento|farmacity/, 'farmacia salud'],
    [/obra social|prepaga|osde|swiss|galeno|medicus|omint/, 'prepaga salud'],
    [/medic|doctor|odontolog|dentista|analisis|estudios|kinesio|psicolog/, 'consultas estudios salud'],
    [/\bropa\b|zapatilla|zapato|indumentaria|calzado|remera|pantalon|campera|malla\b|uniforme/, 'ropa'],
    [/peluquer|perfum|cosmet|cuidado personal/, 'cuidado personal'],
    [/cena|almuerzo|restaurant|resto|parrilla|pizzer|sushi|bodegon/, 'restaurantes salidas'],
    [/delivery|pedidos ya|pedidosya|rappi/, 'delivery'],
    [/cafe|salida|cine|teatro|\bbar\b|boliche|recital|show/, 'salidas ocio'],
    [/viaje|vacacion|hotel|pasaje|vuelo|aerolinea|booking|airbnb|turismo/, 'viajes ocio'],
    [/pileta|deporte|gimnasio|club|futbol|tenis|padel|juego|hobby/, 'hobbies ocio deportes'],
    [/regalo|cumple/, 'regalos'],
    [/comis|gtos banc|gastos bancarios|mantenimiento cuenta|banc/, 'comisiones bancarias'],
    [/uber|taxi|cabify|colectivo|subte|tren|sube/, 'transporte publico'],
    [/sac|aguinaldo|gratificaci|premio|retroactiv|vacaciones|liquidaci|asig no rem|adelanto|anticipo/, 'sueldo'],
    [/sueldo|haberes|salario/, 'sueldo'],
    [/intereses|interes|rendimiento|fci|plazo fijo|dividendo/, 'intereses rendimientos'],
    [/honorario|factura|servicios profesionales/, 'honorarios'],
    [/alquiler cobrado|alquileres/, 'alquileres cobrados'],
  ];
  // Mismas palabras, admitiendo plural o singular (impuesto/impuestos, regalo/regalos)
  // Palabras demasiado genéricas para decidir una categoría a partir de una descripción
  const DESC_STOP = new Set(['cuota', 'cuotas', 'saldo', 'pago', 'pagos', 'compra', 'compras', 'venta', 'reintegro', 'descuento', 'total', 'varios', 'gastos', 'cuenta', 'seña', 'adelanto']);
  const tokEq = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && Math.abs(a.length - b.length) <= 2 && (a.startsWith(b) || b.startsWith(a)));
  const stem = (w) => w;
  const impTokens = (t) => normText(t).replace(/[^a-z0-9+ ]/g, ' ').split(' ').filter((w) => w.length >= 3 && !STOPW.has(w));
  function impExpand(text) {
    const n = normText(text);
    let extra = '';
    for (const [re, add] of IMP_SYN) if (re.test(n)) extra += ' ' + add;
    const lit = impTokens(n).filter((w) => !DESC_STOP.has(w)), syn = impTokens(extra);
    const inn = (arr, t) => arr.some((x) => tokEq(x, t));
    return { lit: { has: (t) => inn(lit, t) }, syn: { has: (t) => inn(syn, t) }, has(t) { return inn(lit, t) || inn(syn, t); } };
  }
  function expenseLeaves() {
    const out = [];
    for (const c of s_().expenseCategories) {
      if (!c.active) continue;
      const subs = c.subs.filter((x) => x.active);
      if (subs.length) subs.forEach((x) => out.push({ v: `${c.id}|${x.id}`, l: `${c.name} › ${x.name}`, cat: c, sub: x }));
      else out.push({ v: `${c.id}|`, l: c.name, cat: c, sub: null });
    }
    return out.sort((a, b) => a.l.localeCompare(b.l, 'es'));
  }
  const s_ = () => st();
  // primary: lo más específico (subcategoría vieja o descripción), secondary: contexto (categoría vieja)
  function bestLeaf(primary, leaves, secondary = '') {
    const p = impExpand(primary), q = impExpand(secondary);
    // palabra literal de lo específico > sinónimo de lo específico > contexto general
    const w = (t) => (p.lit.has(t) ? 3 : p.syn.has(t) ? 2 : q.has(t) ? 1 : 0);
    let best = null, bestScore = 0, bestP = 0;
    for (const lf of leaves) {
      let subT = lf.sub ? impTokens(lf.sub.name).map(stem) : [];
      if (lf.sub && lf.sub.kind && vehicle(lf.sub.vehicleId)) {
        const vt = impTokens(vehicle(lf.sub.vehicleId).name);
        subT = subT.filter((t) => !vt.some((v) => tokEq(v, t)));
      }
      const catT = impTokens(lf.cat ? lf.cat.name : lf.name || '').map(stem);
      let sc = 0, sp = 0;
      subT.forEach((t) => { const x = w(t); sc += x * 2; if (x >= 2) sp += 2; });
      catT.forEach((t) => { const x = w(t); sc += x; if (x >= 2) sp += 1; });
      sc += sp; // desempata a favor de lo específico
      if (sc > bestScore) { bestScore = sc; best = lf; bestP = sp; }
    }
    return { leaf: best, score: bestScore, primary: bestP };
  }
  function fallbackLeaf(leaves) {
    return leaves.find((l) => l.sub && /otros gastos/.test(normText(l.sub.name)))
      || leaves.find((l) => /otros gastos|varios/.test(normText(l.l)))
      || leaves.find((l) => /otro/.test(normText(l.l))) || leaves[0];
  }
  const GENERIC_OLD = /extraordinari|otros gastos|desconocid|varios|gastos vicky|gastos vicka/;
  function accountMatch(a) {
    const syn = (t) => normText(t).replace(/frances/g, 'frances bbva').replace(/\bca\b/g, 'caja ahorro').replace(/u\$s|usd|dolares?/g, 'usd').replace(/\$/g, ' ');
    const at = impTokens(syn(a.name));
    let best = null, bestR = 0;
    for (const x of st().accounts) {
      if (accCurrency(x) !== a.currency || linkedTarget(x)) continue;
      if ((x.type === 'credito') !== (a.type === 'credito')) continue;
      const xt = new Set(impTokens(syn(x.name)));
      const brands = ['visa', 'master', 'mastercard', 'amex', 'american', 'cabal', 'naranja'];
      if (brands.some((b) => at.includes(b) !== xt.has(b))) continue;
      const r = at.filter((w) => xt.has(w)).length / Math.max(1, at.length);
      if (r > bestR) { bestR = r; best = x; }
    }
    return bestR >= 0.6 ? best.id : 'new';
  }

  function openHistoryImport(pkg, fileName) {
    const s = st();
    const leaves = expenseLeaves();
    const incs = [...s.incomeCategories].filter((c) => c.active).sort(byName);
    if (!leaves.length || !incs.length) { toast('Necesitás tener categorías de egreso e ingreso activas.'); return; }
    const fbLeaf = fallbackLeaf(leaves);
    const fbInc = incs.find((c) => /otros ingresos/.test(normText(c.name))) || incs.find((c) => /otro/.test(normText(c.name))) || incs[0];
    const cnt = { acc: {}, ec: {}, ic: {} };
    for (const t of pkg.tx) {
      cnt.acc[t[2]] = (cnt.acc[t[2]] || 0) + 1;
      if (t[3] >= 0) cnt.acc[t[3]] = (cnt.acc[t[3]] || 0) + 1;
      if (t[0] === 'e') cnt.ec[t[7]] = (cnt.ec[t[7]] || 0) + 1;
      if (t[0] === 'i') cnt.ic[t[7]] = (cnt.ic[t[7]] || 0) + 1;
    }
    const dates = pkg.tx.map((t) => t[1]).sort();
    const firstExisting = s.transactions.map((t) => t.date).sort()[0];
    const defCut = firstExisting && firstExisting <= dates[dates.length - 1] ? addDaysISO(firstExisting, -1) : dates[dates.length - 1];
    const accDef = pkg.accounts.map(accountMatch);
    // Hay coincidencia solo si la subcategoría vieja se parece a una tuya (no alcanza con la categoría general)
    const ecDef = pkg.expenseCats.map((e) => { const r = bestLeaf(e.sub, leaves, e.cat); return (r.primary >= 2 && !GENERIC_OLD.test(normText(e.sub)) ? r.leaf : fbLeaf).v; });
    const icDef = pkg.incomeCats.map((c) => { const r = bestLeaf(c.name, incs.map((x) => ({ v: x.id, l: x.name, cat: x, sub: null }))); return (r.primary >= 1 ? r.leaf.v : fbInc.id); });
    const opt = (list, def) => list.map((o) => `<option value="${esc(o.v)}" ${o.v === def ? 'selected' : ''}>${esc(o.l)}</option>`).join('');
    const accRows = pkg.accounts.map((a, i) => {
      const opts = s.accounts.filter((x) => accCurrency(x) === a.currency && !linkedTarget(x)).map((x) => ({ v: x.id, l: `Usar: ${x.name}` }));
      return `<div class="imp-row"><div><strong>${esc(a.name)}</strong><div class="sub muted small">${esc(ACCOUNT_TYPES[a.type] || a.type)}, ${esc(a.currency)}, ${cnt.acc[i] || 0} mov.</div></div>
        <select data-acc="${i}"><option value="new" ${accDef[i] === 'new' ? 'selected' : ''}>Darla de alta como inactiva</option>${opt(opts, accDef[i])}</select></div>`;
    }).join('');
    const leafOpts = leaves.map((l) => ({ v: l.v, l: l.l }));
    const ecRows = pkg.expenseCats.map((e, i) => `<div class="imp-row"><div><strong>${esc(e.cat)} › ${esc(e.sub)}</strong><div class="sub muted small">${cnt.ec[i] || 0} mov.</div></div>
      <select data-ec="${i}">${opt(leafOpts, ecDef[i])}</select></div>`).join('');
    const icRows = pkg.incomeCats.map((c, i) => `<div class="imp-row"><div><strong>${esc(c.name)}</strong><div class="sub muted small">${cnt.ic[i] || 0} mov.</div></div>
      <select data-ic="${i}">${opt(incs.map((x) => ({ v: x.id, l: x.name })), icDef[i])}</select></div>`).join('');
    const body = openModal('Importar historial', `
      <form id="hif" novalidate>
        <p>${pkg.tx.length.toLocaleString('es-AR')} movimientos del ${esc(dateShort(dates[0]))} al ${esc(dateShort(dates[dates.length - 1]))}. Todo va a tus categorías actuales: a cada categoría vieja se le asignó la más parecida, y las que no tienen una similar van a «${esc(fbLeaf.l)}». Revisalo antes de importar.</p>
        <div class="row">
          <label class="field"><span>Importar movimientos hasta el</span><input type="date" id="hi-cut" value="${esc(defCut)}"></label>
          <label class="check" style="align-self:end"><input type="checkbox" id="hi-rates" checked>Agregar cotizaciones históricas del dólar</label>
        </div>
        <label class="check"><input type="checkbox" id="hi-desc" checked>En las categorías genéricas (extraordinarios, otros, desconocidos), ubicar cada movimiento según su descripción cuando se parezca claramente a una de tus categorías</label>
        <details open class="imp-sec"><summary><h3>Cuentas (${pkg.accounts.length})</h3></summary>
          <p class="hint">Las que ya no usás se dan de alta como inactivas. Si alguna corresponde a una cuenta que ya tenés (por ejemplo, otro nombre para la misma caja de ahorro), elegila.</p>${accRows}</details>
        <details open class="imp-sec"><summary><h3>Categorías de egresos (${pkg.expenseCats.length})</h3></summary>${ecRows}</details>
        <details class="imp-sec"><summary><h3>Categorías de ingresos (${pkg.incomeCats.length})</h3></summary>${icRows}</details>
        <p class="error" id="hi-err"></p>
        <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary" id="hi-ok">Importar</button></div>
      </form>`, { wide: true });
    $('#hif', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const cut = $('#hi-cut', body).value || '9999-12-31';
      const accSel = pkg.accounts.map((_, i) => $(`[data-acc="${i}"]`, body).value);
      const ecSel = pkg.expenseCats.map((_, i) => $(`[data-ec="${i}"]`, body).value);
      const icSel = pkg.incomeCats.map((_, i) => $(`[data-ic="${i}"]`, body).value);
      const n = pkg.tx.filter((t) => t[1] <= cut).length;
      if (!n) { $('#hi-err', body).textContent = 'No hay movimientos para importar hasta esa fecha.'; return; }
      if (!confirm(`Se van a importar ${n.toLocaleString('es-AR')} movimientos. Después podés deshacerlo desde Seguridad y backup. ¿Continuar?`)) return;
      const r = runHistoryImport(pkg, fileName, { cut, accSel, ecSel, icSel, rates: $('#hi-rates', body).checked, byDesc: $('#hi-desc', body).checked, leaves, fbLeaf });
      closeModal();
      commit(`Importados ${r.count.toLocaleString('es-AR')} movimientos${r.reassigned ? `; ${r.reassigned.toLocaleString('es-AR')} se ubicaron por su descripción` : ''}`);
    });
  }

  function runHistoryImport(pkg, fileName, o) {
    const s = st();
    const now = new Date().toISOString();
    const batch = { id: uid(), date: now, file: fileName, count: 0, reassigned: 0, created: { accounts: [], expCats: [], expSubs: [], incCats: [] } };
    for (const a of pkg.accounts) if (!s.currencies.some((c) => c.code === a.currency)) s.currencies.push({ code: a.currency, name: a.currency, symbol: a.currency });
    const accIds = pkg.accounts.map((a, i) => {
      if (o.accSel[i] !== 'new') return o.accSel[i];
      const id = uid();
      s.accounts.push({ id, name: a.name, type: a.type, currency: a.currency, initialBalance: 0, active: false, closingDay: '', dueDay: '', linkedAccountId: '' });
      batch.created.accounts.push(id);
      return id;
    });
    const split = (v) => { const [c, x] = v.split('|'); return { c, x: x || '' }; };
    const ecTarget = o.ecSel.map(split);
    const generic = pkg.expenseCats.map((e, i) => GENERIC_OLD.test(normText(e.sub)) || o.ecSel[i] === o.fbLeaf.v);
    if (o.rates && pkg.rates) {
      for (const r of pkg.rates) {
        if (r.date <= o.cut && !s.rates.some((x) => x.currency === 'USD' && x.date === r.date)) s.rates.push({ id: uid(), currency: 'USD', date: r.date, rate: r.rate, note: r.note || 'importado' });
      }
    }
    const vehOf = (catId, subId) => {
      const sub = subOf(expCat(catId), subId);
      return sub && sub.kind && vehicle(sub.vehicleId) ? { vehicle: { vehicleId: sub.vehicleId, kind: sub.kind, km: null, ...(sub.kind === 'combustible' ? { liters: null, fullTank: true } : { works: [] }) } } : {};
    };
    const out = [];
    for (const t of pkg.tx) {
      const [k, date, a, b, amt, toAmt, rate, cat, desc] = t;
      if (date > o.cut) continue;
      const acc = account(accIds[a]);
      const cur = accCurrency(acc);
      const base = { id: uid(), date, period: ymOf(date), accountId: acc.id, currency: cur, description: desc || '', createdAt: now, updatedAt: now, batch: batch.id };
      if (k === 'x') {
        const to = account(accIds[b]);
        if (!to || to.id === acc.id) continue;
        out.push({ ...base, type: 'transferencia', toAccountId: to.id, amount: amt, toAmount: toAmt, toCurrency: accCurrency(to) });
      } else if (k === 'e') {
        let tg = ecTarget[cat];
        if (o.byDesc && generic[cat] && desc) {
          const r = bestLeaf(desc, o.leaves);
          if (r.primary >= 2 && r.leaf.v !== o.ecSel[cat]) { tg = split(r.leaf.v); batch.reassigned++; }
        }
        out.push({ ...base, type: 'egreso', amount: amt, rate: rate || 1, categoryId: tg.c, subcategoryId: tg.x, ...vehOf(tg.c, tg.x) });
      } else {
        out.push({ ...base, type: 'ingreso', amount: amt, rate: rate || 1, categoryId: o.icSel[cat], subcategoryId: '' });
      }
    }
    s.transactions.push(...out);
    batch.count = out.length;
    s.importBatches.push(batch);
    return batch;
  }

  function undoBatch(id) {
    const s = st();
    const b = s.importBatches.find((x) => x.id === id);
    if (!b) return;
    if (!confirm(`¿Deshacer la importación de “${b.file}”? Se borran sus ${b.count.toLocaleString('es-AR')} movimientos y las cuentas y categorías que creó y no usaste en otros movimientos.`)) return;
    s.transactions = s.transactions.filter((t) => t.batch !== id);
    const usedAcc = new Set(s.transactions.flatMap((t) => [t.accountId, t.toAccountId]));
    s.accounts = s.accounts.filter((a) => !b.created.accounts.includes(a.id) || usedAcc.has(a.id) || s.accounts.some((x) => x.linkedAccountId === a.id));
    const usedSub = new Set(s.transactions.map((t) => t.subcategoryId));
    const usedCat = new Set(s.transactions.map((t) => t.categoryId));
    s.expenseCategories.forEach((c) => { c.subs = c.subs.filter((x) => !b.created.expSubs.includes(x.id) || usedSub.has(x.id)); });
    s.expenseCategories = s.expenseCategories.filter((c) => !b.created.expCats.includes(c.id) || c.subs.length || usedCat.has(c.id));
    s.incomeCategories = s.incomeCategories.filter((c) => !b.created.incCats.includes(c.id) || usedCat.has(c.id));
    s.importBatches = s.importBatches.filter((x) => x.id !== id);
    commit('Importación deshecha');
  }

  // ============================================================
  //  Vista: Más (celular)
  // ============================================================
  function renderMore() {
    return `<div class="view-head"><h1>Más</h1></div>
      <section class="panel more-list">
        <button class="nav-btn" data-view="analysis">Análisis</button>
        <button class="nav-btn" data-view="recon">Conciliación</button>
        <button class="nav-btn" data-view="accounts">Cuentas</button>
        <button class="nav-btn" data-view="vehicles">Vehículos</button>
        <button class="nav-btn" data-view="categories">Categorías</button>
        <button class="nav-btn" data-view="currencies">Monedas y cotizaciones</button>
        <button class="nav-btn" data-view="settings">Seguridad y backup</button>
      </section>`;
  }

  // ============================================================
  //  Vista: Seguridad y backup
  // ============================================================
  function renderSettings() {
    const s = st();
    const last = s.settings.lastBackupAt ? new Date(s.settings.lastBackupAt) : null;
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }));
    return `<div class="view-head"><h1>Seguridad y backup</h1></div>
      <div class="grid2">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Acceso</h2></div>
            <label class="field"><span>Bloquear después de</span>
              <select id="set-lock">${[1, 3, 5, 10, 15, 30].map((m) => `<option value="${m}" ${Number(s.settings.lockMinutes) === m ? 'selected' : ''}>${m} minuto${m === 1 ? '' : 's'} sin uso</option>`).join('')}</select></label>
            <div class="actions" style="justify-content:flex-start">
              <button class="btn" data-action="change-pw">Cambiar contraseña</button>
              <button class="btn ghost" data-action="lock">Bloquear ahora</button>
            </div>
            <div class="bio-box" id="bio-box"><p class="muted small">Verificando si este dispositivo permite usar la huella…</p></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Tarjetas de crédito</h2></div>
            <label class="field"><span>Imputar los consumos al mes de</span>
              <select id="set-card">
                <option value="vencimiento" ${s.settings.cardImputation === 'vencimiento' ? 'selected' : ''}>Vencimiento del resumen (cuando lo pagás)</option>
                <option value="cierre" ${s.settings.cardImputation === 'cierre' ? 'selected' : ''}>Cierre del resumen</option>
                <option value="compra" ${s.settings.cardImputation === 'compra' ? 'selected' : ''}>Fecha de compra</option>
              </select></label>
            <p class="hint">Se usa como sugerencia al cargar un gasto con tarjeta; siempre podés cambiar el mes en el formulario. Para que funcione bien, cargá el día de cierre en cada tarjeta.</p>
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Backup</h2><span class="muted small">${last ? 'Último: ' + esc(last.toLocaleString('es-AR')) : 'Sin backups todavía'}</span></div>
            <p>El backup es un archivo cifrado con tu contraseña actual. Guardalo en Google Drive, iCloud o un pendrive: sin la contraseña nadie puede leerlo. También sirve para pasar los datos de la computadora al celular.</p>
            <div class="actions" style="justify-content:flex-start">
              <button class="btn primary" data-action="export-backup">Descargar backup</button>
              ${canShare ? '<button class="btn" data-action="share-backup">Compartir backup</button>' : ''}
              <button class="btn" data-action="import-backup">Restaurar backup</button>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Importar historial de otra app</h2></div>
            <p>Cargá el archivo de importación preparado a partir de tu app anterior. Antes de importar vas a poder elegir a qué cuentas y categorías va cada cosa.</p>
            <button class="btn" data-action="import-history">Elegir archivo</button>
            ${(s.importBatches || []).length ? `<ul class="list" style="margin-top:.8rem">${s.importBatches.map((b) => `<li><div class="grow"><div class="title">${esc(b.file)}</div><div class="sub">${esc(new Date(b.date).toLocaleString('es-AR'))}, ${b.count} movimientos</div></div><button class="btn small danger" data-action="undo-batch" data-id="${esc(b.id)}">Deshacer</button></li>`).join('')}</ul>` : ''}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Exportar a planilla</h2></div>
            <p>Descarga todos los movimientos en CSV para abrir en Excel o Google Sheets.</p>
            <p class="hint" style="margin:0 0 .6rem">Atención: este archivo no está cifrado.</p>
            <button class="btn" data-action="export-csv">Descargar CSV</button>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Este dispositivo</h2></div>
            <p id="persist-status" class="muted small">Verificando almacenamiento…</p>
            <button class="btn danger" data-action="wipe">Borrar todos los datos de este dispositivo</button>
          </section>
        </div>
      </div>`;
  }

  async function renderBioBox() {
    const box = $('#bio-box');
    if (!box) return;
    const [avail, bio] = await Promise.all([bioAvailable(), bioRecord()]);
    if (!box.isConnected) return;
    if (bio) {
      box.innerHTML = `<h3>Huella o rostro</h3><p class="small">Activado en este dispositivo desde el ${esc(new Date(bio.createdAt).toLocaleDateString('es-AR'))}. La contraseña sigue funcionando.</p>
        <button class="btn" id="bio-off">Desactivar</button>`;
      $('#bio-off').addEventListener('click', async () => {
        if (!confirm('¿Desactivar el desbloqueo con huella en este dispositivo?')) return;
        await idbDel(BIO_KEY); toast('Desbloqueo con huella desactivado'); renderBioBox();
      });
    } else if (avail) {
      box.innerHTML = `<h3>Huella o rostro</h3><p class="small">Abrí la app con la huella (o Face ID) en lugar de escribir la contraseña. Queda activado solo en este dispositivo.</p>
        <button class="btn primary" id="bio-on">Activar desbloqueo con huella</button>`;
      $('#bio-on').addEventListener('click', bioEnableForm);
    } else {
      box.innerHTML = `<h3>Huella o rostro</h3><p class="small muted">Este dispositivo o navegador no ofrece desbloqueo con huella para esta app. En el celular funciona con la app publicada (https) e instalada, en iOS 18 o posterior y en Android con Chrome actualizado.</p>`;
    }
  }
  function bioEnableForm() {
    const body = openModal('Activar desbloqueo con huella', `
      <form id="bef" novalidate>
        <input type="text" name="username" value="finanzas" autocomplete="username" hidden>
        <p>Confirmá tu contraseña. Después el teléfono te va a pedir la huella (puede pedirla dos veces).</p>
        <label class="field"><span>Contraseña</span><input type="password" id="be-pw" autocomplete="current-password"></label>
        <div class="warn">Cualquier huella o rostro registrado en este teléfono podrá abrir la app. Si el teléfono permite usar el código de desbloqueo como alternativa, quien lo sepa también podrá. La contraseña sigue siendo necesaria si borrás la huella o cambiás de teléfono.</div>
        <p class="error" id="be-err"></p>
        <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary" id="be-ok">Continuar</button></div>
      </form>`);
    setTimeout(() => $('#be-pw', body)?.focus(), 50);
    $('#bef', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#be-ok', body);
      btn.disabled = true; btn.textContent = 'Esperando la huella…';
      try {
        await saveChain;
        await enableBio($('#be-pw', body).value);
        closeModal();
        toast('Listo: la próxima vez podés abrir la app con tu huella');
        renderBioBox();
      } catch (ex) {
        console.error(ex);
        btn.disabled = false; btn.textContent = 'Continuar';
        $('#be-err', body).textContent = bioErrorText(ex);
      }
    });
  }

  function bindSettings() {
    renderBioBox();
    $('#set-lock').addEventListener('change', (e) => { st().settings.lockMinutes = Number(e.target.value); save(); toast('Guardado'); });
    $('#set-card').addEventListener('change', (e) => { st().settings.cardImputation = e.target.value; save(); toast('Guardado'); });
    const ps = $('#persist-status');
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then((p) => {
        if (!ps.isConnected) return;
        ps.textContent = p
          ? 'El navegador marcó estos datos como persistentes: no los borra para liberar espacio.'
          : 'El navegador podría borrar estos datos si se queda sin espacio. Instalá la app en la pantalla de inicio y hacé backups seguido.';
      });
    } else ps.textContent = 'Hacé backups seguido: los datos viven solo en este navegador.';
  }

  async function changePasswordForm() {
    const body = openModal('Cambiar contraseña', `
      <form id="pwf" novalidate>
        <input type="text" name="username" value="finanzas" autocomplete="username" hidden>
        <label class="field"><span>Contraseña actual</span><input type="password" id="p-cur" autocomplete="current-password"></label>
        <label class="field"><span>Nueva contraseña</span><input type="password" id="p-new" autocomplete="new-password"></label>
        <label class="field"><span>Repetí la nueva contraseña</span><input type="password" id="p-new2" autocomplete="new-password"></label>
        <p class="hint">Mínimo ${MIN_PW} caracteres. Una frase de varias palabras es más segura y fácil de recordar.</p>
        <p class="error" id="p-err"></p>
        <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary" id="p-ok">Cambiar contraseña</button></div>
      </form>`);
    const el = (id) => $('#' + id, body);
    setTimeout(() => el('p-cur')?.focus(), 50);
    el('pwf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = (m) => { el('p-err').textContent = m; };
      const cur = el('p-cur').value, n1 = el('p-new').value, n2 = el('p-new2').value;
      if (n1.length < MIN_PW) return err(`La nueva contraseña necesita al menos ${MIN_PW} caracteres.`);
      if (n1 !== n2) return err('Las contraseñas nuevas no coinciden.');
      el('p-ok').disabled = true; el('p-ok').textContent = 'Procesando…';
      try {
        await saveChain;
        const rec = await idbGet(VAULT_KEY);
        await unseal(rec, cur);
      } catch {
        el('p-ok').disabled = false; el('p-ok').textContent = 'Cambiar contraseña';
        return err('La contraseña actual no es correcta.');
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      S.key = await deriveKey(n1, salt, PBKDF2_ITER);
      S.salt = salt; S.iter = PBKDF2_ITER;
      await save();
      closeModal();
      const hadBio = !!(await idbGet(BIO_KEY).catch(() => null));
      await idbDel(BIO_KEY).catch(() => {});
      toast(hadBio ? 'Contraseña cambiada. Volvé a activar el desbloqueo con huella, y hacé un backup nuevo.' : 'Contraseña cambiada. Hacé un backup nuevo: los anteriores siguen usando la contraseña vieja.');
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function backupFile() {
    st().settings.lastBackupAt = new Date().toISOString();
    const rec = await seal(S.key, S.salt, S.iter, st());
    await save();
    const name = `finanzas-backup-${todayISO()}.json`;
    return { name, blob: new Blob([JSON.stringify(rec)], { type: 'application/json' }) };
  }

  async function exportBackup(share) {
    const { name, blob } = await backupFile();
    if (share) {
      try {
        await navigator.share({ files: [new File([blob], name, { type: 'application/json' })], title: 'Backup de Finanzas' });
      } catch (e) { if (e && e.name !== 'AbortError') downloadBlob(blob, name); }
    } else downloadBlob(blob, name);
    render();
    toast('Backup listo');
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  function importBackupForm() {
    const body = openModal('Restaurar backup', `
      <form id="rbf" novalidate>
        <p>Reemplaza todos los datos de este dispositivo por los del backup. Tu contraseña de acceso no cambia.</p>
        <label class="field"><span>Archivo de backup</span><input type="file" id="r-file" accept=".json,application/json"></label>
        <label class="field"><span>Contraseña con la que se hizo el backup</span><input type="password" id="r-pw" autocomplete="off"></label>
        <p class="error" id="r-err"></p>
        <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary" id="r-ok">Restaurar</button></div>
      </form>`);
    const el = (id) => $('#' + id, body);
    el('rbf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = (m) => { el('r-err').textContent = m; };
      const file = el('r-file').files[0];
      if (!file) return err('Elegí el archivo de backup.');
      let rec;
      try { rec = JSON.parse(await readFileAsText(file)); } catch { return err('El archivo no es un backup válido.'); }
      if (!isRecord(rec)) return err('El archivo no es un backup de esta aplicación.');
      el('r-ok').disabled = true; el('r-ok').textContent = 'Verificando…';
      let opened;
      try { opened = await unseal(rec, el('r-pw').value); } catch {
        el('r-ok').disabled = false; el('r-ok').textContent = 'Restaurar';
        return err('La contraseña no corresponde a este backup.');
      }
      const incoming = migrate(opened.state);
      const when = rec.savedAt ? new Date(rec.savedAt).toLocaleString('es-AR') : 'fecha desconocida';
      if (!confirm(`Vas a reemplazar ${st().transactions.length} movimientos actuales por ${incoming.transactions.length} del backup del ${when}. ¿Continuar?`)) {
        el('r-ok').disabled = false; el('r-ok').textContent = 'Restaurar';
        return;
      }
      S.state = incoming;
      closeModal();
      commit('Backup restaurado');
    });
  }

  function exportCSV() {
    const s = st();
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const n = (v) => (v === '' || v === null || v === undefined ? '' : plainFmt.format(v));
    const head = ['fecha', 'mes_imputacion', 'tipo', 'cuenta', 'cuenta_destino', 'categoria', 'subcategoria', 'descripcion', 'moneda', 'monto', 'cotizacion', 'monto_en_pesos', 'cuota', 'moneda_destino', 'monto_destino', 'vehiculo', 'km', 'litros', 'tanque_lleno', 'trabajos'];
    const rows = [...s.transactions].sort((a, b) => a.date.localeCompare(b.date) || (a.installmentNo || 0) - (b.installmentNo || 0)).map((t) => {
      const isT = t.type === 'transferencia';
      const c = t.type === 'ingreso' ? incCat(t.categoryId) : expCat(t.categoryId);
      const sub = t.type === 'egreso' ? subOf(c, t.subcategoryId) : null;
      return [
        dateShort(t.date), t.period, t.type, accName(t.accountId), isT ? accName(t.toAccountId) : '',
        isT ? '' : (c ? c.name : ''), sub ? sub.name : '', t.description || '', t.currency || BASE,
        n(t.amount), isT ? '' : n(t.rate || 1), isT ? '' : n(txBase(t)),
        t.installmentsTotal > 1 ? `${t.installmentNo}/${t.installmentsTotal}` : '',
        isT ? t.toCurrency : '', isT ? n(t.toAmount) : '',
        t.vehicle ? (vehicle(t.vehicle.vehicleId)?.name || '') : '', t.vehicle ? t.vehicle.km : '',
        t.vehicle && t.vehicle.liters ? n(t.vehicle.liters) : '', t.vehicle && t.vehicle.kind === 'combustible' ? (t.vehicle.fullTank ? 'sí' : 'no') : '',
        t.vehicle && t.vehicle.works ? t.vehicle.works.map((w) => mtype(w.typeId)?.name || '').join(' + ') : '',
      ].map(q).join(';');
    });
    const csv = '\ufeff' + [head.map(q).join(';'), ...rows].join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `finanzas-movimientos-${todayISO()}.csv`);
  }

  async function wipeAll() {
    if (!confirm('Se van a borrar todas las cuentas, movimientos y configuraciones de este dispositivo. ¿Continuar?')) return;
    if (!confirm('Esta acción no se puede deshacer. Si no tenés un backup, los datos se pierden. ¿Borrar todo?')) return;
    await saveChain;
    await idbDel(VAULT_KEY);
    await idbDel(BIO_KEY).catch(() => {});
    S.key = null; S.salt = null; S.state = null;
    closeModal();
    showLock('Se borraron los datos de este dispositivo.');
  }

  // ============================================================
  //  Acciones (delegación de eventos)
  // ============================================================
  document.addEventListener('click', (e) => {
    if (e.target.closest('#modal')) return;
    const el = e.target.closest('[data-action],[data-view]');
    if (!el || !S.state) return;
    if (el.dataset.view && !el.dataset.action) { go(el.dataset.view); return; }
    const a = el.dataset.action, id = el.dataset.id, s = st();
    switch (a) {
      case 'lock': lock(); break;
      case 'new-tx': openTxForm(null); break;
      case 'edit-tx': { const t = s.transactions.find((x) => x.id === id); if (t) openTxForm(t); break; }
      case 'month-prev': S.month = addMonths(S.month, -1); S.dueDay = null; render(); break;
      case 'month-next': S.month = addMonths(S.month, 1); S.dueDay = null; render(); break;
      case 'month-today': S.month = ymOf(todayISO()); S.dueDay = null; render(); break;
      case 'filter-cat':
        S.filters = { q: '', type: '', account: '', category: `${el.dataset.kind}:${id}`, sub: '', from: '', to: '', all: false };
        go('movements'); break;
      case 'new-account': openAccountForm(null); break;
      case 'edit-account': { const acc = account(id); if (acc) openAccountForm(acc); break; }
      case 'new-inc-cat':
        nameForm('Nueva categoría de ingreso', null, false, (name) => s.incomeCategories.push({ id: uid(), name, active: true })); break;
      case 'edit-inc-cat': {
        const c = incCat(id); if (!c) break;
        const used = s.transactions.some((t) => t.type === 'ingreso' && t.categoryId === id);
        nameForm('Editar categoría de ingreso', c, used, (name, active) => { c.name = name; c.active = active; },
          () => { s.incomeCategories = s.incomeCategories.filter((x) => x.id !== id); });
        break;
      }
      case 'new-exp-cat':
        nameForm('Nueva categoría de egreso', null, false, (name) => s.expenseCategories.push({ id: uid(), name, active: true, subs: [] })); break;
      case 'edit-exp-cat': {
        const c = expCat(id); if (!c) break;
        const used = s.transactions.some((t) => t.type === 'egreso' && t.categoryId === id);
        nameForm('Editar categoría de egreso', c, used, (name, active) => { c.name = name; c.active = active; },
          () => { s.expenseCategories = s.expenseCategories.filter((x) => x.id !== id); });
        break;
      }
      case 'new-sub': { const c = expCat(el.dataset.cat); if (c) subForm(c, null); break; }
      case 'edit-sub': { const c = expCat(el.dataset.cat); const x = subOf(c, id); if (x) subForm(c, x); break; }
      case 'edit-budget': openBudgetEditor(); break;
      case 'new-due': openDueForm(null); break;
      case 'import-stmt': openStatementImport(); break;
      case 'open-stmt': S.reconId = id; S.reconDraft = {}; render(); window.scrollTo(0, 0); break;
      case 'close-stmt': S.reconId = null; render(); break;
      case 'rematch': { const x = s.statements.find((y) => y.id === S.reconId); if (x) { reconcile(x); commit('Conciliación actualizada'); } break; }
      case 'del-stmt': deleteStatement(S.reconId); break;
      case 'recon-register': registerSelected(); break;
      case 'recon-ignore': ignoreSelected(); break;
      case 'recon-selall': selectAllMissing(el.dataset.on === '1'); break;
      case 'recon-unignore': { const x = curStmt(); const r = x && x.rows.find((y) => y.id === id); if (r) { r.status = 'missing'; delete r.note; reconcile(x); commit('Movimiento recuperado'); } break; }
      case 'diff-accept': diffAccept(id); break;
      case 'diff-reject': diffReject(id); break;
      case 'edit-due': { const x = s.dues.find((y) => y.id === id); if (x) openDueForm(x); break; }
      case 'pay-due': { const x = s.dues.find((y) => y.id === id); if (x) payDue(x); break; }
      case 'due-day': S.dueDay = S.dueDay === el.dataset.day ? null : el.dataset.day; render(); break;
      case 'import-pdf': pickPdfs(); break;
      case 'export-ics': exportIcsForm(); break;
      case 'edit-rule': { const r = s.importRules.find((y) => y.id === id); if (r) openRuleForm(r); break; }
      case 'an-tab': S.an.tab = el.dataset.tab; render(); break;
      case 'an-desv': S.an.desv = el.dataset.mode; render(); break;
      case 'cat-sort': S.catSort = true; render(); break;
      case 'cat-sort-done': S.catSort = false; render(); break;
      case 'cat-move': {
        const dir = Number(el.dataset.dir);
        let list;
        if (el.dataset.kind === 'e') list = s.expenseCategories;
        else if (el.dataset.kind === 'i') list = s.incomeCategories;
        else list = expCat(el.dataset.cat)?.subs || [];
        const idx = list.findIndex((x) => x.id === id);
        if (idx >= 0 && moveItem(list, idx, dir)) { save(); render(); }
        break;
      }
      case 'proj-mode': S.an.proj.mode = el.dataset.mode; render(); break;
      case 'proj-toggle': S.an.proj.open[id] = !S.an.proj.open[id]; render(); break;
      case 'proj-preset': projPreset(el.dataset.preset); render(); break;
      case 'cmp-preset': cmpPreset(el.dataset.preset); render(); break;
      case 'new-vehicle': vehicleForm(null); break;
      case 'edit-vehicle': { const v = vehicle(id); if (v) vehicleForm(v); break; }
      case 'update-km': { const v = vehicle(id); if (v) kmForm(v); break; }
      case 'new-mtype': mtypeForm(null); break;
      case 'edit-mtype': { const m = mtype(id); if (m) mtypeForm(m); break; }
      case 'new-currency': openCurrencyForm(null); break;
      case 'edit-currency': { const c = currency(el.dataset.code); if (c) openCurrencyForm(c); break; }
      case 'new-rate': openRateForm(null, el.dataset.code); break;
      case 'edit-rate': { const r = s.rates.find((x) => x.id === id); if (r) openRateForm(r); break; }
      case 'change-pw': changePasswordForm(); break;
      case 'export-backup': exportBackup(false); break;
      case 'share-backup': exportBackup(true); break;
      case 'import-backup': importBackupForm(); break;
      case 'export-csv': exportCSV(); break;
      case 'mv-clear': S.filters = { q: '', type: '', account: '', category: '', sub: '', from: '', to: '', all: false }; S.mvLimit = 300; render(); break;
      case 'mv-more': S.mvLimit = (S.mvLimit || 300) + 500; $('#mv-list').innerHTML = renderMovementList(); break;
      case 'import-history': pickHistoryFile(); break;
      case 'undo-batch': undoBatch(id); break;
      case 'wipe': wipeAll(); break;
      default: break;
    }
  });
  // Accesibilidad: Enter en filas clicables con role="button"
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[role="button"][data-action]')) e.target.click();
  });

  // ============================================================
  //  Pantallas de bloqueo y alta
  // ============================================================
  async function showLock(message) {
    $('#app').hidden = true;
    $('#lock').hidden = false;
    let rec = null;
    try { rec = await idbGet(VAULT_KEY); } catch (e) { console.error(e); }
    if (rec) renderUnlock(message, rec); else renderSetup(message);
  }

  async function renderUnlock(message) {
    const bio = await bioRecord();
    $('#lock-title').textContent = 'Finanzas';
    $('#lock-sub').textContent = message || (bio ? 'Desbloqueá con tu huella o ingresá tu contraseña.' : 'Ingresá tu contraseña para ver tus datos.');
    $('#lock-body').innerHTML = `
      ${bio ? `<button class="btn primary block bio-btn" id="u-bio" type="button"><svg class="fp" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.5A8 8 0 0 1 19.5 9M4.5 9.5A8 8 0 0 0 4 12c0 1.5.3 2.8.8 4M12 7a5 5 0 0 0-5 5c0 2.5.4 4.5 1.4 6.5M17 12c0-.9-.2-1.7-.6-2.4M12 11v1.5c0 3 .7 5.5 2 7.5M9.5 20.5c-.8-1.5-1-3.5-1-5.5M17 14.5c0 2-.4 3.8-1 5.3"/></svg>Desbloquear con huella</button>
        <p class="error" id="u-bio-err"></p>
        <div class="divider">o con tu contraseña</div>` : ''}
      <form id="unf" novalidate>
        <input type="text" name="username" value="finanzas" autocomplete="username" hidden>
        <label class="field"><span>Contraseña</span><input type="password" id="u-pw" autocomplete="current-password"></label>
        <p class="error" id="u-err"></p>
        <button class="btn ${bio ? '' : 'primary'} block" id="u-ok" type="submit">Desbloquear</button>
      </form>
      <details style="margin-top:1.2rem">
        <summary class="muted small">¿Olvidaste la contraseña?</summary>
        <p class="small">No hay forma de recuperarla: los datos están cifrados con ella. Si tenés un backup hecho con otra contraseña que sí recordás, podés borrar los datos de este dispositivo y restaurarlo.</p>
        <button class="btn danger small" id="u-wipe" type="button">Borrar datos de este dispositivo</button>
      </details>`;
    const pw = $('#u-pw');
    if (bio) {
      $('#u-bio').addEventListener('click', async () => {
        const b = $('#u-bio');
        b.disabled = true;
        try { startSession(await unlockWithBio()); }
        catch (e) {
          console.error(e);
          b.disabled = false;
          $('#u-bio-err').textContent = bioErrorText(e);
        }
      });
    } else setTimeout(() => pw.focus(), 50);
    $('#u-wipe').addEventListener('click', async () => {
      if (!confirm('Se borran todos los datos guardados en este dispositivo. ¿Continuar?')) return;
      if (!confirm('Esta acción no se puede deshacer. ¿Borrar todo?')) return;
      await idbDel(VAULT_KEY);
      await idbDel(BIO_KEY).catch(() => {});
      showLock('Se borraron los datos de este dispositivo.');
    });
    $('#unf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#u-ok');
      btn.disabled = true; btn.textContent = 'Abriendo…';
      try {
        const rec = await idbGet(VAULT_KEY);
        const o = await unseal(rec, pw.value);
        startSession(o);
      } catch {
        btn.disabled = false; btn.textContent = 'Desbloquear';
        $('#u-err').textContent = 'Contraseña incorrecta.';
        pw.select();
      }
    });
  }

  function renderSetup(message) {
    $('#lock-title').textContent = 'Bienvenido';
    $('#lock-sub').textContent = message || 'Creá una contraseña para proteger tus datos en este dispositivo.';
    $('#lock-body').innerHTML = `
      <form id="suf" novalidate>
        <input type="text" name="username" value="finanzas" autocomplete="username" hidden>
        <label class="field"><span>Contraseña</span><input type="password" id="s-pw" autocomplete="new-password"></label>
        <label class="field"><span>Repetí la contraseña</span><input type="password" id="s-pw2" autocomplete="new-password"></label>
        <p class="hint">Mínimo ${MIN_PW} caracteres. Una frase de varias palabras es más segura y fácil de recordar.</p>
        <div class="warn">Si olvidás la contraseña no hay forma de recuperar los datos. Guardala en un lugar seguro.</div>
        <p class="error" id="s-err"></p>
        <button class="btn primary block" id="s-ok" type="submit">Crear y empezar</button>
      </form>
      <div class="divider">¿Ya usás la app en otro dispositivo?</div>
      <form id="srf" novalidate>
        <label class="field"><span>Archivo de backup</span><input type="file" id="r-file" accept=".json,application/json"></label>
        <label class="field"><span>Contraseña del backup</span><input type="password" id="r-pw" autocomplete="current-password"></label>
        <p class="error" id="r-err"></p>
        <button class="btn block" id="r-ok" type="submit">Restaurar backup</button>
      </form>`;
    $('#suf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = $('#s-pw').value, p2 = $('#s-pw2').value;
      const err = (m) => { $('#s-err').textContent = m; };
      if (p1.length < MIN_PW) return err(`La contraseña necesita al menos ${MIN_PW} caracteres.`);
      if (p1 !== p2) return err('Las contraseñas no coinciden.');
      const btn = $('#s-ok'); btn.disabled = true; btn.textContent = 'Creando…';
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(p1, salt, PBKDF2_ITER);
      startSession({ key, salt, iter: PBKDF2_ITER, state: defaultState() });
      await save();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    });
    $('#srf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = (m) => { $('#r-err').textContent = m; };
      const file = $('#r-file').files[0];
      if (!file) return err('Elegí el archivo de backup.');
      let rec;
      try { rec = JSON.parse(await readFileAsText(file)); } catch { return err('El archivo no es un backup válido.'); }
      if (!isRecord(rec)) return err('El archivo no es un backup de esta aplicación.');
      const btn = $('#r-ok'); btn.disabled = true; btn.textContent = 'Verificando…';
      try {
        const o = await unseal(rec, $('#r-pw').value);
        await idbPut(VAULT_KEY, rec);
        await idbDel(BIO_KEY).catch(() => {});
        startSession(o);
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        toast('Backup restaurado. Tu contraseña es la misma del backup.');
      } catch {
        btn.disabled = false; btn.textContent = 'Restaurar backup';
        err('La contraseña no corresponde a este backup.');
      }
    });
  }

  function startSession({ key, salt, iter, state }) {
    S.key = key; S.salt = salt; S.iter = iter;
    S.state = migrate(state);
    S.month = ymOf(todayISO());
    lastActivity = Date.now();
    $('#lock').hidden = true;
    $('#lock-body').innerHTML = '';
    $('#app').hidden = false;
    save();
    go('dashboard');
  }

  // ============================================================
  //  Arranque
  // ============================================================
  if (!window.crypto || !crypto.subtle || !window.indexedDB) {
    document.body.innerHTML = '<p style="padding:2rem;font-family:sans-serif">Este navegador no permite el cifrado necesario. Abrí la app desde una dirección https o con un navegador actualizado.</p>';
    return;
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  showLock();
})();
