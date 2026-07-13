import { constants as fsConstants, type Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type {
  ManagedSkillDetails,
  SkillDetail,
  SkillFileReference,
  SkillManifest,
  SkillMarketplaceSourceDetails,
  SkillValidationError,
} from '@chamber/shared/types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { parseSkillFrontmatter } from '@chamber/shared/skill-authoring';
import { Logger } from '../logger';

export const MAX_SKILL_DIRECTORIES = 256;
export const MAX_SKILL_MARKDOWN_BYTES = 512_000;
export const MAX_MANAGED_SKILL_METADATA_BYTES = 64_000;

const SKILL_MARKDOWN_FILENAME = 'SKILL.md';
const MANAGED_SKILL_METADATA_FILENAME = '.chamber-skill.json';
const OPEN_READ_NOFOLLOW_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
const LOCAL_CORE_SKILL_IDS = new Set(['lens', 'automation', 'ttasks']);
const log = Logger.create('MindSkillDiscovery');

/**
 * Reads self-declared display metadata from skill directories on disk.
 *
 * This service does not invoke skills, modify them, or establish managed-skill
 * provenance, integrity, installation, or update state.
 */
export class MindSkillDiscovery {
  /**
   * Lists at most 256 direct skill directories in stable directory-id order.
   * Missing or unreadable SKILL.md files fall back to the directory id.
   */
  async list(mindPath: string): Promise<SkillManifest[]> {
    return (await this.listDetails(mindPath)).map(({ id, name, version, description }) => ({
      id,
      name,
      ...(version ? { version } : {}),
      ...(description ? { description } : {}),
    }));
  }

  /**
   * Lists untrusted skill display details without executing or mutating skills.
   */
  async listDetails(mindPath: string): Promise<SkillDetail[]> {
    const skillsDir = path.join(mindPath, '.github', 'skills');
    const resolvedSkillsDir = await resolveSkillsDirectory(mindPath, skillsDir);
    if (!resolvedSkillsDir) return [];

    let entries: Dirent[];
    try {
      entries = await fs.readdir(resolvedSkillsDir, { withFileTypes: true });
    } catch (error) {
      logReadFailure(`skills directory ${resolvedSkillsDir}`, error);
      return [];
    }

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareText(left.name, right.name));

    if (directories.length > MAX_SKILL_DIRECTORIES) {
      log.warn(
        `Found ${directories.length} skill directories in ${resolvedSkillsDir}; `
        + `listing the first ${MAX_SKILL_DIRECTORIES} in stable directory-id order. `
        + 'The remaining directories were not inspected.',
      );
    }

    const skills: SkillDetail[] = [];
    for (const entry of directories.slice(0, MAX_SKILL_DIRECTORIES)) {
      const manifest = await readSkillDetail(resolvedSkillsDir, entry.name);
      if (manifest) skills.push(manifest);
    }
    return skills;
  }
}

interface ParsedFrontmatter {
  name: string;
  version?: string;
  description?: string;
}

async function resolveSkillsDirectory(mindPath: string, skillsDir: string): Promise<string | null> {
  try {
    const [resolvedMindPath, skillsStat] = await Promise.all([
      fs.realpath(mindPath),
      fs.lstat(skillsDir),
    ]);
    if (!skillsStat.isDirectory() || skillsStat.isSymbolicLink()) {
      log.warn(`Skills path ${skillsDir} is not a direct directory`);
      return null;
    }

    const resolvedSkillsDir = await fs.realpath(skillsDir);
    if (!isWithin(resolvedMindPath, resolvedSkillsDir)) {
      log.warn(`Skills directory ${skillsDir} resolves outside the mind directory`);
      return null;
    }
    return resolvedSkillsDir;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      logReadFailure(`skills directory ${skillsDir}`, error);
    }
    return null;
  }
}

