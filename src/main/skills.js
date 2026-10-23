'use strict';

const fs = require('fs');
const path = require('path');
const { SKILLS_DIR } = require('./config');

const MAX_SKILL_CONTENT = 40000;

function ensureSkillsDir() {
  try {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function parseFrontmatter(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { meta: {}, body: normalized };
  }
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: normalized };
  const raw = normalized.slice(4, end);
  const meta = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta, body: normalized.slice(end + 4).replace(/^\n+/, '') };
}

function describe(body) {
  const lines = String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#') && !line.startsWith('```') && !line.startsWith('---'));
  const text = lines.join(' ');
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function candidateFiles() {
  ensureSkillsDir();
  let entries = [];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(SKILLS_DIR, entry.name);
    if (entry.isDirectory()) {
      const skillFile = path.join(full, 'SKILL.md');
      if (fs.existsSync(skillFile)) files.push({ file: skillFile, fallbackName: entry.name });
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      files.push({ file: full, fallbackName: entry.name.replace(/\.md$/i, '') });
    }
  }
  return files;
}

function listSkills() {
  const skills = [];
  for (const { file, fallbackName } of candidateFiles()) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const { meta, body } = parseFrontmatter(text);
    const name = String(meta.name || fallbackName).trim();
    if (!name) continue;
    skills.push({
      name,
      description: String(meta.description || describe(body) || '').trim(),
      path: file
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function readSkill(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  for (const { file, fallbackName } of candidateFiles()) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const { meta, body } = parseFrontmatter(text);
    const skillName = String(meta.name || fallbackName).trim();
    if (skillName.toLowerCase() !== target) continue;
    const content = body.length > MAX_SKILL_CONTENT ? `${body.slice(0, MAX_SKILL_CONTENT)}\n\n…（技能内容已截断）` : body;
    return {
      name: skillName,
      description: String(meta.description || describe(body) || '').trim(),
      content,
      path: file
    };
  }
  return null;
}

module.exports = { SKILLS_DIR, listSkills, readSkill };
