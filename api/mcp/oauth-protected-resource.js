// Metadados do recurso protegido para descoberta OAuth MCP (RFC 9728).
// O servidor OAuth do Supabase deve estar habilitado antes de conectar o ChatGPT.
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  return res.status(200).json({
    resource: "https://organizaisso.vercel.app/api/mcp",
    authorization_servers: ["https://vtjxvahmigrerbnrqmse.supabase.co/auth/v1"],
    bearer_methods_supported: ["header"]
  });
}
