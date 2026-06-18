require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// ========== CORS FIX — yeh pehle aana chahiye ==========
const corsOptions = {
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));
// ========================================================

app.use(express.json());

const upload = multer({ dest: 'uploads/' });
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SUPABASE_URL = 'https://geeulsqwiglxxggpwvta.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET. Add JWT_SECRET to ugi-backend/.env before starting the backend.');
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Add the Supabase service role key to ugi-backend/.env for backend auth and multi-user CRM access.');
  process.exit(1);
}

if (/^(YOUR_|replace-with)/i.test(SUPABASE_SERVICE_ROLE_KEY) || SUPABASE_SERVICE_ROLE_KEY.length < 40) {
  console.error('Invalid SUPABASE_SERVICE_ROLE_KEY. The value in ugi-backend/.env still looks like a placeholder, not the real Supabase service role key.');
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ========== 3 WHATSAPP CLIENTS ==========
const WA = {
  ugi:   { client: null, qr: '', status: 'disconnected', id: 'ugi',   clientId: 'ugi-crm-ugi'   },
  unit1: { client: null, qr: '', status: 'disconnected', id: 'unit1', clientId: 'ugi-crm-unit1' },
  unit2: { client: null, qr: '', status: 'disconnected', id: 'unit2', clientId: 'ugi-crm-unit2' },
};

let blastStatus = { running: false, sent: 0, failed: 0, skipped: 0, total: 0, log: [] };

// ========== INIT ONE CLIENT ==========
function initWhatsApp(key) {
  const wa = WA[key];
  wa.status = 'connecting';
  wa.qr = '';

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: wa.clientId }),
    puppeteer: {
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      protocolTimeout: 60000
    }
  });

  client.on('qr', qr => {
    wa.qr = qr;
    wa.status = 'qr';
    console.log(`[${key}] QR Ready`);
  });

  client.on('ready', () => {
    wa.status = 'ready';
    wa.qr = '';
    console.log(`[${key}] WhatsApp Connected!`);
  });

  client.on('auth_failure', () => {
    wa.status = 'disconnected';
    console.log(`[${key}] Auth Failed`);
  });

  client.on('disconnected', () => {
    wa.status = 'disconnected';
    wa.client = null;
    console.log(`[${key}] Disconnected`);
  });

  client.initialize();
  wa.client = client;
}

// ========== HELPERS ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function smartDelay() {
  return Math.floor(4000 + Math.random() * 11000);
}

function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const GREETINGS = ['Assalam o Alaikum', 'AOA', 'Salam', 'Adab'];
const CLOSINGS  = ['Shukriya', 'Allah Hafiz', 'Jazak Allah Khair', 'UGI Management', 'Shukriya - UGI Team'];

function composeMessage(body, name, personalized) {
  const greeting = getRandom(GREETINGS);
  const closing  = getRandom(CLOSINGS);
  const nameStr  = personalized && name ? ` ${name}` : '';
  return `${greeting}${nameStr}!\n\n${body}\n\n${closing}`;
}

function unitToKey(unit) {
  if (!unit) return null;
  const u = unit.toLowerCase().replace(/\s+/g, '');
  if (u === 'ugi')   return 'ugi';
  if (u === 'unit1') return 'unit1';
  if (u === 'unit2') return 'unit2';
  return null;
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name || ''
  };
}

function logSupabaseError(context, error) {
  if (!error) return;
  console.error(`[Supabase] ${context}: ${JSON.stringify({
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint
  })}`);
}

