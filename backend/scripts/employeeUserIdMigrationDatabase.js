export const EMPLOYEE_USER_ID_MIGRATION_DATABASE = "atm_management";

export const employeeUserIdMigrationConnectionOptions = {
  dbName: EMPLOYEE_USER_ID_MIGRATION_DATABASE,
};

export const assertEmployeeUserIdMigrationDatabase = (databaseName) => {
  if (databaseName !== EMPLOYEE_USER_ID_MIGRATION_DATABASE) {
    throw new Error(
      `Employee userId index migration requires database "${EMPLOYEE_USER_ID_MIGRATION_DATABASE}"`,
    );
  }
};
