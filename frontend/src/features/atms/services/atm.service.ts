import api from "@/lib/axios";
import type {
  ATM,
  ScopedATMsResponse,
  SetATMLocationData,
  UpdateATMData,
} from "../types/atm.types";

export interface ATMUploadPreviewError {
  field: string;
  message: string;
}

export interface ATMUploadPreviewRow {
  rowNumber: number;
  status: "valid" | "invalid";
  values: {
    atmId: string;
    location: string;
    city: string;
  };
  errors: ATMUploadPreviewError[];
}

export interface ATMUploadPreview {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  rows: ATMUploadPreviewRow[];
}

export interface ATMUploadImportResult {
  totalRows: number;
  createdCount: number;
}

export interface ATMUploadImportError {
  rowNumber?: number;
  field?: string;
  message: string;
}

export interface ATMUploadImportErrorResponse {
  message?: string;
  errors?: ATMUploadImportError[];
}

export const getDistrictATMs = async (
  districtId: string,
  page: number,
  limit: number,
): Promise<ScopedATMsResponse> => {
  const response = await api.get<{ data: ScopedATMsResponse }>(
    "/atm/getAllATMs",
    { params: { districtId, page, limit } },
  );
  return response.data.data;
};

export const getRegionATMs = async (
  regionId: string,
  page: number,
  limit: number,
): Promise<ScopedATMsResponse> => {
  const response = await api.get<{ data: ScopedATMsResponse }>(
    "/atm/getAllATMs",
    { params: { regionId, page, limit } },
  );
  return response.data.data;
};

export const getATMs = async (): Promise<ATM[]> => {
  const response = await api.get("/atm/getAllATMs");
  return response.data.data;
};

export const downloadATMUploadTemplate = async () => {
  const response = await api.get<Blob>("/atm/bulk-upload/template", {
    responseType: "blob",
  });
  return {
    blob: response.data,
    filename:
      response.headers["content-disposition"]?.match(
        /filename="([^"]+)"/,
      )?.[1] ?? "atm-upload-template.xlsx",
  };
};

export const previewATMUpload = async (
  file: File,
): Promise<ATMUploadPreview> => {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await api.post<{ data: ATMUploadPreview }>(
    "/atm/bulk-upload/preview",
    formData,
    {
      // Clear the shared JSON default so Axios and the browser can set the multipart boundary.
      headers: { "Content-Type": undefined },
    },
  );
  return response.data.data;
};

export const importATMUpload = async (
  file: File,
  idempotencyKey: string,
): Promise<ATMUploadImportResult> => {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await api.post<{ data: ATMUploadImportResult }>(
    "/atm/bulk-upload/import",
    formData,
    {
      headers: {
        "Content-Type": undefined,
        "Idempotency-Key": idempotencyKey,
      },
    },
  );
  return response.data.data;
};

export const getATMById = async (atmId: string): Promise<ATM> => {
  const response = await api.get(`/atm/getATMById/${atmId}`);
  return response.data.data;
};

export const updateATM = async (
  atmId: string,
  data: UpdateATMData,
): Promise<void> => {
  await api.patch(`/atm/updateATM/${atmId}`, data);
};

export const assignEmployeeToATM = async (
  atmId: string,
  employeeId: string | null,
): Promise<ATM> => {
  const response = await api.patch(`/atm/assignEmployee/${atmId}`, {
    employeeId,
  });
  return response.data.data;
};

export const setATMAMCResponsibleEmployee = async (
  atmId: string,
  employeeId: string | null,
): Promise<ATM> => {
  const response = await api.patch(`/atm/${atmId}/amc-responsible`, {
    employeeId,
  });
  return response.data.data;
};

export const setATMLocation = async (
  atmId: string,
  data: SetATMLocationData,
): Promise<ATM> => {
  const response = await api.post<{ data: ATM }>(
    `/atm/${atmId}/set-location`,
    data,
  );
  return response.data.data;
};

export const deleteATM = async (atmId: string): Promise<void> => {
  await api.delete(`/atm/deleteATM/${atmId}`);
};
