import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANNED_MODEL, licenseClass, marketPrice, paramsB } from '../src/policy.js';

// Every license id the agent emits, plus raw GGUF / Hugging Face ids.
const LICENSES = {
  'qwen-research': 'blocked',
  'Qwen RESEARCH LICENSE AGREEMENT': 'blocked',
  'CC-BY-NC-4.0': 'blocked',
  'CC-BY-NC-SA-4.0': 'blocked',
  'cc-by-nc-nd-4.0': 'blocked',
  'MNPL-0.1': 'blocked',
  'MRL-0.1': 'blocked',
  'Mistral AI Non-Production License': 'blocked',
  'c4ai-cc-by-nc-4.0': 'blocked',
  llama2: 'permissive',
  llama3: 'permissive',
  'llama3.1': 'permissive',
  'llama3.2': 'permissive',
  'llama3.3': 'permissive',
  llama4: 'permissive',
  'LLAMA 3.2 COMMUNITY LICENSE AGREEMENT': 'permissive',
  gemma: 'permissive',
  'Gemma Terms of Use': 'permissive',
  qwen: 'permissive',
  deepseek: 'permissive',
  'nvidia-open-model': 'permissive',
  'NVIDIA Open Model License': 'permissive',
  'openrail-m': 'permissive',
  'openrail++': 'permissive',
  'creativeml-openrail-m': 'permissive',
  'bigscience-bloom-rail-1.0': 'permissive',
  'Apache-2.0': 'permissive',
  'apache-2.0': 'permissive',
  'Apache License Version 2.0, January 2004': 'permissive',
  MIT: 'permissive',
  'MIT License': 'permissive',
  'BSD-3-Clause': 'permissive',
  'CC-BY-4.0': 'permissive',
  'cc-by-sa-4.0': 'permissive',
  'GPL-3.0': 'permissive',
  unknown: 'unknown',
  other: 'unknown',
  '': 'unknown',
  'Some Custom License v1': 'unknown',
  'Disclaimer: use at your own risk': 'unknown',
};

test('license classification covers every id the agent emits', () => {
  for (const [id, want] of Object.entries(LICENSES)) assert.equal(licenseClass({ id }), want, id);
  assert.equal(licenseClass(undefined), 'unknown');
});

test('uncensored variants are matched by name', () => {
  for (const id of ['huihui_ai/qwen3.5-abliterated:35b-a3b', 'hf.co/mradermacher/gemma-4-26B-A4B-it-heretic-GGUF:Q6_K', 'dolphin-uncensored:8b', 'Llama-3-8B-Uncensored']) {
    assert.ok(BANNED_MODEL.test(id), id);
  }
  for (const id of ['qwen3.5:35b-a3b', 'gemma4:26b', 'glm-4.7-flash']) assert.ok(!BANNED_MODEL.test(id), id);
});

test('suggested prices rise with size and kind', () => {
  const emb = marketPrice({ kind: 'embedding', params_b: 0.6 });
  const small = marketPrice({ kind: 'chat', params_b: 3 });
  const large = marketPrice({ kind: 'chat', params_b: 35, quant: 'Q4_K_M' });
  assert.ok(emb.in_per_m < small.in_per_m && small.out_per_m < large.out_per_m);
  assert.deepEqual(marketPrice({ kind: 'decision' }), { per_call: 20 });
  assert.equal(paramsB({ model_id: 'qwen2.5:7b' }), 7);
  assert.equal(paramsB({ model_id: 'x', size_bytes: 4.5e9, quant: 'Q4_K_M' }), 7.9);
});
