import Employee from "./employee.model.js";

const generateEmployeeCode = async () => {
  const lastEmployee = await Employee.findOne().sort({ createdAt: -1 });

  let newEmployeeCode = "EMP001";

  if (lastEmployee && lastEmployee.employeeCode) {
    const lastCodeNumber = parseInt(lastEmployee.employeeCode.slice(3), 10);
    const nextCodeNumber = lastCodeNumber + 1;
    newEmployeeCode = `EMP${nextCodeNumber.toString().padStart(3, "0")}`;
  }

  return newEmployeeCode;
};

export { generateEmployeeCode };
