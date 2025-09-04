// /api/lead.js
// Vercel Serverless Function (Node 18+)
// Dependencies: npm i nodemailer

const nodemailer = require('nodemailer');

/* ========== ENV ========== */
const NOTION_SECRET = process.env.NOTION_SECRET;   // Notion Integration Secret
const DB_LEADS      = process.env.NOTION_DB_ID;    // ID deiner Leads-Datenbank

// Optional: schöner Absendername & Kalenderlink
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'techconsult Lead Desk';
const CALENDAR_URL   = process.env.CALENDAR_URL || 'https://outlook.office.com/book/techconsultGmbHNilsHoltel@techconsult.de/';

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

/* ========== CSV Helper (Team/Salesforce Mail) ========== */
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

// SMTP Transport
function buildTransport() {
  const host = process.env.SMTP_HOST || 'smtp.office365.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}
function fromAddress() {
  const user = process.env.SMTP_USER || 'no-reply@example.com';
  return `"${MAIL_FROM_NAME}" <${user}>`;
}

/* ========== 1) CSV an Team + BCC Salesforce ========== */
// Deine feste Salesforce-Email-to-Lead-Adresse (direkt eingetragen)
const SALESFORCE_BCC = "emailtosalesforce@l-2lps5na8lrt30zhe2o1n3dig6gdxmkk1cgnvjajf5dltn151ew.j6-jmpqmaw.eu50.le.salesforce.com";

async function sendMailCSV(csv) {
  const transporter = buildTransport();
  if (!transporter) return { ok:false, skipped:true, reason:'SMTP not configured' };

  const to = process.env.MAIL_TO || process.env.SMTP_USER;

  await transporter.sendMail({
    from: fromAddress(),
    to,
    bcc: SALESFORCE_BCC, // Salesforce Import
    subject: 'Neuer Lead (CSV)',
    text: csv,
    attachments: [{ filename: `lead_${Date.now()}.csv`, content: csv }],
  });

  return { ok:true, bcc:true };
}

/* ========== 2) Bestätigungs-Mail an den Kunden (Early Access) ========== */
async function sendCustomerConfirmation({ name, email, company }) {
  const transporter = buildTransport();
  if (!transporter) return { ok:false, skipped:true, reason:'SMTP not configured' };
  if (!email) return { ok:false, skipped:true, reason:'No recipient email' };

  const safeName = (name || '').trim();
  const greetName = safeName ? safeName : 'und Team';

  const subject = 'Willkommen zum Early Access: Ihre Insights folgen in Kürze';

  const text = [
    `Liebe/r ${greetName},`,
    '',
    'herzlichen Glückwunsch – Ihr Zugang zu den exklusiven Markt- und HR-Insights 2026 ist gesichert.',
    'Damit gehören Sie zu den Ersten, die vor der offiziellen Veröffentlichung erfahren, welche Trends, Benchmarks und Wettbewerbsentwicklungen die nächsten Jahre prägen werden.',
    '',
    'Was Sie erwartet:',
    '',
    '📊 Erste Benchmark-Ergebnisse, die aktuelle Bewegungen am Markt sichtbar machen',
    '🚀 Ihr persönliches Zukunftsprofil 2026',
    '💡 Frühindikatoren für HR- und Go-to-Market-Strategien, die andere Unternehmen erst später erkennen',
    '',
    '👉 In wenigen Tagen erhalten Sie die ersten Insights direkt in Ihr Postfach.',
    '',
    'Falls Sie Ihre Ergebnisse gleich im persönlichen Gespräch vertiefen möchten, können Sie hier einen Termin wählen:',
    'Jetzt 30-Minuten-Benchmark-Gespräch sichern: ' + CALENDAR_URL,
    '',
    'Wir freuen uns, Ihnen den entscheidenden Vorsprung zu verschaffen!',
    '',
    'Beste Grüße',
    'Ihr techconsult Team'
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">
      <p>Liebe/r ${escapeHtml(greetName)},</p>
      <p>herzlichen Glückwunsch – Ihr Zugang zu den exklusiven Markt- und HR-Insights 2026 ist gesichert.<br/>
      Damit gehören Sie zu den Ersten, die vor der offiziellen Veröffentlichung erfahren, welche Trends, Benchmarks und Wettbewerbsentwicklungen die nächsten Jahre prägen werden.</p>

      <p><strong>Was Sie erwartet:</strong></p>
      <ul style="margin-top:6px">
        <li>📊 Erste Benchmark-Ergebnisse, die aktuelle Bewegungen am Markt sichtbar machen</li>
        <li>🚀 Ihr persönliches Zukunftsprofil 2026</li>
        <li>💡 Frühindikatoren für HR- und Go-to-Market-Strategien, die andere Unternehmen erst später erkennen</li>
      </ul>

      <p>👉 In wenigen Tagen erhalten Sie die ersten Insights direkt in Ihr Postfach.</p>

      <p>Falls Sie Ihre Ergebnisse gleich im persönlichen Gespräch vertiefen möchten, können Sie hier einen Termin wählen:</p>
      <p>
        <a href="${escapeHtml(CALENDAR_URL)}"
           style="display:inline-block;padding:10px 14px;border-radius:8px;text-decoration:none;background:#2563eb;color:#fff">
           🔹 Jetzt 30-Minuten-Benchmark-Gespräch sichern
        </a>
      </p>

      <p>Wir freuen uns, Ihnen den entscheidenden Vorsprung zu verschaffen!</p>

      <p>Beste Grüße<br/>Ihr techconsult Team</p>
    </div>
  `;

  await transporter.sendMail({
    from: fromAddress(),
    to: email,
    subject,
    text,
    html
  });

  return { ok:true };
}

function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ========== Notion: Lead anlegen ========== */
/**
 * Erwartete Spalten in deiner Leads-DB:
 * Name (Title), Company (Text), Email (Email), Profile (Text),
 * Q1 (Text), Q2 (Text), Q3 (Text), Q4 (Text)
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
  // CORS
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

    // 1) Lead in Notion anlegen
    const lead = await createLeadPage(payload);

    // 2) CSV an Team + BCC an Salesforce
    const csv = buildCsv(payload);
    let mailTeam = { ok:false, skipped:true };
    try { mailTeam = await sendMailCSV(csv); } catch (e) { console.warn('mailTeam failed:', e.message); }

    // 3) Bestätigung an Kunden (Early Access)
    let mailCustomer = { ok:false, skipped:true };
    try { mailCustomer = await sendCustomerConfirmation({ name, email, company }); } catch (e) { console.warn('mailCustomer failed:', e.message); }

    return res.status(200).json({
      ok: true,
      leadId: lead.id,
      mail: {
        team: mailTeam,
        customer: mailCustomer
      }
    });
  } catch (e) {
    console.error('lead handler error:', e?.message || e);
    return res.status(500).json({ ok:false, error: e?.message || 'Server error' });
  }
};
