import cloudinary from "../config/cloudinary.js";
import JobPhoto from "../modules/jobPhotos/jobPhotos.model.js";

const PHOTO_TTL_DAYS = 30; // Photos live for 30 days then deleted

/**
 * FIFO Cleanup: Delete photos older than 30 days from Cloudinary + DB
 * Runs daily via cron job
 */
export const cleanupOldPhotos = async () => {
  try {
    const cutoffDate = new Date(
      Date.now() - PHOTO_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    // Find all photos older than 30 days that haven't been expired yet
    const oldPhotos = await JobPhoto.find({
      uploadedAt: { $lt: cutoffDate },
      isExpired: false,
    });

    if (oldPhotos.length === 0) {
      console.log(
        `[Cloudinary Cleanup] No photos older than ${PHOTO_TTL_DAYS} days.`,
      );
      return { deleted: 0 };
    }

    let deletedCount = 0;
    let failedCount = 0;

    for (const photo of oldPhotos) {
      try {
        // Delete from Cloudinary using public_id
        const result = await cloudinary.uploader.destroy(photo.publicId, {
          resource_type: "image",
        });

        if (result.result === "ok" || result.result === "not found") {
          // Mark as expired in DB (don't hard delete — keep audit trail)
          photo.isExpired = true;
          photo.expiredAt = new Date();
          photo.url = null; // Remove URL so it can't be accessed
          photo.thumbnailUrl = null;
          await photo.save();

          deletedCount++;
        } else {
          console.error(
            `[Cloudinary] Failed to delete ${photo.publicId}:`,
            result,
          );
          failedCount++;
        }
      } catch (err) {
        console.error(
          `[Cloudinary] Error deleting photo ${photo._id}:`,
          err.message,
        );
        failedCount++;
      }
    }

    console.log(
      `[Cloudinary Cleanup] Deleted: ${deletedCount}, Failed: ${failedCount}, Total: ${oldPhotos.length}`,
    );

    return { deleted: deletedCount, failed: failedCount };
  } catch (error) {
    console.error("[Cloudinary Cleanup] Error:", error);
    return { deleted: 0, error: error.message };
  }
};

/**
 * Delete all photos for a specific job immediately
 * Used when job is deleted or reassigned
 */
export const deleteJobPhotos = async (jobId) => {
  try {
    const photos = await JobPhoto.find({ jobId, isExpired: false });

    let deletedCount = 0;

    for (const photo of photos) {
      try {
        await cloudinary.uploader.destroy(photo.publicId, {
          resource_type: "image",
        });
        deletedCount++;
      } catch (err) {
        console.error(
          `[Cloudinary] Failed to delete ${photo.publicId}:`,
          err.message,
        );
      }
    }

    // Soft delete in DB (mark expired)
    await JobPhoto.updateMany(
      { jobId },
      { isExpired: true, expiredAt: new Date(), url: null, thumbnailUrl: null },
    );

    return { deleted: deletedCount, total: photos.length };
  } catch (error) {
    console.error(
      `[Cloudinary] Error deleting photos for job ${jobId}:`,
      error,
    );
    return { deleted: 0, error: error.message };
  }
};

/**
 * Delete a single photo immediately
 */
export const deleteSinglePhoto = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });
    return result.result === "ok" || result.result === "not found";
  } catch (error) {
    console.error(`[Cloudinary] Error deleting ${publicId}:`, error);
    return false;
  }
};

/**
 * Get storage stats (approximate Cloudinary usage)
 */
export const getStorageStats = async () => {
  try {
    const stats = await JobPhoto.aggregate([
      { $match: { isExpired: false } },
      {
        $group: {
          _id: "$atmId",
          totalPhotos: { $sum: 1 },
          totalSize: { $sum: "$size" },
          oldestPhoto: { $min: "$uploadedAt" },
          newestPhoto: { $max: "$uploadedAt" },
        },
      },
      {
        $lookup: {
          from: "atms",
          localField: "_id",
          foreignField: "_id",
          as: "atm",
        },
      },
      { $unwind: "$atm" },
      {
        $project: {
          atmId: "$_id",
          atmName: "$atm.locationName",
          bank: "$atm.bank",
          totalPhotos: 1,
          totalSizeMB: {
            $round: [{ $divide: ["$totalSize", 1024 * 1024] }, 2],
          },
          oldestPhoto: 1,
          newestPhoto: 1,
          daysUntilCleanup: {
            $round: [
              {
                $divide: [
                  {
                    $subtract: [
                      { $add: ["$oldestPhoto", 30 * 24 * 60 * 60 * 1000] },
                      new Date(),
                    ],
                  },
                  24 * 60 * 60 * 1000,
                ],
              },
              0,
            ],
          },
        },
      },
    ]);

    return stats;
  } catch (error) {
    console.error("[Cloudinary] Stats error:", error);
    return [];
  }
};

export { PHOTO_TTL_DAYS };
