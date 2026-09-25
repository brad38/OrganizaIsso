# Mural Acadêmico

Projeto convertido para Node.js usando Vite.

## Requisitos

- Node.js 20+
- npm

## Executar localmente

```powershell
npm install
npm run dev
```

Abra:

```text
http://localhost:5173
```

## Build de produção

```powershell
npm run build
```

Para testar o build:

```powershell
npm run preview
```

## Vercel

O projeto já possui `vercel.json` e pode ser importado diretamente pela Vercel.

## Supabase

O arquivo `.env.example` já reserva as variáveis que serão usadas na próxima etapa:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Não coloque `service_role` no frontend.

## Git

```powershell
git init
git add .
git commit -m "feat: inicia mural academico"
```
