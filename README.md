# metronomo-live

App web para organizar proyectos y canciones de un metrónomo en vivo.

## Comandos

```bash
npm install
npm run dev
npm run build
```

## Publicar online

### GitHub Pages

1. Subir este proyecto a un repositorio de GitHub.
2. Ir a `Settings > Pages`.
3. En `Build and deployment`, elegir `GitHub Actions`.
4. Hacer push a `main`.
5. GitHub publica automáticamente la carpeta `dist`.

### Vercel

1. Importar el repositorio.
2. Vercel detecta la configuración.
3. Build: `npm run build`.
4. Output: `dist`.

### Netlify

1. Importar el repositorio.
2. Netlify usa `netlify.toml`.
3. Build: `npm run build`.
4. Publish: `dist`.
