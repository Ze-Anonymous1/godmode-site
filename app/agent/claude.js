// The AI that drives the browser. Claude runs a tool-use loop; each tool maps
// to a real action on the embedded web view (passed in as `browser`).

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

const SYSTEM = `You are GOD MODE — an AI that lives inside a desktop browser and
operates it on the user's behalf. You can navigate, read the current page, click
elements and type into fields. Work in small, observable steps: navigate or read,
look at what came back, then decide the next action. Keep spoken replies short and
natural — the user hears them out loud. When a task is done, say so plainly.`;

const TOOLS = [
  {
    name: 'navigate',
    description: 'Open a URL, or run a web search if given plain text.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL or search query' } },
      required: ['url'],
    },
  },
  {
    name: 'read_page',
    description: 'Return the visible text of the current page (truncated).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'click',
    description: 'Click the first element matching a CSS selector.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    name: 'type',
    description: 'Set the value of an input/textarea matching a CSS selector.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' } },
      required: ['selector', 'text'],
    },
  },
  { name: 'back', description: 'Go back in history.', input_schema: { type: 'object', properties: {} } },
];

async function dispatch(browser, name, input) {
  switch (name) {
    case 'navigate': return await browser.navigate(input.url);
    case 'read_page': return { text: await browser.readText() };
    case 'click': return await browser.click(input.selector);
    case 'type': return await browser.type(input.selector, input.text);
    case 'back': browser.back(); return { ok: true };
    default: return { error: `unknown tool ${name}` };
  }
}

// Runs one user turn to completion (through any tool calls) and returns the
// final spoken text. `emit` streams intermediate events to the UI.
async function runAgentTurn({ message, browser, emit, history = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to app/.env');
  }
  const client = new Anthropic();
  const messages = [...history, { role: 'user', content: message }];
  emit({ type: 'user', text: message });

  for (let step = 0; step < 12; step++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    for (const block of res.content) {
      if (block.type === 'text' && block.text.trim()) emit({ type: 'assistant', text: block.text });
    }
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    }

    const toolResults = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      emit({ type: 'tool', name: block.name, input: block.input });
      let out;
      try { out = await dispatch(browser, block.name, block.input); }
      catch (err) { out = { error: String(err.message || err) }; }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(out).slice(0, 6000),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return 'Stopped after too many steps — tell me how to continue.';
}

module.exports = { runAgentTurn };
