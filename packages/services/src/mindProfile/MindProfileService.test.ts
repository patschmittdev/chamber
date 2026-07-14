import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MindProfileService } from './MindProfileService';
import { IdentityLoader } from '../chat/IdentityLoader';
import type { AvatarNormalizer, MindProfileMindProvider } from './types';

describe('MindProfileService', () => {
  it('reads local profile files and avatar data', () => {
    const { root, service } = createProfileFixture();
    try {
      fs.mkdirSync(path.join(root, '.chamber'), { recursive: true });
      fs.writeFileSync(path.join(root, '.chamber', 'avatar.png'), Buffer.from('avatar'));

      const profile = service.getProfile('mind-1');

      expect(profile.displayName).toBe('Moneypenny');
      expect(profile.soul.content).toContain('# Moneypenny');
      expect(profile.agentFiles[0]?.relativePath).toBe(path.join('.github', 'agents', 'moneypenny.agent.md'));
      expect(profile.avatarDataUrl).toContain('data:image/png;base64');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rolls back a save that would make SOUL.md invalid', async () => {
    const { root, service } = createProfileFixture();
    try {
      const profile = service.getProfile('mind-1');

      const result = await service.saveFile({
        mindId: 'mind-1',
        kind: 'soul',
        relativePath: 'SOUL.md',
        content: 'no heading',
        expectedMtimeMs: profile.soul.mtimeMs,
      });

      expect(result.success).toBe(false);
      expect(fs.readFileSync(path.join(root, 'SOUL.md'), 'utf-8')).toContain('# Moneypenny');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects profile paths that escape the editable agent directory', async () => {
    const { root, service } = createProfileFixture();
    try {
      const result = await service.saveFile({
        mindId: 'mind-1',
        kind: 'agent',
        relativePath: '.github\\agents\\..\\..\\.working-memory\\outside.agent.md',
        content: '# Outside',
        expectedMtimeMs: null,
      });

      if (result.success) throw new Error('Expected path escape save to fail');
      expect(result.error).toContain('editable profile directory');
      expect(fs.existsSync(path.join(root, '.working-memory', 'outside.agent.md'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects directory junctions on the agents path', async () => {
    // Directory junctions do not require Administrator or Developer Mode on Windows,
    // making this the reliable core assertion for the symlink-rejection invariant on all OSes.
    const { root, service } = createProfileFixture();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-profile-outside-agents-'));
    try {
      const outsideFile = path.join(outsideDir, 'outside.agent.md');
      fs.writeFileSync(outsideFile, '# Outside\n');

      // Replace the .github/agents directory with a junction pointing outside the mind root.
      const agentsDir = path.join(root, '.github', 'agents');
      fs.rmSync(agentsDir, { recursive: true });
      // 'junction' is an NTFS directory junction on Windows (no privilege needed);
      // on Linux/macOS it creates a regular directory symlink (also no privilege needed).
      fs.symlinkSync(outsideDir, agentsDir, 'junction');

      const result = await service.saveFile({
        mindId: 'mind-1',
        kind: 'agent',
        relativePath: path.join('.github', 'agents', 'outside.agent.md'),
        content: '# Updated\n',
        expectedMtimeMs: fs.lstatSync(outsideFile).mtimeMs,
      });

      if (result.success) throw new Error('Expected junction save to fail');
      expect(result.error).toContain('symlinks');
      expect(fs.readFileSync(outsideFile, 'utf-8')).toBe('# Outside\n');
    } finally {
      // Remove root first so the junction reparse-point is removed before we delete its target.
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects file symlinks on the soul path when privilege is available (supplemental)', async () => {
    // File symlinks require Administrator or Developer Mode on Windows. This test is
    // supplemental: it skips (does not fail) when that privilege is unavailable.
    // The core symlink-rejection invariant is covered by the junction test above.
    const { root, service } = createProfileFixture();
    const outside = path.join(os.tmpdir(), `chamber-profile-outside-${Date.now()}.md`);
    const soulPath = path.join(root, 'SOUL.md');
    fs.writeFileSync(outside, '# Outside\n');
    fs.rmSync(soulPath);
    try {
      fs.symlinkSync(outside, soulPath, 'file');
    } catch {
      // File-symlink privilege unavailable (Windows without Developer Mode / Administrator).
      // The junction test above covers the invariant.
      fs.rmSync(outside, { force: true });
      fs.rmSync(root, { recursive: true, force: true });
      return;
    }

    try {
      const result = await service.saveFile({
        mindId: 'mind-1',
        kind: 'soul',
        relativePath: 'SOUL.md',
        content: '# Updated\n',
        expectedMtimeMs: fs.lstatSync(soulPath).mtimeMs,
      });

      if (result.success) throw new Error('Expected symlink save to fail');
      expect(result.error).toContain('symlinks');
      expect(fs.readFileSync(outside, 'utf-8')).toBe('# Outside\n');
      fs.rmSync(outside, { force: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the injected normalizer for avatar saves', async () => {
    const { root, service, normalizer } = createProfileFixture();
    try {
      await service.saveAvatar('mind-1', path.join(root, 'input.png'), {
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      });

      expect(normalizer.called).toBe(true);
      expect(fs.existsSync(path.join(root, '.chamber', 'avatar.png'))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function createProfileFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-profile-'));
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, '.working-memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SOUL.md'), '# Moneypenny\n\nCalm and precise.');
  fs.writeFileSync(path.join(root, '.github', 'agents', 'moneypenny.agent.md'), '---\nname: Moneypenny\n---\n# Agent\n');
  fs.writeFileSync(path.join(root, '.working-memory', 'memory.md'), 'Memory');

  const provider: MindProfileMindProvider = {
    getMindPath: () => root,
    restartMind: async () => ({}),
  };
  const normalizer: AvatarNormalizer & { called: boolean } = {
    called: false,
    normalize: async ({ outputPath }) => {
      normalizer.called = true;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.from('avatar'));
    },
  };
  return { root, service: new MindProfileService(provider, new IdentityLoader(), normalizer), normalizer };
}
