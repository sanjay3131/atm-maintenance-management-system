import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import mongoose from "mongoose";
import cloudinary from "../../config/cloudinary.js";
import AMCPhoto from "./amcPhoto.model.js";
import AMC from "../amc/amc.model.js";
import {
  getActiveCustomerForUser,
  sameCustomerId,
  toCustomerSafeAMCPhoto,
} from "../customers/customerAccess.js";
import { AMC_CONFIG, AMC_STATUS } from "../amc/amc.config.js";

const rollbackUploadedBatch = async ({ publicIds, photoIds, amcId }) => {
  const cleanupErrors = [];
  let photoRecordsRemoved = photoIds.length === 0;

  if (photoIds.length > 0) {
    try {
      const result = await AMCPhoto.deleteMany({ _id: { $in: photoIds } });
      photoRecordsRemoved = result.deletedCount === photoIds.length;
      if (!photoRecordsRemoved) {
        cleanupErrors.push(
          `photo records: expected to remove ${photoIds.length}, removed ${result.deletedCount}`,
        );
      }
    } catch (error) {
      cleanupErrors.push(`photo records: ${error.message}`);
    }
  }

  if (photoRecordsRemoved) {
    for (const publicId of publicIds) {
      try {
        const result = await cloudinary.uploader.destroy(publicId, {
          resource_type: "image",
        });
        if (!["ok", "not found"].includes(result?.result)) {
          cleanupErrors.push(`Cloudinary object ${publicId}: unexpected delete response`);
        }
      } catch (error) {
        cleanupErrors.push(`Cloudinary object ${publicId}: ${error.message}`);
      }
    }
  }

  if (cleanupErrors.length > 0) {
    console.error(
      `[AMC photo upload rollback] AMC ${amcId}; cleanup failures: ${cleanupErrors.join("; ")}`,
    );
  }
  return cleanupErrors;
};

export const uploadAMCPhotos = asyncHandler(async (req, res) => {
  const { amcId } = req.params;

  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "No photos provided");
  }

  const amc = await AMC.findById(amcId);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  // Authorization: only assigned employee
  if (amc.employeeId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only upload photos for your assigned AMC");
  }

  if (amc.status === AMC_STATUS.COMPLETED) {
    throw new ApiError(400, "Cannot upload photos for completed AMC");
  }

  if (
    !amc.visitDate ||
    ![AMC_STATUS.IN_PROGRESS, AMC_STATUS.OVERDUE].includes(amc.status)
  ) {
    throw new ApiError(400, "AMC visit has not been started");
  }

  // Check limit
  const remaining = AMC_CONFIG.REQUIRED_PHOTOS - amc.photoCount;
  if (remaining <= 0) {
    throw new ApiError(
      400,
      `Maximum ${AMC_CONFIG.REQUIRED_PHOTOS} photos already uploaded`,
    );
  }

  if (req.files.length > remaining) {
    throw new ApiError(
      400,
      `Can upload max ${remaining} more photo(s). You tried ${req.files.length}.`,
    );
  }

  const gpsData = req.body.gpsData ? JSON.parse(req.body.gpsData) : undefined;
  const uploadedAssets = [];
  const savedPhotos = [];
  let attached = false;
  let persistenceOutcomeUnknown = false;
  try {
    for (const file of req.files) {
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: AMC_CONFIG.CLOUDINARY_FOLDER(amcId),
            resource_type: "image",
            transformation: [{ quality: "auto", fetch_format: "auto" }],
            tags: [`amc_${amcId}`, `atm_${amc.atmId}`],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        );
        stream.end(file.buffer);
      });
      if (uploadResult?.public_id) {
        uploadedAssets.push({ uploadResult, file });
      }
      if (!uploadResult?.public_id || !uploadResult.secure_url) {
        throw new Error("Cloudinary returned an incomplete photo upload result");
      }
    }

    for (const { uploadResult, file } of uploadedAssets) {
      const thumbnailUrl = cloudinary.url(uploadResult.public_id, {
        width: 300,
        height: 300,
        crop: "fill",
        quality: "auto",
        fetch_format: "auto",
      });
      let photo;
      try {
        photo = await AMCPhoto.create({
          amcId,
          atmId: amc.atmId,
          uploadedBy: req.user._id,
          publicId: uploadResult.public_id,
          url: uploadResult.secure_url,
          thumbnailUrl,
          originalName: file.originalname,
          size: uploadResult.bytes || file.size,
          mimeType: file.mimetype,
          gpsData,
        });
      } catch (error) {
        persistenceOutcomeUnknown = true;
        throw error;
      }
      savedPhotos.push(photo);
    }

    let updatedAMC;
    try {
      updatedAMC = await AMC.findOneAndUpdate(
        {
          _id: amc._id,
          employeeId: req.user._id,
          isDeleted: false,
          status: { $ne: AMC_STATUS.COMPLETED },
          photoCount: {
            $lte: AMC_CONFIG.REQUIRED_PHOTOS - savedPhotos.length,
          },
        },
        {
          $push: { photos: { $each: savedPhotos.map((photo) => photo._id) } },
          $inc: { photoCount: savedPhotos.length },
        },
        { new: true, runValidators: true },
      );
    } catch (error) {
      persistenceOutcomeUnknown = true;
      throw error;
    }
    if (!updatedAMC) {
      throw new ApiError(
        409,
        "The AMC photo limit or visit status changed during upload. No photos were attached.",
      );
    }
    attached = true;
  } catch (error) {
    if (!attached) {
      if (persistenceOutcomeUnknown) {
        console.error(
          `[AMC photo upload] AMC ${amcId}; database write outcome is unknown; uploaded assets were retained for reconciliation (${error.name || "Error"})`,
        );
        throw new ApiError(
          503,
          "Some photo data may have been saved. It was retained to avoid broken references. Refresh the AMC details or contact support before retrying.",
        );
      }

      const cleanupErrors = await rollbackUploadedBatch({
        publicIds: uploadedAssets
          .map(({ uploadResult }) => uploadResult.public_id)
          .filter(Boolean),
        photoIds: savedPhotos.map((photo) => photo._id),
        amcId,
      });
      if (cleanupErrors.length > 0) {
        throw new ApiError(
          502,
          `${error.message}. Some temporary photo data could not be removed; contact support.`,
        );
      }
    }
    throw error;
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        photos: savedPhotos.map((p) => ({
          _id: p._id,
          url: p.url,
          thumbnailUrl: p.thumbnailUrl,
          uploadedAt: p.uploadedAt,
        })),
        uploaded: savedPhotos.length,
        total: amc.photoCount + savedPhotos.length,
        remaining:
          AMC_CONFIG.REQUIRED_PHOTOS - amc.photoCount - savedPhotos.length,
      },
      `${savedPhotos.length} photo(s) uploaded. ${AMC_CONFIG.REQUIRED_PHOTOS - amc.photoCount - savedPhotos.length} remaining.`,
    ),
  );
});

