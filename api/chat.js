export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, dealState, mode } = req.body || {};
  if (!messages) return res.status(400).json({ error: 'No messages' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const s = dealState?.currency === 'GBP' ? '£' : dealState?.currency === 'EUR' ? '€' : '$';
  const evArr = dealState?.validatedARR ? (dealState.basePP / dealState.validatedARR).toFixed(2) : null;

  const system = mode === 'insight'
    ? `You are a senior M&A analyst. Return ONLY valid JSON, no markdown.

DEAL:
- ${dealState?.dealName || 'Unknown'} | Buyer: ${dealState?.buyerName || 'Unknown'} | ${dealState?.currency || 'USD'}
- Base PP: ${s}${((dealState?.basePP||0)/1e6).toFixed(3)}M
- ARR: ${dealState?.validatedARR ? s+(dealState.validatedARR/1e6).toFixed(2)+'M' : 'not provided'}
- EV/ARR: ${evArr ? evArr+'x' : 'N/A'}
- Tangible WC: ${s}${((dealState?.tangibleWC||0)/1e3).toFixed(0)}K → Adj: ${s}${((dealState?.wcAdj||0)/1e3).toFixed(0)}K (cap: ${dealState?.wcCapPct||5}% ARR)
- SW DR: ${s}${((dealState?.swDR||0)/1e3).toFixed(0)}K | Non-SW DR: ${s}${((dealState?.nswDR||0)/1e3).toFixed(0)}K → Adj: ${s}${((dealState?.drAdj||0)/1e3).toFixed(0)}K
- Net PP: ${s}${((dealState?.netPP||0)/1e6).toFixed(3)}M (${((dealState?.delta||0)/1e3).toFixed(0)}K vs base)

Return exactly:
{
  "metrics": [
    {"label":"EV/ARR","value":"${evArr||'N/A'}x","benchmark":"SaaS median 4-6x · <2x distressed · >6x premium","status":"${evArr && parseFloat(evArr) < 2 ? 'low' : evArr && parseFloat(evArr) > 6 ? 'high' : 'fair'}"},
    {"label":"WC Impact","value":"${s}${(Math.abs(dealState?.wcAdj||0)/1e3).toFixed(0)}K","benchmark":"Impact on net price","status":"${(dealState?.wcAdj||0) < 0 ? 'negative' : 'positive'}"},
    {"label":"DR as % ARR","value":"${dealState?.validatedARR ? (((dealState?.swDR||0)+(dealState?.nswDR||0))/dealState.validatedARR*100).toFixed(0)+'%' : 'N/A'}","benchmark":"<30% normal · >60% elevated","status":"${dealState?.validatedARR && ((dealState?.swDR||0)+(dealState?.nswDR||0))/dealState.validatedARR > 0.6 ? 'elevated' : 'fair'}"}
  ],
  "sections": [
    {"label":"Valuation Assessment","items":[{"dot":"blue|green|amber|red","text":"Label: specific insight referencing actual numbers"}]},
    {"label":"Risk Factors","items":[...]},
    {"label":"Negotiation Positioning","items":[...]},
    {"label":"Recommended Actions","items":[...]}
  ]
}

Rules:
- Reference actual deal numbers in every insight
- SaaS benchmarks: <2x distressed, 2-4x value/turnaround, 4-6x healthy, 6-10x premium growth
- Negative tangible WC is common in SaaS; large negative signals billing quality issues
- DR >60% of ARR = heavy upfront billing, significant adjustment exposure
- Max 3-4 items per section`

    : `You are a senior M&A analyst embedded in a PPA calculator for Trilogy Acquisitions.

DEAL STATE:
- ${dealState?.dealName||'Unnamed'} | Buyer: ${dealState?.buyerName||'?'} | ${dealState?.currency||'USD'}
- Base PP: ${s}${((dealState?.basePP||0)/1e6).toFixed(3)}M | ARR: ${dealState?.validatedARR ? s+(dealState.validatedARR/1e6).toFixed(2)+'M' : 'not entered'}
- EV/ARR: ${evArr ? evArr+'x' : 'N/A'} | Net PP: ${s}${((dealState?.netPP||0)/1e6).toFixed(3)}M
- WC: ${s}${((dealState?.tangibleWC||0)/1e3).toFixed(0)}K tangible → ${s}${((dealState?.wcAdj||0)/1e3).toFixed(0)}K adj
- DR: SW ${s}${((dealState?.swDR||0)/1e3).toFixed(0)}K, Non-SW ${s}${((dealState?.nswDR||0)/1e3).toFixed(0)}K → ${s}${((dealState?.drAdj||0)/1e3).toFixed(0)}K adj

Rules:
- Direct, numbers-first, max 4-5 sentences unless deep analysis requested
- NEVER show reasoning or internal monologue — start directly with the answer
- For SET_FIELD: <action>{"type":"SET_FIELD","field":"FIELD_ID","value":NUMBER}</action>
  Valid: basePP, validatedARR, wcAR, wcEmp, wcLease, wcOther, wcCap, swDR, nswDR, drTh
- For PDF: <action>{"type":"EXPORT_PDF"}</action>`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: mode === 'insight' ? 2048 : 1024, system, messages: messages.slice(-12) }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.error?.message || 'Claude error' });
    const text = (d.content?.[0]?.text || '').trim();
    if (mode === 'insight') {
      try {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        return res.status(200).json({ insight: parsed });
      } catch { return res.status(500).json({ error: 'Could not parse insight', raw: text }); }
    }
    const am = text.match(/<action>(.*?)<\/action>/s);
    const action = am ? JSON.parse(am[1]) : null;
    return res.status(200).json({ text: text.replace(/<action>.*?<\/action>/s, '').trim(), action });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
