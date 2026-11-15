# Fresh geography setup

The required first-deployment workflow starts from a newly created or freshly
recreated database. The setup command can also repair the exact known obsolete
geography indexes on the existing `test` database without deleting or
rewriting documents. Do not run the old geography mapping migration for fresh
setup.

The old `migrateGeography.js` and `manageDistrictIndexes.js` files are retained
as legacy artifacts. Their npm commands are not part of this setup procedure.

The setup module is safe to import: importing it does not load environment
configuration, connect to MongoDB, run preflight, or mutate indexes. Its setup
workflow runs only when the script is invoked directly.

## Desired Region and District indexes

The District schema keeps `autoIndex: false`; District indexes are managed
explicitly. Region indexes continue to follow the schema definitions. The
setup command verifies the exact Region and District index sets:

| Collection | Name | Key | Options |
| --- | --- | --- | --- |
| regions | `_id_` | `{ _id: 1 }` | MongoDB-managed unique index |
| regions | `bankId_1` | `{ bankId: 1 }` | Non-unique |
| regions | `bankId_1_name_1` | `{ bankId: 1, name: 1 }` | Unique; partial filter `{ bankId: { $type: "objectId" } }` |
| regions | `bankId_1_code_1` | `{ bankId: 1, code: 1 }` | Unique; partial filter `{ bankId: { $type: "objectId" }, code: { $type: "string", $gt: "" } }` |
| districts | `_id_` | `{ _id: 1 }` | MongoDB-managed unique index |
| districts | `regionId_1` | `{ regionId: 1 }` | Non-unique |
| districts | `districtName_1` | `{ districtName: 1 }` | Non-unique; supports District name sorting |
| districts | `uniq_district_bank_name_normalized` | `{ bankId: 1, districtNameNormalized: 1 }` | Unique; partial filter `{ geographyStatus: "MAPPED" }` |
| districts | `uniq_district_bank_pin_normalized` | `{ bankId: 1, pinCodeNormalized: 1 }` | Unique; partial filter `{ geographyStatus: "MAPPED" }` |

Banks and ATMs keep their existing schema index behavior. The setup tool does
not manage their indexes.

## Full backup and recovery verification

The index-specification JSON is not a database backup. Before any apply, create
a recoverable full backup that includes database `test`. A verified backup and
an isolated restore test are mandatory before any index apply.

For Atlas, use the Atlas project and cluster identified through the approved
deployment configuration or secret manager; do not print or paste the MongoDB
URI. Create an on-demand cluster snapshot, wait for its status to show
completion, and record its snapshot ID, completion time, and retention
expiration. Atlas snapshots are cluster-level and should include `test`.

Verify recoverability before migration by restoring that snapshot to a separate,
isolated temporary cluster or target. Never restore over `test`. Confirm the
restored target contains database `test`, compare its collection inventory and
document counts with a read-only pre-backup inventory, and verify the restored
Region and District index specifications. Keep the snapshot through the
post-migration verification and approved rollback window.

If a logical backup is used instead, run MongoDB Database Tools from an
approved restricted host with credentials supplied by the organization’s
protected secret mechanism. Export all collections and indexes in `test` to an
encrypted, access-restricted archive. Do not put credentials in source,
terminal history, command output, logs, or process arguments. Verify the
archive by restoring it to an isolated temporary target and checking the
collection inventory, counts, and indexes before relying on it.

## Writer-pause procedure

Do not infer production quiescence from the absence of a local Node process.
Before applying indexes:

1. Inventory all deployed API instances and every writer for `test`: background
   workers, scheduled jobs, one-off scripts, maintenance tasks, integrations,
   and administrative clients.
2. Put the application into its approved maintenance/read-only mode. Stop or
   scale every API writer and worker to zero, disable scheduled triggers, and
   drain in-flight requests, transactions, and queued jobs.
3. Use the deployment control plane to confirm all replicas and worker
   instances are stopped. Use the database activity/audit monitoring available
   to the operator to confirm writes have ceased after the pause. Keep the
   workload paused through index creation and final verification.
4. Record the service/worker inventory, pause time, and operator confirmation.
   The setup command's `--writers-stopped` flag is only an explicit operator
   assertion; the script cannot independently discover or stop production
   writers.
5. Restart writers only after exact index verification succeeds.

## Setup and index repair procedure

1. Deploy the application version with the Bank → Region → District → ATM
   schemas and current runtime write validation. The District schema must keep
   `autoIndex: false`, and must retain the non-unique `districtName_1` index for
   sorted District listing.
