# Contributing

Bugs, data mistakes and ideas: open an issue at https://github.com/nickBes/lawsofisrael/issues/new/choose. PRs are welcome.

## Running the site

```bash
cd web
npm ci
npm run data   # builds the precomputed DuckDB/Parquet files the site queries
npm run dev
```

The site has no backend. All data is precomputed from the Knesset API datasets by `npm run data` and queried in the browser. Fixes to the data itself belong in the data build, not in the UI.

## Code style

- UI uses shadcn/ui components (`web/src/components/ui`) and their conventions; reuse an existing component before adding one.
- Keep changes small: the smallest complete change wins, no speculative options or abstractions.
- Text is Hebrew and the layout is RTL.
- Pin exact dependency versions.
