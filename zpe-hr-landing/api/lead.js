// /api/lead.js
// Vercel Serverless Function (Node 18+)
// Dependencies: npm i nodemailer

const nodemailer = require('nodemailer');

/* ========== ENV ========== */
const NOTION_SECRET = process.env.NOTION_SECRET;   // Notion Integration Secret (1x für alle DBs)
const DB_LEADS      = process.env.NOTION_DB_ID;    // ID deiner Leads-Datenbank

/* ========== Notion Helper ========== */
async function notion(endpoint, method = 'POST', body) {
  if (!NOTION_SECRET) throw new Error('NOTION_SECRET missing');
  const r = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_SECRET}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`${method} /${endpoint} -> ${r.status} ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

/* ========== CSV Helper (optional Mail) ========== */
function toCsvLine(values) {
  return values.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
}
function buildCsv(payload) {
  const { name, company, email, profile, answers = {} } = payload || {};
  const headers = ['timestamp','name','company','email','profile','q1','q2','q3','q4'];
  const row = [
    new Date().toISOString(),
    name ?? '',
    company ?? '',
    email ?? '',
    profile ?? '',
    answers['q1_invest'] ?? '',
    answers['q2_gtm'] ?? '',
    answers['q3_ratings'] ?? '',
    answers['q4_growth'] ?? '',
  ];
  return `${headers.join(',')}\n${toCsvLine(row)}`;
}

async function sendMailCSV(csv) {
  const host = process.env.SMTP_HOST || 'smtp.office365.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to   = process.env.MAIL_TO || user;

  // NEU: Salesforce-Email (Lead-Import-Adresse)
  const sfBcc = "emailtosalesforce@l-2lps5na8lrt30zhe2o1n3dig6gdxmkk1cgnvjajf5dltn151ew.j6-jmpqmaw.eu50.le.salesforce.com";

  if (!user || !pass) return { ok:false, skipped:true, reason:'SMTP not configured' };

  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"Lead Intake" <${user}>`,
    to,                     // du / Team
    bcc: sfBcc || undefined, // NEU: BCC an Salesforce (nur wenn gesetzt)
    subject: 'Neuer Lead (CSV)',
    text: csv,              // Body = CSV (für einfache Weiterverarbeitung)
    attachments: [{ filename: `lead_${Date.now()}.csv`, content: csv }],
  });

  return { ok:true, bcc: Boolean(sfBcc) };
}

/* ========== Notion: Lead anlegen ========== */
/**
 * Erwartete Spalten in deiner Leads-DB:
 * Name (Title), Company (Text), Email (Email), Profile (Text),
 * Q1 (Text), Q2 (Text), Q3 (Text), Q4 (Text)
 * (Alles weitere — Formeln/Relations — rechnet Notion selbst.)
 */
async function createLeadPage(payload) {
  if (!DB_LEADS) throw new Error('NOTION_DB_ID missing');

  const { name, company, email, profile, answers = {} } = payload || {};

  return await notion('pages', 'POST', {
    parent: { database_id: DB_LEADS },
    properties: {
      'Name':    { title: [{ text: { content: String(name || '').trim() || 'Unbekannt' } }] },
      'Company': { rich_text: [{ text: { content: company || '' } }] },
      'Email':   { email: email || '' },
      'Profile': { rich_text: [{ text: { content: profile || '' } }] },
      'Q1':      { rich_text: [{ text: { content: answers['q1_invest']  || '' } }] },
      'Q2':      { rich_text: [{ text: { content: answers['q2_gtm']     || '' } }] },
      'Q3':      { rich_text: [{ text: { content: answers['q3_ratings'] || '' } }] },
      'Q4':      { rich_text: [{ text: { content: answers['q4_growth']  || '' } }] }
    }
  });
}

/* ========== HTTP Handler ========== */
module.exports = async (req, res) => {
  // CORS (falls dein Frontend auf anderer Domain ist)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  try {
    const payload = req.body || {};
    const { name, company, email } = payload;

    if (!name || !company || !email) {
      return res.status(400).json({ ok:false, error:'Missing required fields (name, company, email)' });
    }

    // 1) Lead anlegen
    const lead = await createLeadPage(payload);

    // 2) (optional) CSV-Mail
    const csv = buildCsv(payload);
    let mail = { ok:false, skipped:true };
    try { mail = await sendMailCSV(csv); } catch (e) { console.warn('mail failed:', e.message); }

    return res.status(200).json({ ok:true, leadId: lead.id, mail });
  } catch (e) {
    console.error('lead handler error:', e?.message || e);
    return res.status(500).json({ ok:false, error: e?.message || 'Server error' });
  }
};
