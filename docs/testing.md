# Test Suites

`npm test` and `npm run test:unit` run the safe unit/contract suite. `npm run test:db` runs database-mutating tests. `npm run test:api` starts the API itself, runs HTTP regression tests, then stops it and removes its temporary fixture/backup directory.

The database and API suites fail closed unless `INFIDASH_TEST_DATABASE_URL` points to a loopback PostgreSQL database whose name contains a distinct `test` segment, such as `infidash_test`. Do not point these suites at shared, staging, or production data. Set `INFIDASH_TEST_API_BASE_URL` to the loopback origin where the isolated API should listen (for example `http://127.0.0.1:4000`); the runner passes the same test database URL to its own API process, uses an anonymized legacy SQLite fixture in the OS temp directory, and keeps test backups there too. DB tests skip legacy SQLite import so local `data/infidash.sqlite` is never read.

CI runs the DB and API suites against separate disposable PostgreSQL service containers; their state is reset by discarding the container rather than dropping a developer database. Local runs do not automatically delete or recreate the configured database.
