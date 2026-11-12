# Vehicle rollover replica-set tests

These tests use a disposable, local MongoDB replica set and a dedicated database.
They reject remote hosts, credentials, unexpected database names, and additional
URI options. Never set `TEST_MONGODB_URI` to a production or shared database.

From `backend/`, start MongoDB:

```sh
docker compose -p atm-vehicle-rollover-test \
  -f test/integration/vehicle-rollover.compose.yml up -d --wait
docker compose -p atm-vehicle-rollover-test \
  -f test/integration/vehicle-rollover.compose.yml exec mongo \
  mongosh --host 127.0.0.1 --port 27018 --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27018"}]})'
docker compose -p atm-vehicle-rollover-test \
  -f test/integration/vehicle-rollover.compose.yml exec mongo \
  mongosh --host 127.0.0.1 --port 27018 --eval \
  'while (rs.status().myState !== 1) sleep(500); print("Replica-set primary ready")'
```

Wait until the member becomes primary, then run:

```sh
ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS=1 \
TEST_MONGODB_URI='mongodb://127.0.0.1:27018/atm_vehicle_rollover_integration_test?replicaSet=rs0' \
npm run test:vehicle-rollover-mongo
```

Run the daily-mileage idempotency and concurrency integration test against the
same dedicated replica set with:

```sh
ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS=1 \
TEST_MONGODB_URI='mongodb://127.0.0.1:27018/atm_vehicle_rollover_integration_test?replicaSet=rs0' \
node --test test/integration/vehicleDailyMileage.mongodb.test.js
```

The suite requires the dedicated database to be empty at startup and removes only
the fixture records it creates. The MongoDB container has no mounted volume, so it
is disposable. Stop only this named compose project when finished:

```sh
docker compose -p atm-vehicle-rollover-test \
  -f test/integration/vehicle-rollover.compose.yml down
```
