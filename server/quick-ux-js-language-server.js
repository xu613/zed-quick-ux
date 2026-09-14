const fs = require("fs");
const path = require("path");
const prettier = require("prettier");
const prettierPluginUx = require("prettier-plugin-ux");
const ts = require("typescript");

let rootPath = process.cwd();
let input = Buffer.alloc(0);

const documents = new Map();
const virtualToUri = new Map();
const fileCache = new Map();

function log(message) {
  process.stderr.write(`[quick-ux-js] ${message}\n`);
}

function pathFromUri(uri) {
  if (!uri.startsWith("file://")) {
    return normalizeFileName(path.join(rootPath, `untitled-${encodeURIComponent(uri)}`));
  }

  const url = new URL(uri);
  let filePath = decodeURIComponent(url.pathname);
  if (process.platform === "win32" && /^\/[a-zA-Z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }
  return normalizeFileName(filePath.replace(/\//g, path.sep));
}

function uriFromPath(filePath) {
  let resolved = normalizeFileName(filePath).replace(/\\/g, "/");
  if (!resolved.startsWith("/")) {
    resolved = `/${resolved}`;
  }
  return `file://${encodeURI(resolved).replace(/#/g, "%23")}`;
}

function normalizeFileName(fileName) {
  return path.normalize(fileName);
}

function canonicalFileName(fileName) {
  const normalized = normalizeFileName(fileName);
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

function positionToOffset(text, position) {
  let line = 0;
  let offset = 0;

  while (line < position.line && offset < text.length) {
    const next = text.indexOf("\n", offset);
    if (next === -1) {
      return text.length;
    }
    offset = next + 1;
    line += 1;
  }

  return Math.min(offset + position.character, text.length);
}

function offsetToPosition(text, offset) {
  let line = 0;
  let lineStart = 0;
  const limit = Math.min(offset, text.length);

  for (let i = 0; i < limit; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }

  return { line, character: limit - lineStart };
}

function rangeFromSpan(text, span) {
  return {
    start: offsetToPosition(text, span.start),
    end: offsetToPosition(text, span.start + span.length),
  };
}

function blankLike(text) {
  return text.replace(/[^\r\n]/g, " ");
}

function scriptKindFromAttrs(attrs) {
  const match = /\blang\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
  const lang = match ? match[1].toLowerCase() : "js";

  if (lang === "ts" || lang === "tsx") {
    return "typescript";
  }
  return "javascript";
}

function extractScript(text) {
  const chars = blankLike(text).split("");
  const ranges = [];
  let scriptKind = "javascript";
  const openTag = /<script\b([^>]*)>/gi;
  let match;

  while ((match = openTag.exec(text))) {
    const startTagStart = match.index;
    const contentStart = openTag.lastIndex;
    const closeMatch = /<\/script\s*>/gi;
    closeMatch.lastIndex = contentStart;
    const close = closeMatch.exec(text);
    const contentEnd = close ? close.index : text.length;
    const endTagEnd = close ? closeMatch.lastIndex : text.length;
    const attrs = match[1] || "";

    scriptKind = scriptKindFromAttrs(attrs);
    ranges.push({ start: contentStart, end: contentEnd });

    for (let i = contentStart; i < contentEnd; i += 1) {
      chars[i] = text[i];
    }

    openTag.lastIndex = endTagEnd;

    if (startTagStart === endTagEnd) {
      break;
    }
  }

  return {
    text: chars.join(""),
    ranges,
    scriptKind,
  };
}

function refreshDocument(uri, text, version) {
  const previous = documents.get(uri);
  if (previous) {
    virtualToUri.delete(canonicalFileName(previous.virtualFileName));
  }

  const extracted = extractScript(text);
  const suffix = extracted.scriptKind === "typescript" ? ".ts" : ".js";
  const virtualFileName = normalizeFileName(`${pathFromUri(uri)}${suffix}`);

  documents.set(uri, {
    uri,
    text,
    version: String(version || 0),
    virtualText: extracted.text,
    virtualFileName,
    scriptRanges: extracted.ranges,
    scriptKind: extracted.scriptKind,
  });
  virtualToUri.set(canonicalFileName(virtualFileName), uri);
  fileCache.clear();
}

function documentAt(uri) {
  return documents.get(uri);
}

function isInsideScript(document, offset) {
  return document.scriptRanges.some((range) => offset >= range.start && offset <= range.end);
}

function readFile(fileName) {
  const normalized = normalizeFileName(fileName);
  const canonical = canonicalFileName(fileName);
  const documentUri = virtualToUri.get(canonical);
  if (documentUri) {
    return documentAt(documentUri).virtualText;
  }

  if (fileCache.has(canonical)) {
    return fileCache.get(canonical);
  }

  try {
    const content = fs.readFileSync(normalized, "utf8");
    fileCache.set(canonical, content);
    return content;
  } catch {
    return undefined;
  }
}

function scriptSnapshot(fileName) {
  const content = readFile(fileName);
  return content == null ? undefined : ts.ScriptSnapshot.fromString(content);
}

function scriptVersion(fileName) {
  const documentUri = virtualToUri.get(canonicalFileName(fileName));
  if (documentUri) {
    return documentAt(documentUri).version;
  }
  return "0";
}

const compilerOptions = {
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  target: ts.ScriptTarget.ES2020,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  skipLibCheck: true,
};

const serviceHost = {
  getCompilationSettings: () => compilerOptions,
  getCurrentDirectory: () => rootPath,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  getScriptFileNames: () => Array.from(documents.values()).map((document) => document.virtualFileName),
  getScriptKind: (fileName) => {
    if (fileName.endsWith(".ts")) return ts.ScriptKind.TS;
    if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
    if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
    return ts.ScriptKind.JS;
  },
  getScriptSnapshot: scriptSnapshot,
  getScriptVersion: scriptVersion,
  readFile,
  fileExists: (fileName) => readFile(fileName) != null,
  directoryExists: (dirName) => fs.existsSync(dirName) && fs.statSync(dirName).isDirectory(),
  getDirectories: (dirName) => {
    try {
      return fs.readdirSync(dirName).filter((entry) => fs.statSync(path.join(dirName, entry)).isDirectory());
    } catch {
      return [];
    }
  },
  readDirectory: ts.sys.readDirectory,
  realpath: ts.sys.realpath,
  useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  getCanonicalFileName: canonicalFileName,
};

const languageService = ts.createLanguageService(serviceHost, ts.createDocumentRegistry());

function hasSourceFile(fileName) {
  const program = languageService.getProgram();
  return Boolean(program && program.getSourceFile(fileName));
}

function completionKind(kind) {
  switch (kind) {
    case ts.ScriptElementKind.classElement:
    case ts.ScriptElementKind.interfaceElement:
    case ts.ScriptElementKind.typeElement:
      return 7;
    case ts.ScriptElementKind.memberFunctionElement:
    case ts.ScriptElementKind.functionElement:
      return 3;
    case ts.ScriptElementKind.memberVariableElement:
    case ts.ScriptElementKind.constElement:
    case ts.ScriptElementKind.letElement:
    case ts.ScriptElementKind.variableElement:
      return 6;
    case ts.ScriptElementKind.keyword:
      return 14;
    case ts.ScriptElementKind.string:
      return 1;
    default:
      return 10;
  }
}

function completion(params) {
  const doc = documentAt(params.textDocument.uri);
  if (!doc) return null;

  const offset = positionToOffset(doc.text, params.position);
  if (!isInsideScript(doc, offset)) return { isIncomplete: false, items: [] };
  if (!hasSourceFile(doc.virtualFileName)) return { isIncomplete: false, items: [] };

  let result;
  try {
    result = languageService.getCompletionsAtPosition(doc.virtualFileName, offset, {
      includeCompletionsForImportStatements: true,
      includeCompletionsWithInsertText: true,
      includeExternalModuleExports: true,
    });
  } catch (error) {
    log(error.stack || String(error));
    return { isIncomplete: false, items: [] };
  }

  return {
    isIncomplete: false,
    items: (result?.entries || []).map((entry) => ({
      label: entry.name,
      kind: completionKind(entry.kind),
      detail: entry.kind,
      sortText: entry.sortText,
    })),
  };
}

function definition(params) {
  const doc = documentAt(params.textDocument.uri);
  if (!doc) return null;

  const offset = positionToOffset(doc.text, params.position);
  if (!isInsideScript(doc, offset)) return null;
  if (!hasSourceFile(doc.virtualFileName)) return null;

  let definitions;
  try {
    definitions = languageService.getDefinitionAtPosition(doc.virtualFileName, offset) || [];
  } catch (error) {
    log(error.stack || String(error));
    return null;
  }

  return definitions.map((definitionInfo) => {
    const canonical = canonicalFileName(definitionInfo.fileName);
    const targetUri = virtualToUri.get(canonical) || uriFromPath(definitionInfo.fileName);
    const targetText = virtualToUri.has(canonical)
      ? documentAt(targetUri).text
      : readFile(definitionInfo.fileName) || "";

    return {
      uri: targetUri,
      range: rangeFromSpan(targetText, definitionInfo.textSpan),
    };
  });
}

function hover(params) {
  const doc = documentAt(params.textDocument.uri);
  if (!doc) return null;

  const offset = positionToOffset(doc.text, params.position);
  if (!isInsideScript(doc, offset)) return null;
  if (!hasSourceFile(doc.virtualFileName)) return null;

  let info;
  try {
    info = languageService.getQuickInfoAtPosition(doc.virtualFileName, offset);
  } catch (error) {
    log(error.stack || String(error));
    return null;
  }
  if (!info) return null;

  const display = ts.displayPartsToString(info.displayParts || []);
  const documentation = ts.displayPartsToString(info.documentation || []);

  return {
    contents: {
      kind: "markdown",
      value: documentation ? `\`\`\`ts\n${display}\n\`\`\`\n${documentation}` : `\`\`\`ts\n${display}\n\`\`\``,
    },
    range: rangeFromSpan(doc.text, info.textSpan),
  };
}

async function formatting(params) {
  const doc = documentAt(params.textDocument.uri);
  if (!doc) return null;

  const filePath = pathFromUri(doc.uri);
  const editorOptions = params.options || {};
  const config = (await prettier.resolveConfig(filePath)) || {};
  const formatted = await prettier.format(doc.text, {
    tabWidth: editorOptions.tabSize || 2,
    useTabs: editorOptions.insertSpaces === false,
    ...config,
    filepath: filePath,
    parser: "vue",
    plugins: [prettierPluginUx],
  });

  if (formatted === doc.text) return [];

  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: offsetToPosition(doc.text, doc.text.length),
      },
      newText: formatted,
    },
  ];
}

function applyChange(text, change) {
  if (!change.range) {
    return change.text;
  }

  const start = positionToOffset(text, change.range.start);
  const end = positionToOffset(text, change.range.end);
  return `${text.slice(0, start)}${change.text}${text.slice(end)}`;
}

function handleNotification(method, params) {
  if (method === "textDocument/didOpen") {
    refreshDocument(params.textDocument.uri, params.textDocument.text, params.textDocument.version);
  } else if (method === "textDocument/didChange") {
    const current = documentAt(params.textDocument.uri);
    const changes = params.contentChanges || [];
    if (current) {
      const nextText = changes.reduce((text, change) => applyChange(text, change), current.text);
      refreshDocument(params.textDocument.uri, nextText, params.textDocument.version);
    } else if (changes.length > 0 && typeof changes[0].text === "string" && !changes[0].range) {
      refreshDocument(params.textDocument.uri, changes[0].text, params.textDocument.version);
    } else {
      refreshDocument(params.textDocument.uri, "", params.textDocument.version);
    }
  } else if (method === "textDocument/didClose") {
    const doc = documentAt(params.textDocument.uri);
    if (doc) {
      virtualToUri.delete(canonicalFileName(doc.virtualFileName));
      documents.delete(params.textDocument.uri);
    }
  }
}

function handleRequest(method, params) {
  switch (method) {
    case "initialize":
      if (params.rootUri) rootPath = pathFromUri(params.rootUri);
      return {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: {
            resolveProvider: false,
            triggerCharacters: [".", "'", "\"", "/", "@", "_", "$"],
          },
          definitionProvider: true,
          documentFormattingProvider: true,
          hoverProvider: true,
        },
      };
    case "shutdown":
      return null;
    case "textDocument/completion":
      return completion(params);
    case "textDocument/definition":
      return definition(params);
    case "textDocument/hover":
      return hover(params);
    case "textDocument/formatting":
      return formatting(params);
    default:
      return null;
  }
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function sendResponse(id, result, error) {
  if (error) {
    send({ jsonrpc: "2.0", id, error });
  } else {
    send({ jsonrpc: "2.0", id, result });
  }
}

async function processMessage(message) {
  if (message.id !== undefined) {
    try {
      sendResponse(message.id, await handleRequest(message.method, message.params || {}));
    } catch (error) {
      log(error.stack || String(error));
      sendResponse(message.id, null, { code: -32603, message: String(error.message || error) });
    }
  } else {
    try {
      handleNotification(message.method, message.params || {});
    } catch (error) {
      log(error.stack || String(error));
    }
  }
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);

  while (true) {
    const headerEnd = input.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = input.slice(0, headerEnd).toString("ascii");
    const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
    if (!lengthMatch) {
      input = input.slice(headerEnd + 4);
      continue;
    }

    const length = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (input.length < bodyEnd) return;

    const body = input.slice(bodyStart, bodyEnd).toString("utf8");
    input = input.slice(bodyEnd);
    void processMessage(JSON.parse(body));
  }
});

process.on("uncaughtException", (error) => {
  log(error.stack || String(error));
});
