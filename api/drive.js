const ROOT_FOLDER_ID = "1Q3hAXFsU4QBJxD0DKB_gv9bo8KgXeHUc";
const ROOT_FOLDER_NAME = "BCC 2023.2";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function sendJson(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.json(body);
}

function isValidDriveId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{10,100}$/.test(value);
}

function extractDataset(html, key) {
  const pattern = new RegExp(
    "AF_initDataCallback\\(\\{key:\\s*'" + key.replace(":", "\\:") +
    "',\\s*hash:\\s*'[^']*',\\s*data:(.*?),\\s*sideChannel:\\s*\\{\\}\\}\\);",
    "s"
  );
  const match = html.match(pattern);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function getItemName(item) {
  const direct = item?.[24]?.[2]?.[0]?.[2]?.[1]?.[0]?.[0]?.[0];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const ignored = new Set([
    "Shared folder",
    "Modified",
    "Size not available",
    "Download",
    "More actions",
    "File size",
    "Name",
    "Date modified",
    "New to old",
    "A to Z",
    "Z to A"
  ]);

  const strings = [];
  const walk = value => {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
  };

  walk(item?.[24]);

  return strings.find(value =>
    value.length > 1 &&
    !ignored.has(value) &&
    !value.startsWith("http") &&
    !/^\d{1,2} de [a-zç]+\.?$/i.test(value)
  ) || "Arquivo sem nome";
}

function buildOpenUrl(id, mimeType) {
  if (mimeType === FOLDER_MIME) {
    return "https://drive.google.com/drive/folders/" + encodeURIComponent(id);
  }

  if (mimeType === "application/vnd.google-apps.document") {
    return "https://docs.google.com/document/d/" + encodeURIComponent(id) + "/edit";
  }

  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(id) + "/edit";
  }

  if (mimeType === "application/vnd.google-apps.presentation") {
    return "https://docs.google.com/presentation/d/" + encodeURIComponent(id) + "/edit";
  }

  if (mimeType === "application/vnd.google-apps.drawing") {
    return "https://docs.google.com/drawings/d/" + encodeURIComponent(id) + "/edit";
  }

  return "https://drive.google.com/file/d/" + encodeURIComponent(id) + "/view";
}

function buildDownloadUrl(id, mimeType) {
  if (mimeType === FOLDER_MIME) return null;

  if (mimeType === "application/vnd.google-apps.document") {
    return "https://docs.google.com/document/d/" + encodeURIComponent(id) + "/export?format=pdf";
  }

  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(id) + "/export?format=xlsx";
  }

  if (mimeType === "application/vnd.google-apps.presentation") {
    return "https://docs.google.com/presentation/d/" + encodeURIComponent(id) + "/export/pptx";
  }

  if (mimeType === "application/vnd.google-apps.drawing") {
    return "https://docs.google.com/drawings/d/" + encodeURIComponent(id) + "/export/pdf";
  }

  if (mimeType.startsWith("application/vnd.google-apps.")) return null;

  return "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(id);
}

function fileLabel(mimeType) {
  if (mimeType === FOLDER_MIME) return "Pasta";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "application/vnd.google-apps.document") return "Documento";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "Planilha";
  if (mimeType === "application/vnd.google-apps.presentation") return "Apresentação";
  if (mimeType.startsWith("image/")) return "Imagem";
  if (mimeType.startsWith("video/")) return "Vídeo";
  if (mimeType.startsWith("audio/")) return "Áudio";
  if (mimeType.includes("zip") || mimeType.includes("compressed")) return "Arquivo compactado";
  return "Arquivo";
}

function parseFolderPage(html, fallbackName) {
  const data = extractDataset(html, "ds:4");
  if (!data) throw new Error("Estrutura pública do Google Drive não reconhecida.");

  const titleData = extractDataset(html, "ds:1");
  const title = titleData?.[1]?.[2];
  const folderName = typeof title === "string" && title.trim()
    ? title.trim()
    : fallbackName;

  const byId = new Map();

  const walk = value => {
    if (!Array.isArray(value)) return;

    if (
      Array.isArray(value[0]) &&
      typeof value[0]?.[1] === "string" &&
      typeof value[4] === "string" &&
      value[4].includes("/")
    ) {
      const id = value[0][1];
      const mimeType = value[4];

      if (isValidDriveId(id) && !byId.has(id)) {
        byId.set(id, {
          id,
          name: getItemName(value),
          mimeType,
          type: mimeType === FOLDER_MIME ? "folder" : "file",
          label: fileLabel(mimeType),
          openUrl: buildOpenUrl(id, mimeType),
          downloadUrl: buildDownloadUrl(id, mimeType)
        });
      }
    }

    value.forEach(walk);
  };

  walk(data);

  const items = [...byId.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });

  return { name: folderName, items };
}

async function fetchFolder(folderId, fallbackName = "Conteúdos") {
  const cached = cache.get(folderId);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(
      "https://drive.google.com/drive/folders/" + encodeURIComponent(folderId),
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OrganizaIsso/1.0)",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6"
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error("Google Drive respondeu com status " + response.status + ".");
    }

    const html = await response.text();
    const value = parseFolderPage(html, fallbackName);

    if (cache.size > 100) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    cache.set(folderId, { createdAt: Date.now(), value });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function parsePath(rawPath) {
  if (!rawPath) return [];

  const parts = String(rawPath)
    .split("/")
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length > 8 || parts.some(part => !isValidDriveId(part))) {
    throw new Error("Caminho inválido.");
  }

  return parts;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Método não permitido." });
  }

  try {
    const pathParts = parsePath(req.query?.path);
    const breadcrumbs = [
      { name: ROOT_FOLDER_NAME, path: "" }
    ];

    let currentId = ROOT_FOLDER_ID;
    let currentName = ROOT_FOLDER_NAME;
    let currentPath = "";
    let currentListing = await fetchFolder(currentId, currentName);

    for (const nextId of pathParts) {
      const nextFolder = currentListing.items.find(
        item => item.type === "folder" && item.id === nextId
      );

      if (!nextFolder) {
        return sendJson(res, 404, {
          error: "Essa pasta não pertence à biblioteca configurada."
        });
      }

      currentPath = currentPath ? currentPath + "/" + nextId : nextId;
      currentId = nextId;
      currentName = nextFolder.name;
      breadcrumbs.push({ name: currentName, path: currentPath });
      currentListing = await fetchFolder(currentId, currentName);
    }

    const items = currentListing.items.map(item => ({
      ...item,
      path: item.type === "folder"
        ? (currentPath ? currentPath + "/" + item.id : item.id)
        : null
    }));

    return sendJson(res, 200, {
      folder: {
        id: currentId,
        name: currentListing.name || currentName,
        path: currentPath
      },
      breadcrumbs,
      items,
      source: {
        name: ROOT_FOLDER_NAME,
        url: "https://drive.google.com/drive/folders/" + ROOT_FOLDER_ID
      }
    });
  } catch (error) {
    console.error("Drive content error:", error);
    return sendJson(res, 502, {
      error: "Não foi possível carregar os conteúdos do Google Drive agora."
    });
  }
}
