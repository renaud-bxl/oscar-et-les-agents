#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:4850';
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const missionIdSchema = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' };

export const TOOLS = [
  {
    name: 'oscar_status',
    description: 'Lire l’état de l’Atelier des agents, les fournisseurs disponibles et les missions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readAnnotations,
  },
  {
    name: 'oscar_start_mission',
    description: 'Confier une mission à Oscar. Oscar coordonne recherche, rédaction, code, design et analyse, puis vérifie les livrables. Retourne immédiatement un identifiant ; consulter ensuite oscar_read_mission. Les fournisseurs codex et claude lancent les outils locaux installés et peuvent créer des fichiers ; demo simule une mission.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 16000, description: 'La mission à réaliser.' },
        provider: { type: 'string', enum: ['codex', 'claude', 'demo'] },
      },
      required: ['prompt', 'provider'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'oscar_read_mission',
    description: 'Lire l’avancement d’une mission, les échanges des agents, la validation d’Oscar et la liste des livrables.',
    inputSchema: { type: 'object', properties: { missionId: missionIdSchema }, required: ['missionId'], additionalProperties: false },
    annotations: readAnnotations,
  },
  {
    name: 'oscar_stop_mission',
    description: 'Arrêter les agents d’une mission. Le travail en cours peut rester incomplet ; les fichiers déjà produits sont conservés.',
    inputSchema: { type: 'object', properties: { missionId: missionIdSchema }, required: ['missionId'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'oscar_read_deliverable',
    description: 'Lire un livrable texte de 256 Kio au maximum. Utiliser le chemin relatif indiqué par oscar_read_mission.',
    inputSchema: {
      type: 'object',
      properties: { missionId: missionIdSchema, path: { type: 'string', minLength: 1, maxLength: 1024 } },
      required: ['missionId', 'path'], additionalProperties: false,
    },
    annotations: readAnnotations,
  },
];

class ToolError extends Error {}

export function normalizeServerURL(value = DEFAULT_URL) {
  let url;
  try { url = new URL(value); } catch { throw new Error('ATELIER_URL doit être une URL HTTP locale valide.'); }
  const host = url.hostname;
  const ipv4 = host.split('.');
  const isLoopback = host === 'localhost' || (ipv4.length === 4 && ipv4[0] === '127' && ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255));
  if (url.protocol !== 'http:' || !isLoopback || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ATELIER_URL doit désigner uniquement un serveur HTTP local sur localhost ou 127.0.0.0/8, sans identifiants ni chemin.');
  }
  return url.origin;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
const formatPayload = (payload) => typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

function validateArguments(name, args) {
  if (!isObject(args)) throw new ToolError('Les arguments doivent former un objet JSON.');
  const allowed = name === 'oscar_status' ? [] : name === 'oscar_start_mission' ? ['prompt', 'provider'] : name === 'oscar_read_deliverable' ? ['missionId', 'path'] : ['missionId'];
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new ToolError('Un argument fourni n’est pas reconnu.');
  if (name === 'oscar_start_mission') {
    if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 16000) throw new ToolError('La mission doit contenir entre 1 et 16 000 caractères.');
    if (!['codex', 'claude', 'demo'].includes(args.provider)) throw new ToolError('Le fournisseur doit être codex, claude ou demo.');
  } else if (name !== 'oscar_status') {
    if (typeof args.missionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(args.missionId)) throw new ToolError('L’identifiant de mission est invalide.');
  }
  if (name === 'oscar_read_deliverable') {
    if (typeof args.path !== 'string' || !args.path || args.path.length > 1024 || /[\u0000-\u001f\\]/.test(args.path) || args.path.split('/').some((part) => !part || part === '.' || part === '..') || /^[A-Za-z]:/.test(args.path)) {
      throw new ToolError('Le chemin doit être relatif à la mission, sans remontée de dossier.');
    }
  }
}

async function readLimitedResponse(response, maxBytes) {
  const announcedSize = Number(response.headers?.get('content-length'));
  if (Number.isFinite(announcedSize) && announcedSize > maxBytes) {
    await response.body?.cancel?.();
    throw new ToolError('La réponse du serveur dépasse la taille autorisée.');
  }
  const chunks = [];
  let size = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new ToolError('La réponse du serveur dépasse la taille autorisée.');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  } else {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.byteLength > maxBytes) throw new ToolError('La réponse du serveur dépasse la taille autorisée.');
    chunks.push(value);
    size = value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ToolError('La réponse n’est pas un texte UTF-8 valide.'); }
}

