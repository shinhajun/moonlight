// Copy-paste code for calling Moonlight. One key works for every model; `model` picks it.
import { PUBLIC_ORIGIN } from './pages/AddComputer.jsx';

export const BASE = `${PUBLIC_ORIGIN}/v1`;

const chatPy = (model, verified) => `from openai import OpenAI
import os

client = OpenAI(
    base_url="${BASE}",
    api_key=os.environ["MOONLIGHT_API_KEY"],
)

reply = client.chat.completions.create(
    model="${model}",  # or "auto/chat-large" for any free large model
    messages=[{"role": "user", "content": "Hello from Moonlight"}],${verified ? '\n    extra_body={"moonlight": {"verified_only": True}},' : ''}
)
print(reply.choices[0].message.content)`;

const chatJs = (model, verified) => `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: process.env.MOONLIGHT_API_KEY,
});

const stream = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello from Moonlight" }],
  stream: true,${verified ? '\n  moonlight: { verified_only: true },' : ''}
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");`;

const chatCurl = (model, verified) => `curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer $MOONLIGHT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello from Moonlight"}]${verified ? ',\n    "moonlight": {"verified_only": true}' : ''}
  }'`;

const embedPy = (model) => `from openai import OpenAI
import os

client = OpenAI(base_url="${BASE}", api_key=os.environ["MOONLIGHT_API_KEY"])

res = client.embeddings.create(
    model="${model}",  # or "auto/embedding"
    input=["The mill never sleeps", "Neither does my laptop"],
)
print(len(res.data[0].embedding))`;

const embedJs = (model) => `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${BASE}", apiKey: process.env.MOONLIGHT_API_KEY });
const res = await client.embeddings.create({ model: "${model}", input: "The mill never sleeps" });
console.log(res.data[0].embedding.length);`;

const embedCurl = (model) => `curl ${BASE}/embeddings \\
  -H "Authorization: Bearer $MOONLIGHT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${model}", "input": "The mill never sleeps"}'`;

const decisionCurl = (model) => `curl ${BASE}/systemone \\
  -H "Authorization: Bearer $MOONLIGHT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "state": {"ticket": "My order arrived broken and I want a refund now."},
    "questions": {
      "is_refund": {"type": "noul", "instructions": "Is \`ticket\` asking for a refund?"},
      "urgency": {"type": "choice", "instructions": "How urgent is \`ticket\`?",
                  "criteria": {"low": "Can wait days", "medium": "Today", "high": "Needs action now"}},
      "tone": {"type": "score", "instructions": "How upset is the writer?",
               "criteria": ["Calm", "Frustrated", "Angry"]}
    }
  }'`;

const decisionPy = (model) => `import os, requests

res = requests.post(
    "${BASE}/systemone",
    headers={"Authorization": f"Bearer {os.environ['MOONLIGHT_API_KEY']}"},
    json={
        "model": "${model}",  # or "auto/decision"
        "state": {"ticket": "My order arrived broken and I want a refund now."},
        "questions": {
            "is_refund": {"type": "noul", "instructions": "Is \`ticket\` asking for a refund?"},
            "urgency": {"type": "choice", "instructions": "How urgent is \`ticket\`?",
                        "criteria": {"low": "Can wait days", "medium": "Today", "high": "Needs action now"}},
        },
    },
)
answers = res.json()["answers"]
print(answers["is_refund"]["noul"], answers["urgency"]["choice"])`;

export function snippets(kind, model, { verified = false } = {}) {
  if (kind === 'embedding') return [['Python', embedPy(model), 'py'], ['JavaScript', embedJs(model), 'js'], ['curl', embedCurl(model), 'sh']];
  if (kind === 'decision') return [['curl', decisionCurl(model), 'sh'], ['Python', decisionPy(model), 'py']];
  return [['Python', chatPy(model, verified), 'py'], ['JavaScript', chatJs(model, verified), 'js'], ['curl', chatCurl(model, verified), 'sh']];
}
