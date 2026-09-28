import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({ error: "Endpoint desativado. Use o cadastro padrão com confirmação de e-mail." }),
  {
    status: 410,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  }
));
