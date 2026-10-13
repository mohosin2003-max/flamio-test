import { supabase } from "@/integrations/supabase/client";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Returns an error message if the file is not allowed, otherwise null. */
export function validateProfilePhoto(file: File): string | null {
  if (!EXTENSIONS[file.type]) return "Choose a JPG, PNG, or WebP image.";
  if (file.size > PROFILE_PHOTO_MAX_BYTES) return "Choose an image smaller than 5 MB.";
  return null;
}

/**
 * Same behavior as the customer flow: upload into the user's own folder,
 * update profiles.avatar_path, and only then remove the previous photo.
 */
export async function uploadOwnProfilePhoto(userId: string, file: File, previousPath: string | null) {
  const extension = EXTENSIONS[file.type];
  if (!extension) throw new Error("Invalid file type");
  const nextPath = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("profile-photos")
    .upload(nextPath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error: profileError } = await supabase.from("profiles").update({ avatar_path: nextPath }).eq("id", userId);
  if (profileError) {
    await supabase.storage.from("profile-photos").remove([nextPath]);
    throw profileError;
  }
  if (previousPath && previousPath !== nextPath) {
    await supabase.storage.from("profile-photos").remove([previousPath]);
  }
  return nextPath;
}