function handleSupabaseError(res, context, error, fallback = 'Database request failed') {
  logSupabaseError(context, error);
  return res.status(500).json({
    error: fallback,
    code: error?.code || 'SUPABASE_ERROR'
  });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ========== AUTH ROUTES ==========

app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('app_users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingError) {
      return handleSupabaseError(res, 'signup check existing user', existingError, 'Could not check existing user');
    }

    if (existing) {
      return res.status(409).json({ error: 'Email is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase
      .from('app_users')
      .insert({ email, password_hash: passwordHash, name })
      .select('id, email, name')
      .single();

    if (error) {
      return handleSupabaseError(res, 'signup insert app_users', error, 'Signup failed');
    }

    if (!user) {
      console.error('[Auth] signup insert returned no user row');
      return res.status(500).json({ error: 'Signup failed' });
    }

    res.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('[Auth] signup unexpected error', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: user, error } = await supabase
      .from('app_users')
      .select('id, email, name, password_hash')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      return handleSupabaseError(res, 'login select app_users', error, 'Login failed');
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('[Auth] login unexpected error', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ========== CONTACT ROUTES ==========

app.get('/api/contacts/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const types = ['T', 'NT', 'TLM', 'Student'];
    const units = ['UGI', 'Unit 1', 'Unit 2'];

    const { count: total, error: totalError } = await supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (totalError) {
      return handleSupabaseError(res, 'contacts stats total', totalError, 'Stats fetch failed');
    }

    const typeCounts = await Promise.all(types.map(type =>
      supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('type', type)
    ));

    const unitCounts = await Promise.all(units.map(unit =>
      supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('unit', unit)
    ));

    const failedType = typeCounts.find(result => result.error);
    if (failedType) {
      return handleSupabaseError(res, 'contacts stats type count', failedType.error, 'Stats fetch failed');
    }

    const failedUnit = unitCounts.find(result => result.error);
    if (failedUnit) {
      return handleSupabaseError(res, 'contacts stats unit count', failedUnit.error, 'Stats fetch failed');
    }

    const stats = { all: total || 0 };
    types.forEach((type, index) => { stats[type] = typeCounts[index].count || 0; });
    units.forEach((unit, index) => { stats[unit] = unitCounts[index].count || 0; });

    res.json(stats);
  } catch (err) {
    console.error('[Contacts] stats unexpected error', err);
    res.status(500).json({ error: 'Stats fetch failed' });
  }
});

app.get('/api/contacts', requireAuth, async (req, res) => {
  try {
    let query = supabase
      .from('contacts')
      .select('*')
      .eq('user_id', req.user.id)
      .order('name');

    if (req.query.type && req.query.type !== 'all') {
      query = query.eq('type', req.query.type);
    }

    if (req.query.unit && req.query.unit !== 'all') {
      query = query.eq('unit', req.query.unit);
    }

    const { data, error } = await query.limit(10000);

    if (error) {
      return handleSupabaseError(res, 'contacts list', error, 'Contacts fetch failed');
    }

    res.json({ contacts: data || [] });
  } catch (err) {
    console.error('[Contacts] list unexpected error', err);
    res.status(500).json({ error: 'Contacts fetch failed' });
  }
});

app.post('/api/contacts/bulk-upsert', requireAuth, async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

    if (!rows.length) {
      return res.status(400).json({ error: 'No contacts provided' });
    }

    const userRows = rows.map(row => ({
      ...row,
      user_id: req.user.id
    }));

    const { data, error } = await supabase
      .from('contacts')
      .upsert(userRows, { onConflict: 'user_id,mobile' })
      .select('id');

    if (error) {
      return handleSupabaseError(res, 'contacts bulk upsert', error, 'Contacts save failed');
    }

    res.json({ saved: data?.length || userRows.length });
  } catch (err) {
    console.error('[Contacts] bulk upsert unexpected error', err);
    res.status(500).json({ error: 'Contacts save failed' });
  }
});

app.patch('/api/contacts/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['name', 'mobile', 'label', 'type', 'campus', 'unit', 'designation', 'source'];
    const updates = {};

    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No allowed contact fields provided' });
    }

    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('*')
      .maybeSingle();

    if (error) {
      return handleSupabaseError(res, 'contacts update', error, 'Contact update failed');
    }

    if (!data) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ contact: data });
  } catch (err) {
    console.error('[Contacts] update unexpected error', err);
    res.status(500).json({ error: 'Contact update failed' });
  }
});

app.delete('/api/contacts/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();

    if (error) {
      return handleSupabaseError(res, 'contacts delete', error, 'Contact delete failed');
    }

    if (!data) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Contacts] delete unexpected error', err);
    res.status(500).json({ error: 'Contact delete failed' });
  }
});

// ========== WHATSAPP ROUTES ==========