2. Configure the execution environment so both `--target-database` and the URI
   database path are exactly `test`. The setup command rejects any other,
   missing, or mismatched database name.
   The current local URI is pathless, so it must not be used unchanged for this
   command. Supply the correctly targeted URI through the approved secure
   process-level secret mechanism; do not edit `.env` or print the URI.
3. Review the read-only index and duplicate preflight:

   ```sh
   cd backend
   npm run geography:setup-indexes -- --target-database=test
   ```

   The command reports Region name/code duplicates and mapped District
   normalized-name/PIN duplicates within a Bank, the exact indexes to create,
   recognized obsolete indexes, and any unknown or mismatched specifications.
   Inactive mapped Districts are included. Identical values across different
   Banks are allowed. Unknown or mismatched indexes stop the procedure for
   manual review; they are never dropped automatically.
4. Complete and verify the full backup described above. Complete the
   writer-pause checklist. If the preflight reports same-Bank duplicates or
   invalid mapped Districts, resolve those findings before proceeding.
5. Apply the index-only repair explicitly. The command creates the
   Bank-scoped mapped-only District indexes first, then replaces the exact old
   unique `districtName_1` with a non-unique index of the same key, then drops
   only the remaining exact obsolete indexes:

   ```sh
   npm run geography:setup-indexes -- \
     --target-database=test \
     --apply \
     --confirm=REPAIR-BANK-SCOPED-GEOGRAPHY-INDEXES \
     --backup-confirmed \
     --writers-stopped
   ```

   Obsolete indexes are dropped only when their complete name, key,
   uniqueness, and partial-filter specifications match known prior geography
   schemas. Unknown or mismatched indexes stop the procedure before any
   operation. Replacing the same-name District index is not atomic: the old
   unique index is dropped before its non-unique replacement is created. If
   creation fails, restoring the old specification is best-effort and can also
   fail. No operation deletes or rewrites collection documents. If any step
   fails, keep writers stopped, inspect the reported index state, and rerun the
   read-only plan before retrying.
6. Restart application writers and populate Banks, Regions, Districts, and ATM
   assignments through the admin interfaces and application APIs. Do not use
   historical mapping files, migration scripts, test fixtures, or seeds with
   hardcoded geography names.
7. Verify indexes and geography after population:

   ```sh
   npm run geography:setup-indexes -- \
     --target-database=test \
     --verify
   npm run geography:verify -- --target-database=test
   ```

   The index verification command checks both Region and District indexes.
   The read-only geography verifier reports the shared 12-category audit
   counters, duplicate Bank and Region keys, duplicate District groups,
   unmapped Region/District/ATM counts, soft-deleted ATM exclusions, and
   District index verification. Bank names and codes are globally unique;
   Region names and nonempty codes are unique within each Bank; District names
   and PINs are unique within each Bank. Soft-deleted ATMs are excluded from
   operational geography checks.

## Index-only rollback

Keep all writers paused while rolling back. Capture the current `listIndexes`
output first and use the exact pre-migration index-specification backup. Do not
restore an Atlas snapshot over `test` as an index rollback.

1. Drop `uniq_district_bank_name_normalized` and
   `uniq_district_bank_pin_normalized`.
2. Drop the non-unique `districtName_1` replacement.
3. Recreate the prior exact Region indexes `districtId_1`,
   `districtId_1_name_1`, and `districtId_1_code_1`, and the prior District
   indexes `districtName_1`, `pinCode_1`, `regionId_1_districtName_1`, and
   `regionId_1_pinCode_1`, using the saved keys and options.
4. Compare both collections' `listIndexes` output with the saved pre-migration
   specifications before restarting writers.

Recreating the old global unique District name/PIN indexes can fail if
cross-Bank duplicate values were written after the repair. Do not delete or
rewrite documents to force rollback. Keep the writers paused and escalate for
review if the old indexes cannot be recreated.

## Scope and safety

- Setup connects only on direct script execution; importing the module does not
  run setup or connect.
- The setup command accepts only `--target-database=test` and a MongoDB URI
  whose database path is exactly `/test`.
- The default command is read-only. `--apply` requires a target database and
  explicit confirmation.
- The repair removes only exact, recognized obsolete geography index
  specifications. It stops rather than dropping unknown or mismatched
  indexes.
- Unique indexes cover every mapped District, regardless of `isActive`. The
  partial filter excludes only records whose `geographyStatus` is not
  `MAPPED`; mapped rows with missing or inconsistent normalized values fail
  preflight.
- No command in this procedure resets a database, deletes documents, or
  fabricates historical geography.
