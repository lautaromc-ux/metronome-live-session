# metronomo-live

App web para organizar proyectos y canciones de un metrónomo en vivo.

## Comandos

```bash
npm install
npm run dev
npm run build
```

## Audio en vivo

Ver [docs/AUDIO.md](docs/AUDIO.md).

## Backup

- `Exportar JSON` guarda proyectos, canciones y shows.
- `Importar JSON` reemplaza los datos del dispositivo.
- Los archivos de audio no se incluyen en el backup.

## Publicar online

### GitHub Pages

El proyecto ya incluye deploy automático con GitHub Actions.

1. Subir cambios a `main`.
2. Ir a `Settings > Pages`.
3. En `Build and deployment`, elegir `GitHub Actions`.
4. GitHub publica la app en:
   `https://lautaromc-ux.github.io/metronome-live-session/`

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