app.get('/api/wa/status/all', requireAuth, (req, res) => {
  const result = {};
  for (const key of ['ugi', 'unit1', 'unit2']) {
    const wa = WA[key];
    result[key] = {
      status: wa.status,
      qr: wa.qr
        ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(wa.qr)}`
        : null
    };
  }
  res.json(result);
});

app.get('/api/wa/status/:key', requireAuth, (req, res) => {
  const wa = WA[req.params.key];
  if (!wa) return res.status(404).json({ error: 'Invalid key' });
  res.json({
    status: wa.status,
    qr: wa.qr
      ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(wa.qr)}`
      : null
  });
});

app.post('/api/wa/connect/:key', requireAuth, (req, res) => {
  const wa = WA[req.params.key];
  if (!wa) return res.status(404).json({ error: 'Invalid key' });
  if (wa.status === 'ready') return res.json({ success: true, message: 'Already connected' });
  initWhatsApp(req.params.key);
  res.json({ success: true, message: 'Connecting...' });
});

app.post('/api/wa/disconnect/:key', requireAuth, async (req, res) => {
  const wa = WA[req.params.key];
  if (!wa) return res.status(404).json({ error: 'Invalid key' });
  if (wa.client) await wa.client.destroy();
  wa.client = null;
  wa.status = 'disconnected';
  wa.qr = '';
  res.json({ success: true });
});

// ========== UPLOAD & BLAST ROUTES ==========

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ path: req.file.path, name: req.file.originalname, mimetype: req.file.mimetype });
});

app.get('/api/blast/status', requireAuth, (req, res) => {
  res.json(blastStatus);
});

app.post('/api/blast/stop', requireAuth, (req, res) => {
  blastStatus.running = false;
  res.json({ success: true });
});

app.post('/api/blast/start', requireAuth, async (req, res) => {
  if (blastStatus.running) {
    return res.status(400).json({ error: 'Blast already running' });
  }

  const { unit, type, message, personalized, mediaPath, mediaMime, mediaName } = req.body;

  if (!unit || unit === 'all') {
    return res.status(400).json({ error: 'Ek unit select karo blast ke liye (UGI, Unit 1, ya Unit 2)' });
  }

  const waKey = unitToKey(unit);
  if (!waKey) return res.status(400).json({ error: 'Invalid unit' });

  const wa = WA[waKey];
  if (!wa.client || wa.status !== 'ready') {
    return res.status(400).json({ error: `${unit} ka WhatsApp connect nahi hai` });
  }

  let query = supabase
    .from('contacts')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('unit', unit);
  if (type && type !== 'all') query = query.eq('type', type);
  const { data: contacts, error } = await query;

  if (error) return handleSupabaseError(res, 'blast contacts fetch', error, 'Contacts fetch failed');
  if (!contacts) return res.status(500).json({ error: 'Contacts fetch failed' });

  blastStatus = {
    running: true, sent: 0, failed: 0, skipped: 0,
    total: contacts.length, log: [],
    unit, type: type || 'all', waKey
  };

  res.json({ success: true, total: contacts.length });

  (async () => {
    let media = null;
    if (mediaPath && fs.existsSync(mediaPath)) {
      media = MessageMedia.fromFilePath(mediaPath);
    }

    for (const contact of contacts) {
      if (!blastStatus.running) break;

      const phone = contact.mobile || contact.phone;
      if (!phone) {
        blastStatus.skipped++;
        continue;
      }

      try {
        const numberId = await wa.client.getNumberId(phone);
        if (!numberId) {
          blastStatus.skipped++;
          blastStatus.log.push({ phone, name: contact.name, status: 'skipped' });
          await sleep(1000);
          continue;
        }

        const finalMsg = composeMessage(message, contact.name, personalized);

        if (media) {
          await wa.client.sendMessage(numberId._serialized, media, { caption: finalMsg });
        } else {
          await wa.client.sendMessage(numberId._serialized, finalMsg);
        }

        blastStatus.sent++;
        blastStatus.log.push({ phone, name: contact.name, status: 'sent' });

      } catch (err) {
        blastStatus.failed++;
        blastStatus.log.push({ phone, name: contact.name, status: 'failed', error: err.message });
      }

      await sleep(smartDelay());
    }

    blastStatus.running = false;
    console.log(`[BLAST DONE] Unit: ${unit} | Sent: ${blastStatus.sent} | Failed: ${blastStatus.failed} | Skipped: ${blastStatus.skipped}`);

    if (mediaPath && fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
  })();
});

app.listen(3001, () => console.log('UGI CRM Backend running: http://localhost:3001'));