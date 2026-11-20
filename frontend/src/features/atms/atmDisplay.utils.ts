export const getATMDisplayId = (
  atm:
    | {
        atmId?: string | null;
        clientAtmId?: string | null;
      }
    | null
    | undefined,
) => atm?.clientAtmId?.trim() || atm?.atmId || "";