export const getAMCPhotos = asyncHandler(async (req, res) => {
  const { amcId } = req.params;

  const amc = await AMC.findById(amcId);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  // Authorization
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isSupervisor = req.user.userType === "supervisor";
  const isEmployee = amc.employeeId?.toString() === req.user._id.toString();

  if (req.user.userType === "customer") {
    const customer = await getActiveCustomerForUser(req.user);
    if (
      !sameCustomerId(amc.customerId, customer._id) ||
      amc.status !== AMC_STATUS.COMPLETED
    ) {
      throw new ApiError(404, "AMC not found");
    }
  }

  if (
    !isAdmin &&
    !isEmployee &&
    !isSupervisor &&
    req.user.userType !== "customer"
  ) {
    throw new ApiError(403, "Access denied");
  }

  if (isSupervisor) {
    const Employee = (await import("../employees/employee.model.js")).default;
    const supervised = await Employee.findOne({
      supervisorId: req.user._id,
      userId: amc.employeeId,
    });
    if (!supervised) throw new ApiError(403, "Access denied");
  }

  let photoQuery = AMCPhoto.find({ amcId, isExpired: false });
  if (isSupervisor) {
    photoQuery = photoQuery.select("_id url thumbnailUrl uploadedAt");
  } else {
    photoQuery = photoQuery.populate("uploadedBy", "firstName lastName");
  }
  photoQuery = photoQuery.sort({ uploadedAt: 1 });
  const photos = await photoQuery;

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {
          photos:
            req.user.userType === "customer"
              ? photos.map(toCustomerSafeAMCPhoto)
              : photos,
        },
        "AMC photos fetched",
      ),
    );
});

export const deleteAMCPhoto = asyncHandler(async (req, res) => {
  const { photoId } = req.params;

  const photo = await AMCPhoto.findById(photoId);
  if (!photo || photo.isExpired) throw new ApiError(404, "Photo not found");

  const amc = await AMC.findById(photo.amcId);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isUploader = photo.uploadedBy.toString() === req.user._id.toString();

  if (!isAdmin && !isUploader) {
    throw new ApiError(403, "You can only delete photos you uploaded");
  }

  if (amc.status === AMC_STATUS.COMPLETED && !isAdmin) {
    throw new ApiError(400, "AMC is completed. Photos cannot be deleted.");
  }

  const publicId = photo.publicId;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const amcFilter = {
        _id: amc._id,
        isDeleted: false,
        photos: photo._id,
        photoCount: { $gt: 0 },
      };
      if (!isAdmin) {
        amcFilter.status = { $ne: AMC_STATUS.COMPLETED };
      }

      const updatedAMC = await AMC.findOneAndUpdate(
        amcFilter,
        {
          $pull: { photos: photo._id },
          $inc: { photoCount: -1 },
        },
        { new: true, runValidators: true, session },
      );
      if (!updatedAMC) {
        throw new ApiError(
          409,
          "AMC or photo changed before the photo could be deleted",
        );
      }

      const expiredPhoto = await AMCPhoto.findOneAndUpdate(
        { _id: photo._id, amcId: amc._id, isExpired: false },
        {
          $set: {
            isExpired: true,
            expiredAt: new Date(),
            url: null,
            thumbnailUrl: null,
          },
        },
        { new: true, runValidators: true, session },
      );
      if (!expiredPhoto) {
        throw new ApiError(
          409,
          "AMC photo changed before the photo could be deleted",
        );
      }
    });
  } finally {
    await session.endSession();
  }

  const { deleteSinglePhoto } =
    await import("../../config/cloudinaryCleanup.js");
  const deleted = await deleteSinglePhoto(publicId);
  if (!deleted) {
    throw new ApiError(
      502,
      "Photo was removed from the AMC, but storage cleanup failed. Contact support.",
    );
  }

  return res.status(200).json(new ApiResponse(200, null, "Photo deleted"));
});
