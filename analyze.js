// /api/analyze.js — DidTheyReply · Groq-powered cold DM analysis
// Deploy on Vercel. Set GROQ_API_KEY in your Vercel environment variables.

export default async function handler(req, res) {
  // CORS headers (safe for same-origin Vercel deployments)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dmText, recipient } = req.body;

  if (!dmText || typeof dmText !== 'string' || dmText.trim().length < 5) {
    return res.status(400).json({ error: 'dmText is required and must be at least 5 characters.' });
  }
  if (!recipient || typeof recipient !== 'string') {
    return res.status(400).json({ error: 'recipient is required.' });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
  }

  const systemPrompt = `You are a brutally honest cold DM expert with 10+ years of experience in outbound sales, growth, and B2B outreach. You've read tens of thousands of cold DMs and know exactly what gets replies and what gets deleted.

You do NOT sugarcoat. You do NOT give generic advice. You give sharp, specific, actionable feedback based on the actual text provided.

You will analyze a cold DM sent to a "${recipient}" and return a JSON object — no extra text, no markdown, no backticks. Only valid JSON.

The JSON must follow this exact structure:
{
  "replyRate": <integer 2-55, realistic % chance of getting a reply>,
  "scores": {
    "hook": <integer 0-100>,
    "personalization": <integer 0-100>,
    "clarity": <integer 0-100>,
    "cta": <integer 0-100>,
    "confidence": <integer 0-100>,
    "spamminess": <integer 0-100, where 100 = not spammy at all, 0 = pure spam>
  },
  "strengths": [<string>, <string>, ...],
  "weaknesses": [<string>, <string>, ...],
  "rewrite": "<a rewritten version of the DM that is concise, personalized, confident, and has a clear CTA — tailored for a ${recipient}>"
}

Scoring guidelines:
- hook: Does the first line immediately earn attention? Does it reference something specific about the recipient or show genuine research?
- personalization: Is this clearly written for this specific person, or is it a copy-paste blast?
- clarity: Is the value prop crystal clear in ≤2 sentences? No jargon, no fluff.
- cta: Is there exactly one clear, low-friction ask? (Not 3 questions, not "let me know if interested")
- confidence: Assertive and direct, not apologetic ("just," "sorry to bother," "if you have time")
- spamminess: Free of spam triggers, excessive punctuation, hollow buzzwords

Rules for strengths/weaknesses:
- Be specific — quote or reference actual phrases from the DM
- Minimum 2, maximum 4 items each
- Weaknesses should explain WHY it hurts reply rates, not just what's wrong
- Rewrite must be under 100 words, use line breaks for breathing room, sound human

Return ONLY the JSON. No commentary. No markdown. No code blocks. Raw JSON only.`;

  const userPrompt = `Recipient type: ${recipient}

Cold DM to analyze:
---
${dmText.trim()}
---

Analyze this DM and return the JSON.`;

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Fast, free tier, high quality
        max_tokens: 1024,
        temperature: 0.4, // Low temp = consistent structured output
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Groq API error:', groqResponse.status, errText);
      return res.status(502).json({ error: `Groq API returned ${groqResponse.status}. Check your API key and quota.` });
    }

    const groqData = await groqResponse.json();
    const rawContent = groqData?.choices?.[0]?.message?.content;

    if (!rawContent) {
      return res.status(502).json({ error: 'Empty response from Groq.' });
    }

    // Strip any accidental markdown fences
    const cleaned = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse failed. Raw content:', rawContent);
      return res.status(502).json({ error: 'AI returned invalid JSON. Try again.' });
    }

    // Validate shape
    const { replyRate, scores, strengths, weaknesses, rewrite } = parsed;
    if (
      typeof replyRate !== 'number' ||
      typeof scores !== 'object' ||
      !Array.isArray(strengths) ||
      !Array.isArray(weaknesses) ||
      typeof rewrite !== 'string'
    ) {
      return res.status(502).json({ error: 'AI response shape is invalid. Try again.' });
    }

    return res.status(200).json({ replyRate, scores, strengths, weaknesses, rewrite });

  } catch (err) {
    console.error('Unhandled error in /api/analyze:', err);
    return res.status(500).json({ error: 'Internal server error. Check logs.' });
  }
}
