export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, dealState } = req.body || {};
  if (!messages) return res.status(400).json({ error: 'No messages provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const sym = dealState?.currency === 'GBP' ? '£' : dealState?.currency === 'EUR' ? '€' : '$';

  const systemPrompt = `You are a senior M&A analyst with 20+ years of experience at firms like JPMorgan, BlackRock, and KKR. You are embedded in a Purchase Price Adjustment (PPA) calculator for Trilogy Acquisitions — a private equity firm that acquires and operates software companies.

CURRENT DEAL STATE:
- Deal: ${dealState?.dealName || 'Unnamed'} | Buyer: ${dealState?.buyerName || 'Unknown'}
- Currency: ${dealState?.currency || 'USD'} (${sym})
- Base Purchase Price: ${sym}${(dealState?.basePP||0).toLocaleString()}
- Validated ARR: ${sym}${(dealState?.validatedARR||0).toLocaleString()}
- EV/ARR Multiple: ${dealState?.validatedARR ? ((dealState?.basePP||0)/(dealState?.validatedARR||1)).toFixed(2)+'x' : 'N/A'}
- Tangible WC: ${sym}${(dealState?.tangibleWC||0).toLocaleString()} → WC Adjustment: ${sym}${(dealState?.wcAdj||0).toLocaleString()} (capped at ${dealState?.wcCapPct||5}% of ARR = ${sym}${(dealState?.wcCap||0).toLocaleString()})
- Software DR: ${sym}${(dealState?.softDR||0).toLocaleString()} | Non-SW DR: ${sym}${(dealState?.nonSoftDR||0).toLocaleString()} → DR Adjustment: ${sym}${(dealState?.drAdj||0).toLocaleString()}
- Net Purchase Price: ${sym}${(dealState?.netPP||0).toLocaleString()} (${sym}${((dealState?.delta||0)/1000).toFixed(0)}K vs base)
- Missing fields: ${[
    !dealState?.basePP && 'Base PP',
    !dealState?.validatedARR && 'ARR',
    !dealState?.wcNetAR && 'WC Current Assets',
    !dealState?.wcOther && 'WC Liabilities',
    !dealState?.softDR && 'Deferred Revenue',
  ].filter(Boolean).join(', ') || 'None'}

YOUR ROLE:
You are the smartest person in the room on this deal. You:

1. **DEAL ANALYSIS** — Proactively flag risks and opportunities:
   - Is the EV/ARR multiple fair for this type of software business?
   - Is the WC adjustment material? Is the cap binding?
   - Is deferred revenue unusually high? What does that signal?
   - What's the effective price after all adjustments?
   - Are there missing adjustments that are standard for software deals?

2. **NEGOTIATION INTELLIGENCE** — Think like the buyer AND seller:
   - Where is the seller likely to push back?
   - Which adjustments are most negotiable?
   - What's the downside scenario if ARR is lower than validated?
   - What leverage does the buyer have?

3. **MARKET CONTEXT** — Apply real PE/M&A benchmarks:
   - Typical EV/ARR multiples for SaaS businesses (3-8x depending on growth/retention)
   - Standard WC definitions and typical outcomes
   - How deferred revenue adjustments typically play out
   - What net retention rates imply about business quality

4. **FIELD SUGGESTIONS** — When fields are empty, suggest what's typical:
   - Standard WC assumptions for software companies
   - Typical deferred revenue levels as % of ARR
   - Common additional adjustments in software deals

5. **ACTIONS** — When asked to update a value:
   <action>{"type":"SET_FIELD","field":"FIELD_ID","value":NUMBER}</action>
   Valid fields: basePP, validatedARR, wcNetAR, wcEmpTerm, wcLease, wcOther, wcCapPct, softDR, nonSoftDR, drThreshPct

6. **PDF EXPORT** — When asked: <action>{"type":"EXPORT_PDF"}</action>

COMMUNICATION STYLE:
- Direct, numbers-first, no fluff
- Lead with the most important insight
- Use ${sym} for all amounts
- Max 5-6 sentences unless doing deep analysis
- Call out red flags immediately
- Be opinionated — you have a point of view`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.slice(-12),
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });

    const text = data.content?.[0]?.text || '';
    const actionMatch = text.match(/<action>(.*?)<\/action>/s);
    const action = actionMatch ? JSON.parse(actionMatch[1]) : null;
    const cleanText = text.replace(/<action>.*?<\/action>/s, '').trim();

    return res.status(200).json({ text: cleanText, action });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
