const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();

// Parse incoming JSON
app.use(bodyParser.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

let latestData = {};
const SECRET_KEY = process.env.SECRET_KEY || 'changeme';

const replacePlaceholders = (html, data) => {
  const basicPlaceholders = [
    'quote_id', 'quote_date', 'due_date',
    'customer_name', 'customer_email', 'customer_phone', 'customer_address',
    'project_address', 'items_html',
    'subtotal_cost', 'gst_cost', 'total_cost'
  ];

  basicPlaceholders.forEach(key => {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), data[key] || '');
  });

  const row = (label, value) => `<div class="row"><span>${label}</span><span>${value || ''}</span></div>`;

  html = html.replace('{{supply_cost_row}}', row('Supply Cost', data.supply_cost));
  html = html.replace('{{installation_fee_row}}', row('Installation Fee', data.installation_fee));
  html = html.replace('{{delivery_fee_row}}', row('Delivery Fee', data.delivery_fee));
  html = html.replace('{{demolition_fee_row}}', row('Demolition Fee', data.demolition_fee));
  html = html.replace('{{disposal_fee_row}}', row('Waste Disposal Fee', data.disposal_fee));
  // GST is handled directly by {{gst_cost}} in the main summary

  return html;
};    

app.get('/preview', (req, res) => {
  let html = fs.readFileSync('index.html', 'utf8');
  html = replacePlaceholders(html, latestData);
  res.send(html);
});

app.post('/generate', async (req, res) => {
  const authHeader = req.headers['x-api-key'];
  if (authHeader !== SECRET_KEY) return res.status(401).send('Unauthorized');

  const data = req.body || {};
  Object.keys(data).forEach(key => {
    if (data[key] === null || data[key] === undefined) data[key] = '';
  });

  // Fallback: auto-generate items_html if not provided
  if (!data.items_html && Array.isArray(data.items)) {
    data.items_html = buildItemsHtml(data.items);
  }
      
  const requiredFields = ['quote_id', 'items_html', 'total_cost'];
  const missing = requiredFields.filter(f => !data[f]);
  if (missing.length) return res.status(400).send(`Missing required fields: ${missing.join(', ')}`);

  latestData = data;

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    const PORT = process.env.PORT || 3000;
    await page.goto(`http://localhost:${PORT}/preview`, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(300);

    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    const fileName = data.file_name || 'invoice.pdf';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error('PDF generation error:', err.message || err);
    res.status(500).send('PDF generation failed.');
  }
});

// Generate modern grid-style HTML rows (not tables)
function buildItemsHtml(items) {
  if (!Array.isArray(items)) return '';
  return items.map(item => `
    <div class="item-row">
      <div>${item.code || ''}</div>
      <div>${item.room || ''}</div>
      <div>${item.type || ''}</div>
      <div>${item.size || ''}</div>
      <div>${item.glass || ''}</div>
      <div>${item.qty || ''}</div>
    </div>
  `).join('');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PDF server running on port ${PORT}`));
