import test from 'node:test';
import assert from 'node:assert/strict';
import { editToml, normalizeTableName, readTopLevelString, renderTable, tableName } from '../src/toml-edit.mjs';

const ORIGINAL = `# my codex config
model = "o3"   # old default
approval_policy = "on-request"

[model_providers.latentide]
name = "old"
base_url = "https://old.example"

# keep me
[mcp_servers.docs]
command = "npx"
args = ["-y", "docs"]
`;

test('top-level keys are replaced in place and new ones inserted before the first table', () => {
  const out = editToml(ORIGINAL, { topLevel: { model: 'gpt-6.1-sol', model_provider: 'latentide' } });
  assert.equal(readTopLevelString(out, 'model'), 'gpt-6.1-sol');
  assert.equal(readTopLevelString(out, 'model_provider'), 'latentide');
  assert.ok(out.startsWith('# my codex config\nmodel = "gpt-6.1-sol"\napproval_policy = "on-request"\nmodel_provider = "latentide"\n'));
});

test('our table is replaced while comments and other tables survive', () => {
  const table = renderTable(tableName('model_providers', 'latentide'), { name: 'Latentide', base_url: 'https://api.latentide.com' });
  const out = editToml(ORIGINAL, { removeTables: (name) => name === 'model_providers.latentide', appendTables: [table] });
  assert.ok(!out.includes('https://old.example'));
  assert.ok(out.includes('# keep me\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs"]'));
  assert.ok(out.trimEnd().endsWith('[model_providers.latentide]\nname = "Latentide"\nbase_url = "https://api.latentide.com"'));
});

test('editing twice gives the same result', () => {
  const edit = { topLevel: { model: 'x' }, removeTables: (name) => name === 'model_providers.latentide', appendTables: [renderTable('model_providers.latentide', { name: 'L' })] };
  const once = editToml(ORIGINAL, edit);
  assert.equal(editToml(once, edit), once);
});

test('quoted table names with dots are recognised', () => {
  assert.equal(normalizeTableName('models."latentide/glm-5.3"'), 'models.latentide/glm-5.3');
  assert.equal(normalizeTableName(' models . "a.b" '), 'models.a.b');
  assert.equal(tableName('models', 'latentide/glm-5.3'), 'models."latentide/glm-5.3"');
  const text = `default_model = "latentide/glm-5.3"\n\n[models."latentide/glm-5.3"]\nprovider = "latentide-openai"\n\n[models.kimi]\nprovider = "kimi"\n`;
  const out = editToml(text, { removeTables: (name) => name.startsWith('models.latentide/') });
  assert.ok(!out.includes('latentide-openai'));
  assert.ok(out.includes('[models.kimi]'));
});

test('an empty file gets just our content', () => {
  const out = editToml('', { topLevel: { model: 'm' }, appendTables: ['[t]\na = 1'] });
  assert.equal(out, 'model = "m"\n\n[t]\na = 1\n');
});