export function createHandler({ fetchImpl = globalThis.fetch, url = process.env.ATELIER_URL || DEFAULT_URL, timeoutMs = 10000 } = {}) {
  const baseURL = normalizeServerURL(url);

  async function requestAPI(path, { method = 'GET', body } = {}) {
    let response;
    let raw;
    try {
      response = await fetchImpl(`${baseURL}${path}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' } : { Accept: 'application/json, text/plain' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      raw = await readLimitedResponse(response, MAX_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new ToolError('Le serveur local n’a pas répondu dans le délai prévu.');
      throw new ToolError('Impossible de joindre l’Atelier des agents. Lancez le serveur local avant de réessayer.');
    }
    let payload = raw;
    try { payload = JSON.parse(raw); } catch { /* Text file responses need no JSON wrapper. */ }
    if (!response.ok) {
      const detail = isObject(payload) && typeof payload.error === 'string' ? payload.error.slice(0, 500) : '';
      throw new ToolError(`Le serveur local a refusé la demande (HTTP ${response.status}).${detail ? ` ${detail}` : ''}`);
    }
    return { payload, raw, contentType: response.headers?.get('content-type') || '' };
  }

  async function callTool(name, args) {
    validateArguments(name, args);
    if (name === 'oscar_status') return formatPayload((await requestAPI('/api/state')).payload);
    if (name === 'oscar_start_mission') return formatPayload((await requestAPI('/api/missions', { method: 'POST', body: { prompt: args.prompt, provider: args.provider } })).payload);
    const missionPath = `/api/missions/${encodeURIComponent(args.missionId)}`;
    if (name === 'oscar_read_mission') return formatPayload((await requestAPI(missionPath)).payload);
    if (name === 'oscar_stop_mission') return formatPayload((await requestAPI(`${missionPath}/stop`, { method: 'POST', body: {} })).payload);
    const encodedPath = args.path.split('/').map(encodeURIComponent).join('/');
    const { payload, raw, contentType } = await requestAPI(`${missionPath}/files/${encodedPath}`);
    if (contentType && !/^(?:text\/[a-z0-9.+-]+|application\/(?:json|javascript|xml|x-yaml|yaml|toml))(?:\s*;|$)/i.test(contentType)) throw new ToolError('Ce livrable ne peut pas être lu comme un fichier texte.');
    const text = isObject(payload) && typeof payload.content === 'string' ? payload.content : isObject(payload) && typeof payload.text === 'string' ? payload.text : raw;
    if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new ToolError('Le livrable dépasse la limite de 256 Kio.');
    if (text.includes('\0')) throw new ToolError('Ce livrable contient des données binaires et ne peut pas être lu comme du texte.');
    return text;
  }

  return async function handle(request) {
    const id = isObject(request) && Object.hasOwn(request, 'id') ? request.id : null;
    if (!isObject(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (id !== null && typeof id !== 'string' && typeof id !== 'number') || (Object.hasOwn(request, 'params') && !isObject(request.params))) {
      return rpcError(typeof id === 'string' || typeof id === 'number' ? id : null, -32600, 'Requête JSON-RPC invalide.');
    }
    if (!Object.hasOwn(request, 'id')) return null;
    const params = request.params || {};
    if (request.method === 'initialize') {
      if (typeof params.protocolVersion !== 'string') return rpcError(id, -32602, 'La version du protocole MCP est requise.');
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'oscar-et-les-agents', version: '0.5.0' },
          instructions: 'Oscar dirige une équipe de cinq spécialistes. Démarrez une mission puis consultez son avancement et ses livrables. Le serveur de l’Atelier doit être lancé sur cet ordinateur.',
        },
      };
    }
    if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    if (request.method !== 'tools/call') return rpcError(id, -32601, 'Méthode MCP inconnue.');
    if (typeof params.name !== 'string' || !TOOLS.some((tool) => tool.name === params.name)) return rpcError(id, -32602, 'Outil MCP inconnu.');
    try {
      const result = textResult(await callTool(params.name, params.arguments === undefined ? {} : params.arguments));
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return { jsonrpc: '2.0', id, result: textResult(error instanceof ToolError ? error.message : 'Une erreur locale a empêché l’exécution de cet outil.', true) };
    }
  };
}

export async function handleRequest(request, options = {}) {
  return createHandler(options)(request);
}

export async function main({ input = process.stdin, output = process.stdout, errorOutput = process.stderr, ...options } = {}) {
  let handle;
  try { handle = createHandler(options); }
  catch (error) { errorOutput.write(`${error.message}\n`); process.exitCode = 1; return; }
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); }
    catch { output.write(`${JSON.stringify(rpcError(null, -32700, 'JSON invalide.'))}\n`); continue; }
    let response;
    try { response = await handle(request); }
    catch { response = rpcError(isObject(request) ? request.id ?? null : null, -32603, 'Erreur interne du serveur MCP.'); }
    if (response !== null) output.write(`${JSON.stringify(response)}\n`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => { process.stderr.write('Le serveur MCP a rencontré une erreur locale.\n'); process.exitCode = 1; });
}