async function readSkillDetail(
  resolvedSkillsDir: string,
  id: string,
): Promise<SkillDetail | null> {
  const skillDir = path.join(resolvedSkillsDir, id);
  let resolvedSkillDir: string;
  try {
    const skillDirStat = await fs.lstat(skillDir);
    if (!skillDirStat.isDirectory() || skillDirStat.isSymbolicLink()) {
      log.warn(`Skill path ${skillDir} is not a direct directory`);
      return null;
    }
    resolvedSkillDir = await fs.realpath(skillDir);
    if (path.dirname(resolvedSkillDir) !== resolvedSkillsDir) {
      log.warn(`Skill directory ${skillDir} resolves outside the skills directory`);
      return null;
    }
  } catch (error) {
    logReadFailure(`skill directory ${skillDir}`, error);
    return null;
  }

  const relativeDirectory = posixSkillPath(id);
  const manifestPath = path.posix.join(relativeDirectory, SKILL_MARKDOWN_FILENAME);
  const metadataPath = path.posix.join(relativeDirectory, MANAGED_SKILL_METADATA_FILENAME);
  const validationErrors: SkillValidationError[] = [];

  const raw = await readSkillMarkdown(resolvedSkillDir);
  if (raw.status !== 'ok') {
    validationErrors.push({ path: manifestPath, message: raw.message });
  }

  const parsed = raw.status === 'ok' ? parseFrontmatter(raw.content) : { name: '' };
  const managed = await readManagedSkillDetails(resolvedSkillDir, metadataPath, id, validationErrors);
  const isCore = LOCAL_CORE_SKILL_IDS.has(id);
  const requiredFiles = managed?.files ?? [{
    path: SKILL_MARKDOWN_FILENAME,
    status: localFileStatus(raw.status),
  } satisfies SkillFileReference];
  return {
    id,
    name: parsed.name || id,
    ...(parsed.version ? { version: parsed.version } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    source: {
      type: 'local',
      directory: relativeDirectory,
      manifestPath,
      ...(managed ? { metadataPath } : {}),
    },
    isCore,
    isManaged: managed !== undefined && isCore,
    requiredFiles,
    capabilities: managed?.capabilities ?? [],
    ...(managed ? { managed } : {}),
    validationErrors,
  };
}

async function readSkillMarkdown(resolvedSkillDir: string): Promise<BoundedReadResult> {
  return readBoundedLocalFile(resolvedSkillDir, SKILL_MARKDOWN_FILENAME, MAX_SKILL_MARKDOWN_BYTES);
}

async function readManagedSkillDetails(
  resolvedSkillDir: string,
  metadataPath: string,
  expectedName: string,
  validationErrors: SkillValidationError[],
): Promise<ManagedSkillDetails | undefined> {
  const metadata = await readBoundedLocalFile(
    resolvedSkillDir,
    MANAGED_SKILL_METADATA_FILENAME,
    MAX_MANAGED_SKILL_METADATA_BYTES,
  );
  if (metadata.status === 'missing') return undefined;
  if (metadata.status !== 'ok') {
    validationErrors.push({ path: metadataPath, message: metadata.message });
    return undefined;
  }

  try {
    const parsed = parseManagedSkillMetadata(JSON.parse(metadata.content), expectedName);
    const files = await Promise.all(parsed.files.map((file) => managedFileReference(resolvedSkillDir, file.path)));
    for (const file of files) {
      if (file.status !== 'present') {
        validationErrors.push({
          path: path.posix.join(posixSkillPath(expectedName), file.path),
          message: `Managed file is ${file.status}: ${file.path}`,
        });
      }
    }
    return {
      version: parsed.version,
      capabilities: parsed.capabilities,
      metadataPath,
      files,
      ...(parsed.source ? { source: parsed.source } : {}),
    };
  } catch (error) {
    validationErrors.push({
      path: metadataPath,
      message: `Managed metadata is invalid: ${getErrorMessage(error)}`,
    });
    return undefined;
  }
}

async function readBoundedLocalFile(
  resolvedSkillDir: string,
  fileName: string,
  maxBytes: number,
): Promise<BoundedReadResult> {
  const filePath = path.join(resolvedSkillDir, fileName);
  try {
    const fileStat = await fs.lstat(filePath);
    if (fileStat.isSymbolicLink()) {
      return invalidBoundedRead(`${filePath} cannot be a symbolic link`, `${fileName} cannot be a symbolic link.`);
    }
    if (!fileStat.isFile()) {
      return invalidBoundedRead(`${filePath} is not a regular file`, `${fileName} is not a regular file.`);
    }
    if (fileStat.size > maxBytes) {
      return invalidBoundedRead(`${filePath} exceeds the ${maxBytes} byte limit`, `${fileName} exceeds the ${maxBytes} byte limit.`);
    }

    const resolvedFilePath = await fs.realpath(filePath);
    if (path.dirname(resolvedFilePath) !== resolvedSkillDir) {
      return invalidBoundedRead(`${filePath} resolves outside its skill directory`, `${fileName} resolves outside its skill directory.`);
    }

    const handle = await fs.open(resolvedFilePath, OPEN_READ_NOFOLLOW_FLAGS);
    try {
      const content = await readBoundedUtf8(handle, filePath, maxBytes);
      return content === null
        ? { status: 'invalid', message: `${fileName} could not be read within the byte limit.` }
        : { status: 'ok', content };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      logReadFailure(filePath, error);
      return { status: 'invalid', message: `Failed to read ${fileName}.` };
    }
    return { status: 'missing', message: `${fileName} is missing.` };
  }
}

async function readBoundedUtf8(handle: FileHandle, displayPath: string, maxBytes: number): Promise<string | null> {
  const openedStat = await handle.stat();
  if (!openedStat.isFile()) {
    log.warn(`${displayPath} is not a regular file`);
    return null;
  }
  if (openedStat.size > maxBytes) {
    log.warn(`${displayPath} exceeds the ${maxBytes} byte limit`);
    return null;
  }

  const buffer = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > maxBytes) {
    log.warn(`${displayPath} exceeds the ${maxBytes} byte limit`);
    return null;
  }
  return buffer.subarray(0, offset).toString('utf8');
}

