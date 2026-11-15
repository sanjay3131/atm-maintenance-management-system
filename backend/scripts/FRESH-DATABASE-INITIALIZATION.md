# Fresh database initialization

This runbook prepares a newly reset database. It does not delete data and must not be used as a database-reset procedure.

## Deployment configuration

Set `MONGODB_EXPECTED_DATABASE` in every backend environment. It must exactly match the database path in `MONGODB_URL`. For the current production deployment, set it to `test`; use the actual database name for a separate staging environment.

The backend refuses to connect when:
- `MONGODB_URL` is missing or malformed;
- the URI does not include an explicit database path;
- `MONGODB_EXPECTED_DATABASE` is missing; or
- the URI database does not exactly match the expected name.

Do not paste database URIs, passwords, or bootstrap secrets into source control or chat.

## Startup behavior

The API must not listen or start cron jobs until MongoDB connects and the required startup initializers complete. A failed connection, Item index initializer, Vehicle index initializer, or default Vehicle service policy initializer is a fatal startup error.

## First Super Admin

There is no public first-admin registration endpoint. Use the one-time CLI bootstrap only after the intended database has been reset and deployment target verified.

Set these backend environment variables through the deployment's secret manager:
- `BOOTSTRAP_SUPER_ADMIN_FIRST_NAME`
- `BOOTSTRAP_SUPER_ADMIN_LAST_NAME` (optional)
- `BOOTSTRAP_SUPER_ADMIN_EMAIL`
- `BOOTSTRAP_SUPER_ADMIN_PHONE`
- `BOOTSTRAP_SUPER_ADMIN_PASSWORD` (minimum 12 characters)

Run from the backend directory with an explicit target and confirmation:

```sh
npm run bootstrap:first-super-admin -- --target-database=test --confirm=CREATE-FIRST-SUPER-ADMIN
```

The command validates the URI target before connecting, requires a replica-set transaction, refuses if a Super Admin already exists, and atomically writes a one-time bootstrap marker with the first Super Admin. The marker permanently closes this bootstrap path. It does not print the password. Remove the bootstrap password from the deployment environment after successful creation.

Do not run this command against a database containing existing users unless the intended first-admin state has been reviewed.

## Fresh start order

1. Separately authorize and complete the database reset. The reset is destructive and is not performed by this code.
2. Confirm every backend instance, worker, scheduler, and external writer is stopped.
3. Set `MONGODB_EXPECTED_DATABASE` to the exact target database name.
4. Run the first Super Admin bootstrap once.
5. Start the backend and verify startup logs show the expected database and successful index/default-policy initialization.
6. Log in as the Super Admin and create Bank, Region, District, ATM, employees, and other required master data.
7. Verify the application before re-enabling other workers and integrations.

## Important limitations

- The geography index repair script remains a separate maintenance tool for an existing database. It is not a data reset command.
- Normal startup waits for every registered Mongoose model's indexes and explicitly creates the District indexes (District has Mongoose auto-indexing disabled).
- No production database connection, deletion, migration, or bootstrap execution is part of this source-code change.

## Focused local checks

From the `backend` directory, run the focused, database-free tests:

```sh
node --test test/databaseTarget.test.js test/databaseIndexReadiness.test.js test/bootstrapFirstSuperAdmin.test.js
```

These tests do not connect to MongoDB. They validate target parsing, index initialization ordering/failure behavior, and bootstrap input validation.
