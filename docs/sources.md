# Implementation references

Consulted 2026-10-20 before implementing the relevant calls. Context7 was not configured in this environment, so the primary official documentation was read directly. No framework or CSV parser was recreated.

- [Express 5 API](https://expressjs.com/en/api/): application/routes, JSON middleware, responses and async route errors.
- [Express session](https://expressjs.com/en/resources/middleware/session/): middleware, session save, cookie settings, separate cookie names and session lifetime.
- [connect-pg-simple official repository](https://github.com/voxpelli/node-connect-pg-simple): PostgreSQL session store, existing pool, table name, pruning and close.
- [node-postgres parameterized queries](https://node-postgres.com/features/queries): values passed separately from SQL, JSON data handling.
- [node-postgres pooling](https://node-postgres.com/features/pooling): bounded shared pool, query and shutdown.
- [PapaParse documentation](https://www.papaparse.com/docs): array-mode parsing, delimiter detection, disabled dynamic typing, errors, unparse and `escapeFormulae`. Array mode deliberately retains duplicate headers for explicit rejection instead of automatic renaming.
- [Zod basics](https://zod.dev/basics): parse/safeParse, schema errors and typed validation.
- [React useState](https://react.dev/reference/react/useState), [React useEffect](https://react.dev/reference/react/useEffect): controlled inputs, lifecycle loading and cleanup.
- [Vite guide](https://vite.dev/guide/) and [server options](https://vite.dev/config/server-options.html): React build and development API proxy.
- [PostgreSQL official Docker image](https://hub.docker.com/_/postgres): initialization environment, health check and PostgreSQL 18 volume layout.
- [Docker Compose application model](https://docs.docker.com/compose/intro/compose-application-model/): separate app/database services, named volume and health dependency.
- [Prettier CLI](https://prettier.io/docs/cli): formatting only the new project's explicit source globs; the legacy HTML and other workspaces are untouched.
- [actions/checkout](https://github.com/actions/checkout), [actions/setup-node](https://github.com/actions/setup-node), and [GitHub PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers): current action versions, explicit Node version, npm cache and real disposable PostgreSQL service for CI.

The visual direction reuses the old LedgerDiff edition's paper background, serif headlines, deep green structure and orange annotations. The new app uses a report workspace with persistent history, field-level review, explicit status/error states and a responsive single-column mobile layout. UI text describes the user's task rather than implementation details.
