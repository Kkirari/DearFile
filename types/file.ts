export type FileItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  createdAt: string;
  userId: string;
  uploaderId?: string;        // LINE userId of uploader (workspace files only)
  uploaderName?: string;      // Display name of uploader (workspace files only)
  uploaderPictureUrl?: string; // Profile pic of uploader (workspace files only)
};