function invalidBoundedRead(logMessage: string, message: string): BoundedReadResult {
  log.warn(logMessage);
  return { status: 'invalid', message };
}

/**
 * Adapts the shared frontmatter parser to the bounded display subset used here.
 */
function parseFrontmatter(raw: string): ParsedFrontmatter {
  const fields = parseSkillFrontmatter(raw);
  if (!fields) return { name: '' };
  const version = fields.version;
  const description = fields.description;
  return {
    name: fields.name ?? '',
    ...(version ? { version } : {}),
    ...(description ? { description } : {}),
  };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length === 0
    || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

function logReadFailure(target: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log.warn(`Failed to read ${target}: ${message}`);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

interface ManagedFileMetadata {
  path: string;
  sha256: string;
}

interface ParsedManagedSkillMetadata {
  version: string;
  capabilities: string[];
  files: ManagedFileMetadata[];
  source?: SkillMarketplaceSourceDetails;
}

type BoundedReadResult =
  | { status: 'ok'; content: string }
  | { status: 'missing'; message: string }
  | { status: 'invalid'; message: string };

function parseManagedSkillMetadata(value: unknown, expectedName: string): ParsedManagedSkillMetadata {
  if (!isRecord(value)) {
    throw new Error('expected a JSON object');
  }
  if (value.managedBy !== 'chamber') {
    throw new Error('managedBy must be chamber');
  }
  if (value.name !== expectedName) {
    throw new Error(`name must match the skill directory id ${expectedName}`);
  }
  if (typeof value.version !== 'string' || value.version.length === 0) {
    throw new Error('version must be a non-empty string');
  }
  const capabilities = readStringArray(value.capabilities, 'capabilities');
  const files = readManagedFiles(value.files);

  return {
    version: value.version,
    capabilities,
    files,
    ...(value.source === undefined ? {} : { source: parseManagedSkillSource(value.source) }),
  };
}

function isManagedFileMetadata(value: unknown): value is ManagedFileMetadata {
  return isRecord(value)
    && typeof value.path === 'string'
    && isManagedSkillRelativePath(value.path)
    && typeof value.sha256 === 'string'
    && value.sha256.length > 0;
}

function parseManagedSkillSource(value: unknown): SkillMarketplaceSourceDetails {
  if (!isRecord(value)) {
    throw new Error('source must be a JSON object');
  }
  const marketplaceId = stringValue(value, 'marketplaceId');
  const marketplaceLabel = stringValue(value, 'marketplaceLabel');
  const marketplaceUrl = stringValue(value, 'marketplaceUrl');
  const owner = stringValue(value, 'owner');
  const repo = stringValue(value, 'repo');
  const ref = stringValue(value, 'ref');
  const plugin = stringValue(value, 'plugin');
  const root = stringValue(value, 'root');
  return { marketplaceId, marketplaceLabel, marketplaceUrl, owner, repo, ref, plugin, root };
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`source.${key} must be a non-empty string`);
  }
  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function readManagedFiles(value: unknown): ManagedFileMetadata[] {
  if (!Array.isArray(value) || value.some((file) => !isManagedFileMetadata(file))) {
    throw new Error('files must contain safe managed file metadata');
  }
  return value;
}

async function managedFileReference(resolvedSkillDir: string, relativePath: string): Promise<SkillFileReference> {
  if (!isManagedSkillRelativePath(relativePath)) {
    return { path: relativePath, status: 'invalid' };
  }
  const filePath = path.join(resolvedSkillDir, ...relativePath.split('/'));
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { path: relativePath, status: 'invalid' };
    }
    const resolvedFilePath = await fs.realpath(filePath);
    if (!isWithin(resolvedSkillDir, resolvedFilePath)) {
      return { path: relativePath, status: 'invalid' };
    }
    return { path: relativePath, status: 'present' };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { path: relativePath, status: 'missing' };
    }
    logReadFailure(filePath, error);
    return { path: relativePath, status: 'invalid' };
  }
}

function isManagedSkillRelativePath(filePath: string): boolean {
  if (filePath.length === 0 || filePath.includes('\\')) return false;
  if (path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) return false;
  const normalized = path.posix.normalize(filePath);
  return normalized === filePath && normalized !== '..' && !normalized.startsWith('../');
}

function posixSkillPath(id: string): string {
  return path.posix.join('.github', 'skills', id);
}

function localFileStatus(status: BoundedReadResult['status']): SkillFileReference['status'] {
  if (status === 'ok') return 'present';
  if (status === 'missing') return 'missing';
  return 'invalid';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
