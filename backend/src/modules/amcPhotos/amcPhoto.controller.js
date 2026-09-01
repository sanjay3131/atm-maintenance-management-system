import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import cloudinary from "../../config/cloudinary.js";
import AMCPhoto from "./amcPhoto.model.js";
import AMC from "../amc/amc.model.js";
import { AMC_CONFIG } from "../amc/amc.config.js";

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

  const savedPhotos = [];
  const photoIds = [];

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

    const thumbnailUrl = cloudinary.url(uploadResult.public_id, {
      width: 300,
      height: 300,
      crop: "fill",
      quality: "auto",
      fetch_format: "auto",
    });

    const photo = await AMCPhoto.create({
      amcId,
      atmId: amc.atmId,
      uploadedBy: req.user._id,
      publicId: uploadResult.public_id,
      url: uploadResult.secure_url,
      thumbnailUrl,
      originalName: file.originalname,
      size: uploadResult.bytes || file.size,
      mimeType: file.mimetype,
      gpsData: req.body.gpsData ? JSON.parse(req.body.gpsData) : undefined,
    });

    savedPhotos.push(photo);
    photoIds.push(photo._id);
  }

  // Update AMC with new photo references
  amc.photos = [...(amc.photos || []), ...photoIds];
  amc.photoCount = amc.photos.length;
  await amc.save();

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
        total: amc.photoCount,
        remaining: AMC_CONFIG.REQUIRED_PHOTOS - amc.photoCount,
      },
      `${savedPhotos.length} photo(s) uploaded. ${AMC_CONFIG.REQUIRED_PHOTOS - amc.photoCount} remaining.`,
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
  const isCustomer =
    req.user.userType === "customer" &&
    amc.customerId?.toString() === req.user._id.toString();

  if (!isAdmin && !isEmployee && !isCustomer) {
    // Supervisor check
    if (isSupervisor) {
      const Employee = (await import("../employees/employee.model.js")).default;
      const supervised = await Employee.findOne({
        supervisorId: req.user._id,
        userId: amc.employeeId,
      });
      if (!supervised) throw new ApiError(403, "Access denied");
    } else {
      throw new ApiError(403, "Access denied");
    }
  }

  const photos = await AMCPhoto.find({ amcId, isExpired: false })
    .populate("uploadedBy", "firstName lastName")
    .sort({ uploadedAt: 1 });

  return res
    .status(200)
    .json(new ApiResponse(200, { photos }, "AMC photos fetched"));
});

export const deleteAMCPhoto = asyncHandler(async (req, res) => {
  const { photoId } = req.params;

  const photo = await AMCPhoto.findById(photoId);
  if (!photo || photo.isExpired) throw new ApiError(404, "Photo not found");

  const amc = await AMC.findById(photo.amcId);
  if (!amc) throw new ApiError(404, "AMC not found");

  // Only admin or uploader can delete
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isUploader = photo.uploadedBy.toString() === req.user._id.toString();

  if (!isAdmin && !isUploader) {
    throw new ApiError(403, "You can only delete photos you uploaded");
  }

  // Delete from Cloudinary
  const { deleteSinglePhoto } =
    await import("../../config/cloudinaryCleanup.js");
  await deleteSinglePhoto(photo.publicId);

  // Remove from AMC
  amc.photos = (amc.photos || []).filter(
    (id) => id.toString() !== photo._id.toString(),
  );
  amc.photoCount = amc.photos.length;
  await amc.save();

  // Soft delete
  photo.isExpired = true;
  photo.expiredAt = new Date();
  photo.url = null;
  photo.thumbnailUrl = null;
  await photo.save();

  return res.status(200).json(new ApiResponse(200, null, "Photo deleted"));
});
