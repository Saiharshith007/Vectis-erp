# Contributing

Thanks for taking the time to help. Bug reports, fixes and small, focused
features are all welcome.

## Getting set up

```bash
git clone https://github.com/Saiharshith007/vectis.git
cd vectis
python server.py
```

Sign in at http://127.0.0.1:8000 as `admin@example.com` / `admin123`. There is
nothing to install and no build step. Data lives in `db/` (ignored by git), so
delete that folder whenever you want a clean start.

## Before opening a pull request

Run the same checks CI runs:

```bash
python test_server_logic.py
npx eslint@8 js assets
```

Then try the change in the browser: the screens you touched, and a generated
PDF if your change affects documents.

## Ground rules

- **No build step, no front-end framework.** Plain JavaScript, one module per
  screen in `js/`, loaded from `index.html`.
- **The server stays on the standard library.** `psycopg2` is the only optional
  dependency, used when `DATABASE_URL` is set.
- **Bump the asset version.** When you change a JS or CSS file, bump its `?v=`
  query string in `index.html`. Versioned assets are cached by browsers for a
  year, so without the bump people keep running the old code.
- **Money logic needs a check.** Changes to tax, totals, rounding or document
  numbering should come with an assertion in `test_server_logic.py` (for server
  functions) or a clear description of how you verified it.
- **One change per pull request.** Smaller PRs get reviewed faster.
- **No real data.** Use made-up names, GSTINs and amounts in tests, issues and
  screenshots.

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, and what happened
instead. For security problems, don't open an issue; follow
[SECURITY.md](SECURITY.md).

By contributing you agree that your work is released under the [MIT
license](LICENSE) and that you'll follow the [code of conduct](CODE_OF_CONDUCT.md).
