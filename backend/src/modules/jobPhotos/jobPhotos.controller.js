import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import cloudinary from "../../config/cloudinary.js";
import JobPhoto from "./jobPhotos.model.js";
import Job from "../jobs/jobs.model.js";
import { deleteSinglePhoto } from "../../config/cloudinaryCleanup.js";

// ============================================
// UPLOAD PHOTOS TO CLOUDINARY
// ============================================
export const uploadPhotos = asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { photoType } = req.body; // "before" or "after"

  if (!photoType || !["before", "after"].includes(photoType)) {
    throw new ApiError(400, "photoType must be 'before' or 'after'");
  }

  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "No photos provided");
  }

  // Verify job exists
  const job = await Job.findById(jobId);
  if (!job || job.isDeleted) {
    throw new ApiError(404, "Job not found");
  }

  // Check ownership
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isAssigned =
    job.assignedEmployeeId?.toString() === req.user._id.toString();

  if (!isAdmin && !isAssigned) {
    throw new ApiError(
      403,
      "You can only upload photos for your assigned jobs",
    );
  }

  // Check job status
  const validStatuses = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "ON_HOLD"];
  if (!validStatuses.includes(job.status)) {
    throw new ApiError(
      400,
      `Cannot upload photos for job with status: ${job.status}`,
    );
  }

  // Check photo limits: 3 per type, 6 total
  const existingTypeCount = await JobPhoto.countDocuments({
    jobId,
    photoType,
    isExpired: false,
  });
  const newCount = req.files.length;

  if (existingTypeCount + newCount > 3) {
    throw new ApiError(
      400,
      `Maximum 3 ${photoType} photos allowed. You have ${existingTypeCount}, tried to add ${newCount}.`,
    );
  }

  const totalExisting = await JobPhoto.countDocuments({
    jobId,
    isExpired: false,
  });
  if (totalExisting + newCount > 6) {
    throw new ApiError(
      400,
      `Maximum 6 photos total per job. You have ${totalExisting}, tried to add ${newCount}.`,
    );
  }

  // Upload each file to Cloudinary
  const savedPhotos = [];

  for (const file of req.files) {
    // Upload to Cloudinary with folder structure
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `atm-fsm/jobs/${jobId}/${photoType}`,
          resource_type: "image",
          transformation: [
            { quality: "auto", fetch_format: "auto" }, // Auto-optimize
          ],
          tags: [`job_${jobId}`, `atm_${job.atmId}`, photoType],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
      stream.end(file.buffer);
    });

    // Create thumbnail URL (f_auto,q_auto,w_300,h_300,c_fill)
    const thumbnailUrl = cloudinary.url(uploadResult.public_id, {
      width: 300,
      height: 300,
      crop: "fill",
      quality: "auto",
      fetch_format: "auto",
    });

    // Save metadata to DB
    const photo = await JobPhoto.create({
      jobId,
      atmId: job.atmId,
      photoType,
      publicId: uploadResult.public_id,
      url: uploadResult.secure_url,
      thumbnailUrl,
      originalName: file.originalname,
      size: uploadResult.bytes || file.size,
      mimeType: file.mimetype,
      uploadedBy: req.user._id,
      uploadedAt: new Date(),
      gpsData: req.body.gpsData ? JSON.parse(req.body.gpsData) : undefined,
    });

    savedPhotos.push(photo);
  }

  // Update job with photo references
  const photoIds = savedPhotos.map((p) => p._id);
  if (photoType === "before") {
    job.beforePhotos = [...(job.beforePhotos || []), ...photoIds];
  } else {
    job.afterPhotos = [...(job.afterPhotos || []), ...photoIds];
  }
  await job.save();

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        photos: savedPhotos.map((p) => ({
          _id: p._id,
          url: p.url,
          thumbnailUrl: p.thumbnailUrl,
          photoType: p.photoType,
          uploadedAt: p.uploadedAt,
        })),
        totalBefore: await JobPhoto.countDocuments({
          jobId,
          photoType: "before",
          isExpired: false,
        }),
        totalAfter: await JobPhoto.countDocuments({
          jobId,
          photoType: "after",
          isExpired: false,
        }),
      },
      `${savedPhotos.length} ${photoType} photo(s) uploaded successfully`,
    ),
  );
});

// ============================================
// GET PHOTOS FOR A JOB
// ============================================
export const getJobPhotos = asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  const job = await Job.findById(jobId);
  if (!job || job.isDeleted) {
    throw new ApiError(404, "Job not found");
  }

  // Authorization
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isAssigned =
    job.assignedEmployeeId?.toString() === req.user._id.toString();
  const isCustomer = req.user.userType === "customer";

  if (isCustomer) {
    if (!["VERIFIED", "APPROVED", "CLOSED"].includes(job.status)) {
      throw new ApiError(403, "This job is not yet approved for viewing");
    }
  } else if (!isAdmin && !isAssigned) {
    throw new ApiError(403, "Access denied");
  }

  const photos = await JobPhoto.find({
    jobId,
    isExpired: false, // Don't show expired photos
  })
    .populate("uploadedBy", "firstName lastName")
    .sort({ uploadedAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, { photos }, "Photos fetched successfully"));
});

// ============================================
// DELETE A SINGLE PHOTO
// ============================================
export const deletePhoto = asyncHandler(async (req, res) => {
  const { photoId } = req.params;

  const photo = await JobPhoto.findById(photoId);
  if (!photo || photo.isExpired) {
    throw new ApiError(404, "Photo not found or already expired");
  }

  const job = await Job.findById(photo.jobId);
  if (!job) {
    throw new ApiError(404, "Associated job not found");
  }

  // Only admin or uploader can delete
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isUploader = photo.uploadedBy.toString() === req.user._id.toString();

  if (!isAdmin && !isUploader) {
    throw new ApiError(403, "You can only delete photos you uploaded");
  }

  // Delete from Cloudinary
  await deleteSinglePhoto(photo.publicId);

  // Remove from job arrays
  job.beforePhotos = (job.beforePhotos || []).filter(
    (id) => id.toString() !== photo._id.toString(),
  );
  job.afterPhotos = (job.afterPhotos || []).filter(
    (id) => id.toString() !== photo._id.toString(),
  );
  await job.save();

  // Soft delete in DB (mark expired)
  photo.isExpired = true;
  photo.expiredAt = new Date();
  photo.url = null;
  photo.thumbnailUrl = null;
  await photo.save();

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Photo deleted successfully"));
});

// ============================================
// GET PHOTO STATS (Admin)
// ============================================
export const getPhotoStats = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Admin access required");
  }

  const totalPhotos = await JobPhoto.countDocuments({ isExpired: false });
  const beforePhotos = await JobPhoto.countDocuments({
    photoType: "before",
    isExpired: false,
  });
  const afterPhotos = await JobPhoto.countDocuments({
    photoType: "after",
    isExpired: false,
  });
  const expiredPhotos = await JobPhoto.countDocuments({ isExpired: true });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const photosExpiringSoon = await JobPhoto.countDocuments({
    uploadedAt: { $lt: thirtyDaysAgo },
    isExpired: false,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        totalPhotos,
        beforePhotos,
        afterPhotos,
        expiredPhotos,
        photosExpiringSoon,
      },
      "Photo stats fetched",
    ),
  );
});
