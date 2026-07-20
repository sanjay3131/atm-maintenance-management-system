import ATM from "../atms/atm.model.js";

export const generateATMId = async () => {
  const lastATM = await ATM.findOne().sort({ createdAt: -1 }).select("atmId");

  if (!lastATM) {
    return "ATM0001";
  }

  const lastNumber = parseInt(lastATM.atmId.replace("ATM", ""), 10);
  const nextNumber = lastNumber + 1;

  return `ATM${nextNumber.toString().padStart(4, "0")}`;
};
